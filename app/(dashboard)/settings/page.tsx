"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  User, Cpu, Bell, AlertTriangle,
  Eye, EyeOff, Loader2, Trash2,
  RotateCcw, Save, AlertCircle,
  ShieldCheck, Clock, Calendar,
  Activity, Sparkles, FileText, Plus, X,
  ChevronDown, ChevronUp, RotateCw, LogOut, Youtube,
  Building2, Layers, Sunrise, Palette, Wand2, ArrowLeft, ArrowRight, Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import toast from "react-hot-toast";
import { useTheme } from "next-themes";
import { THEMES } from "@/lib/themes";
import {
  useSelectedBrand, withBrand, ALL_BRANDS, type BrandRecord,
} from "@/components/dashboard/useSelectedBrand";
import { SHORT_LENGTH_OPTIONS, normalizeShortSeconds, DEFAULT_SHORT_SECONDS } from "@/lib/shortLength";
import { useBrandContext } from "@/components/BrandContext";
import {
  MODEL_CATALOG, AI_PROVIDERS, normalizeProvider, resolveModel,
  VISION_CATALOG, VISION_PROVIDERS, resolveVisionModel,
  defaultChainFor, defaultVisionChainFor,
  type AIProvider, type Chain,
} from "@/lib/aiModels";

/** Which model catalog a lane draws from: content/reply use the full catalog, vision the multimodal-only one. */
type LaneKind = "content" | "vision";

const tabs = [
  { id: "ai-setup",      label: "AI Setup",      icon: Wand2 },
  { id: "brand",         label: "Brand",         icon: Sparkles },
  { id: "content-types", label: "Content Types", icon: FileText },
  { id: "appearance",    label: "Appearance",    icon: Palette },
  { id: "account",       label: "Account",       icon: User },
  { id: "accounts",      label: "Accounts",      icon: Layers },
  { id: "ai",            label: "AI Config",      icon: Cpu },
  { id: "prompts",       label: "AI Prompts",     icon: FileText },
  { id: "youtube",       label: "YouTube",        icon: Youtube },
  { id: "notifications", label: "Notifications",  icon: Bell },
  { id: "morning-digest", label: "Morning Digest", icon: Sunrise },
  { id: "danger",        label: "Danger Zone",    icon: AlertTriangle },
];

// ─── Shared UI helpers ────────────────────────────────────────────────────────
function GlassInput({
  label, type = "text", value, onChange, placeholder, masked = false, readOnly = false,
}: {
  label: string; type?: string; value: string; onChange?: (v: string) => void;
  placeholder?: string; masked?: boolean; readOnly?: boolean;
}) {
  const [show, setShow] = useState(false);
  const inputType = masked ? (show ? "text" : "password") : type;
  return (
    <div>
      <label className="text-xs font-medium text-white/40 block mb-1.5 uppercase tracking-wider">{label}</label>
      <div className="relative">
        <input
          type={inputType}
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          placeholder={placeholder}
          readOnly={readOnly}
          className={cn(
            "w-full px-4 py-3 rounded-xl text-sm text-white placeholder-white/25 outline-none transition-all",
            readOnly && "opacity-60 cursor-default",
          )}
          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
          onFocus={(e) => { if (!readOnly) { e.target.style.borderColor = "rgb(var(--accent-rgb) / 0.5)"; e.target.style.boxShadow = "0 0 0 3px rgb(var(--accent-rgb) / 0.08)"; } }}
          onBlur={(e)  => { e.target.style.borderColor = "rgba(255,255,255,0.08)"; e.target.style.boxShadow = "none"; }}
        />
        {masked && !readOnly && (
          <button type="button" onClick={() => setShow(!show)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors"
          >
            {show ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        )}
      </div>
    </div>
  );
}

function GlassSelect({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: string[];
}) {
  return (
    <div>
      <label className="text-xs font-medium text-white/40 block mb-1.5 uppercase tracking-wider">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-4 py-3 rounded-xl text-sm text-white outline-none transition-all"
        style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
      >
        {options.map((o) => <option key={o} value={o} style={{ background: "rgb(var(--surface-rgb))" }}>{o}</option>)}
      </select>
    </div>
  );
}

function Toggle({ label, description, value, onChange, disabled = false }: {
  label: string; description: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean;
}) {
  return (
    <div className={cn("flex items-center justify-between py-3 border-b border-white/[0.04] last:border-0", disabled && "opacity-50")}>
      <div>
        <p className="text-sm text-white/80 font-medium">{label}</p>
        <p className="text-xs text-white/35 mt-0.5">{description}</p>
      </div>
      <motion.button
        onClick={() => { if (!disabled) onChange(!value); }}
        disabled={disabled}
        aria-disabled={disabled}
        className={cn("relative w-11 h-6 rounded-full transition-all flex-shrink-0 ml-4", value ? "bg-gradient-to-r from-brand to-brand-light" : "bg-white/10", disabled && "cursor-not-allowed")}
        style={value ? { boxShadow: "0 0 12px rgb(var(--accent-rgb) / 0.4)" } : {}}
      >
        <motion.div
          animate={{ x: value ? 20 : 2 }}
          transition={{ type: "spring", bounce: 0.2, duration: 0.3 }}
          className="absolute top-1 w-4 h-4 rounded-full bg-white shadow-sm"
        />
      </motion.button>
    </div>
  );
}

function SaveButton({ onClick, loading, label = "Save Changes" }: {
  onClick: () => void; loading?: boolean; label?: string;
}) {
  return (
    <motion.button
      whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
      onClick={onClick}
      disabled={loading}
      className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-60"
      style={{ background: "var(--gradient-accent)" }}
    >
      {loading ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
      {loading ? "Saving..." : label}
    </motion.button>
  );
}

function SkeletonBlock({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-4">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-14 rounded-xl animate-pulse bg-white/5" />
      ))}
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  background:      "rgba(17,17,24,0.8)",
  backdropFilter:  "blur(20px)",
  border:          "1px solid rgba(255,255,255,0.07)",
};

// ─────────────────────────────────────────────────────────────────────────────
// ACCOUNT TAB
// ─────────────────────────────────────────────────────────────────────────────
function AccountTab() {
  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(false);
  const [name,     setName]     = useState("");
  const [email,    setEmail]    = useState("");

  useEffect(() => {
    fetch("/api/settings/account")
      .then((r) => r.json())
      .then((d) => { if (d.success) { setName(d.data.name ?? ""); setEmail(d.data.email ?? ""); } })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    const tid = toast.loading("Saving account settings...");
    try {
      const res  = await fetch("/api/settings/account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success("Account saved ✅", { id: tid });
      } else {
        toast.error(data.error ?? "Save failed", { id: tid });
      }
    } catch {
      toast.error("Network error", { id: tid });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <SkeletonBlock rows={4} />;

  return (
    <div className="space-y-5">
      <h3 className="text-base font-bold text-white" style={{ fontFamily: "var(--font-sora), sans-serif" }}>Account Settings</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <GlassInput label="Full Name"      value={name}  onChange={setName}  placeholder="Your name" />
        <GlassInput label="Email Address"  type="email"  value={email} onChange={setEmail} placeholder="you@example.com" />
      </div>
      <div className="pt-4 border-t border-white/[0.05]">
        <h4 className="text-sm font-semibold text-white/70 mb-2">Login Access Key</h4>
        <div className="rounded-xl p-4 border border-white/[0.06] flex items-start gap-3" style={{ background: "rgba(255,255,255,0.02)" }}>
          <ShieldCheck size={15} className="text-white/30 flex-shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="text-xs text-white/55 leading-relaxed">
              This app uses an <strong className="text-white/70">APP_ACCESS_KEY</strong> environment variable for login — not a username/password.
            </p>
            <p className="text-xs text-white/35 leading-relaxed">
              To change your login key, update <code className="text-red-400/80 bg-red-500/10 px-1 py-0.5 rounded text-[10px]">APP_ACCESS_KEY</code> in your Railway environment variables, then redeploy.
            </p>
          </div>
        </div>
      </div>
      <div className="flex justify-end pt-2">
        <SaveButton onClick={handleSave} loading={saving} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ACCOUNTS TAB  (multi-brand manager — list / add / edit / delete)
// ─────────────────────────────────────────────────────────────────────────────

interface BrandFormState {
  label:          string;
  ytClientId:     string;
  ytClientSecret: string;
  ytRefreshToken: string;
}

const emptyForm: BrandFormState = {
  label: "",
  ytClientId: "", ytClientSecret: "", ytRefreshToken: "",
};

function BrandForm({
  initial, onSubmit, onCancel, submitting, mode,
}: {
  initial: BrandFormState;
  onSubmit: (v: BrandFormState) => void;
  onCancel: () => void;
  submitting: boolean;
  mode: "add" | "edit";
}) {
  const [form, setForm] = useState<BrandFormState>(initial);
  const set = (k: keyof BrandFormState) => (v: string) => setForm((p) => ({ ...p, [k]: v }));

  return (
    <div className="rounded-2xl p-5 space-y-4 border border-white/[0.08]" style={{ background: "rgba(255,255,255,0.02)" }}>
      <GlassInput label="Account Label" value={form.label} onChange={set("label")} placeholder="e.g. Brand B" />

      <div className="pt-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-white/40 mb-2 flex items-center gap-1.5">
          <Youtube size={12} /> YouTube
        </p>
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <GlassInput label="Client ID"     value={form.ytClientId}     onChange={set("ytClientId")}     placeholder="Optional" />
            <GlassInput label="Client Secret" value={form.ytClientSecret} onChange={set("ytClientSecret")} placeholder="Optional" masked />
          </div>
          <GlassInput label="Refresh Token"   value={form.ytRefreshToken} onChange={set("ytRefreshToken")} placeholder="Optional" masked />
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <button
          onClick={onCancel}
          className="px-4 py-2.5 rounded-xl text-sm font-medium text-white/50 border border-white/[0.08] hover:text-white hover:border-white/20 transition-all"
        >
          Cancel
        </button>
        <motion.button
          whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
          onClick={() => { if (!form.label.trim()) { toast.error("Account label is required"); return; } onSubmit(form); }}
          disabled={submitting}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-60"
          style={{ background: "var(--gradient-accent)" }}
        >
          {submitting ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          {mode === "add" ? "Add Account" : "Save Changes"}
        </motion.button>
      </div>
    </div>
  );
}

function AccountsTab() {
  const { brandId, setBrand, refresh } = useSelectedBrand();
  const [brands,   setBrands]   = useState<BrandRecord[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [adding,   setAdding]   = useState(false);
  const [editId,   setEditId]   = useState<string | null>(null);
  const [busy,     setBusy]     = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch("/api/brands");
      const json = await res.json();
      const list: BrandRecord[] = Array.isArray(json) ? json : (json?.data ?? []);
      setBrands(list);
    } catch {
      toast.error("Could not load accounts");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const formToBody = (f: BrandFormState) => ({
    label:          f.label.trim(),
    ytClientId:     f.ytClientId.trim()     || undefined,
    ytClientSecret: f.ytClientSecret.trim() || undefined,
    ytRefreshToken: f.ytRefreshToken.trim() || undefined,
  });

  const handleAdd = async (f: BrandFormState) => {
    setBusy(true);
    const tid = toast.loading("Adding account…");
    try {
      const res  = await fetch("/api/brands", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formToBody(f)),
      });
      const data = await res.json();
      if (res.ok && (data.id || data.data?.id)) {
        toast.success("Account added ✅", { id: tid });
        setAdding(false);
        await load();
        refresh();
      } else {
        toast.error(data.error ?? "Failed to add account", { id: tid });
      }
    } catch {
      toast.error("Network error", { id: tid });
    } finally {
      setBusy(false);
    }
  };

  const handleEdit = async (id: string, f: BrandFormState) => {
    setBusy(true);
    const tid = toast.loading("Saving…");
    try {
      const res  = await fetch(`/api/brands/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formToBody(f)),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        toast.success("Account updated ✅", { id: tid });
        setEditId(null);
        await load();
        refresh();
      } else {
        toast.error(data.error ?? "Update failed", { id: tid });
      }
    } catch {
      toast.error("Network error", { id: tid });
    } finally {
      setBusy(false);
    }
  };

  const handleToggleActive = async (b: BrandRecord) => {
    const tid = toast.loading(b.active ? "Disabling…" : "Enabling…");
    try {
      const res = await fetch(`/api/brands/${b.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !b.active }),
      });
      if (res.ok) {
        toast.success(b.active ? "Account disabled" : "Account enabled", { id: tid });
        await load();
        refresh();
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Could not update", { id: tid });
      }
    } catch {
      toast.error("Network error", { id: tid });
    }
  };

  const handleDelete = async (b: BrandRecord) => {
    if (b.isPrimary) { toast.error("The primary account cannot be deleted"); return; }
    if (!window.confirm(`Delete "${b.label}"? This cannot be undone.`)) return;
    const tid = toast.loading("Deleting…");
    try {
      const res = await fetch(`/api/brands/${b.id}`, { method: "DELETE" });
      if (res.ok) {
        toast.success("Account deleted", { id: tid });
        if (brandId === b.id) setBrand(brands.find((x) => x.isPrimary)?.id ?? "");
        await load();
        refresh();
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Delete failed (the primary account cannot be deleted)", { id: tid });
      }
    } catch {
      toast.error("Network error", { id: tid });
    }
  };

  if (loading) return <SkeletonBlock rows={4} />;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-bold text-white" style={{ fontFamily: "var(--font-sora), sans-serif" }}>Accounts</h3>
          <p className="text-xs text-white/40 mt-0.5">
            Manage the YouTube channels (brands) this dashboard controls.
          </p>
        </div>
        {!adding && (
          <motion.button
            whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
            onClick={() => { setEditId(null); setAdding(true); }}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white"
            style={{ background: "var(--gradient-accent)" }}
          >
            <Plus size={15} /> Add Account
          </motion.button>
        )}
      </div>

      {adding && (
        <BrandForm
          mode="add"
          initial={emptyForm}
          submitting={busy}
          onSubmit={handleAdd}
          onCancel={() => setAdding(false)}
        />
      )}

      <div className="space-y-3">
        {brands.map((b) => (
          <div key={b.id}>
            <div
              className={cn(
                "rounded-2xl p-4 border flex items-center gap-4 transition-all",
                brandId === b.id ? "border-brand/30" : "border-white/[0.07]",
              )}
              style={{ background: "rgba(255,255,255,0.02)" }}
            >
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand/30 to-brand-light/20 flex items-center justify-center flex-shrink-0">
                <Building2 size={18} className="text-brand" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-white truncate">{b.label}</p>
                  {b.isPrimary && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-brand/15 text-brand border border-brand/20">Primary</span>
                  )}
                  {brandId === b.id && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">Selected</span>
                  )}
                  {!b.active && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-white/[0.06] text-white/40">Disabled</span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-3 mt-1">
                  <span className="flex items-center gap-1 text-[11px] text-white/40">
                    <Youtube size={10} /> {b.ytChannelTitle || (b.hasYouTube ? "connected" : "—")}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {brandId !== b.id && (
                  <button
                    onClick={() => setBrand(b.id)}
                    className="px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-white/50 border border-white/[0.08] hover:text-white hover:border-white/20 transition-all"
                  >
                    Select
                  </button>
                )}
                <button
                  onClick={() => handleToggleActive(b)}
                  disabled={b.isPrimary}
                  title={b.isPrimary ? "The primary account is always active" : (b.active ? "Disable" : "Enable")}
                  className="px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-white/50 border border-white/[0.08] hover:text-white hover:border-white/20 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  {b.active ? "Disable" : "Enable"}
                </button>
                <button
                  onClick={() => { setAdding(false); setEditId(editId === b.id ? null : b.id); }}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-white/40 border border-white/[0.08] hover:text-white hover:border-white/20 transition-all"
                  title="Edit"
                >
                  <RotateCw size={13} />
                </button>
                {!b.isPrimary && (
                  <button
                    onClick={() => handleDelete(b)}
                    className="w-8 h-8 rounded-lg flex items-center justify-center text-red-400/60 border border-red-500/10 hover:text-red-400 hover:border-red-500/30 transition-all"
                    title="Delete"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            </div>

            {editId === b.id && (
              <div className="mt-2">
                <BrandForm
                  mode="edit"
                  submitting={busy}
                  initial={{
                    ...emptyForm,
                    label:      b.label,
                    // Secrets are never returned by the API — leave blank; only
                    // non-empty fields are sent on save so existing creds persist.
                  }}
                  onSubmit={(f) => handleEdit(b.id, f)}
                  onCancel={() => setEditId(null)}
                />
                <p className="text-[11px] text-white/30 mt-1.5 px-1">
                  Leave credential fields blank to keep the existing values. The primary account resolves its credentials from environment variables.
                </p>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AI CONFIG TAB
// ─────────────────────────────────────────────────────────────────────────────
const PROVIDER_LABEL: Record<AIProvider, string> = { groq: "🤖 Groq", cerebras: "⚡ Cerebras", gemini: "✨ Gemini" };

/**
 * Editor for ONE task lane's provider + primary model + ordered fallback chain.
 * accent "purple" for content/reply lanes, "cyan" for the vision lane.
 */
function LaneEditor({
  title, subtitle, accent, kind, chain, onChange,
}: {
  title: string;
  subtitle: string;
  accent: "purple" | "cyan";
  kind: LaneKind;
  chain: Chain;
  onChange: (next: Chain) => void;
}) {
  // Lane-aware catalog access (content/reply → MODEL_CATALOG; vision → VISION_CATALOG).
  const providers: AIProvider[] = kind === "vision" ? VISION_PROVIDERS : [...AI_PROVIDERS];
  const modelsFor = (p: AIProvider): string[] =>
    kind === "vision" ? (VISION_CATALOG[p]?.models ?? []) : MODEL_CATALOG[p].models;
  const labelFor = (p: AIProvider): string =>
    kind === "vision" ? (VISION_CATALOG[p]?.label ?? p) : MODEL_CATALOG[p].label;
  const resolveFor = (p: AIProvider, m: unknown): string =>
    kind === "vision" ? resolveVisionModel(p, m) : resolveModel(p, m);
  const defaultChain = (p: AIProvider): Chain =>
    kind === "vision" ? defaultVisionChainFor(p) : defaultChainFor(p);

  // Changing the PRIMARY provider RE-SEEDS the whole lane from its default chain.
  const pickPrimaryProvider = (p: AIProvider) => onChange(defaultChain(p));
  const setPrimaryModel = (m: string) => onChange({ ...chain, model: m });
  const resetToDefault = () => onChange(defaultChain(chain.provider));

  const setFbProvider = (i: number, p: AIProvider) =>
    onChange({ ...chain, fallbacks: chain.fallbacks.map((x, idx) => idx === i ? { provider: p, model: resolveFor(p, x.model) } : x) });
  const setFbModel = (i: number, m: string) =>
    onChange({ ...chain, fallbacks: chain.fallbacks.map((x, idx) => idx === i ? { ...x, model: m } : x) });
  const addFallback = () => {
    const p = providers[0];
    onChange({ ...chain, fallbacks: [...chain.fallbacks, { provider: p, model: resolveFor(p, undefined) }] });
  };
  const removeFallback = (i: number) =>
    onChange({ ...chain, fallbacks: chain.fallbacks.filter((_, idx) => idx !== i) });
  const moveFallback = (i: number, dir: -1 | 1) => {
    const j = i + dir; if (j < 0 || j >= chain.fallbacks.length) return;
    const next = [...chain.fallbacks]; [next[i], next[j]] = [next[j], next[i]];
    onChange({ ...chain, fallbacks: next });
  };

  const tint =
    accent === "purple"
      ? { background: "rgba(139,92,246,0.06)", border: "1px solid rgba(139,92,246,0.2)" }
      : { background: "rgba(6,182,212,0.06)", border: "1px solid rgba(6,182,212,0.2)" };
  const titleClass = accent === "purple" ? "text-purple-400" : "text-cyan-400";
  const activeBtn =
    accent === "purple"
      ? "bg-gradient-to-r from-purple-500/25 to-fuchsia-500/10 text-purple-200 border-purple-500/40"
      : "bg-gradient-to-r from-blue-500/25 to-cyan-500/10 text-cyan-200 border-cyan-500/40";

  return (
    <div className="rounded-xl p-4 space-y-3" style={tint}>
      <div className="flex items-center justify-between gap-2">
        <p className={cn("text-xs font-semibold uppercase tracking-wider", titleClass)}>{title}</p>
        <button onClick={resetToDefault}
          className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-lg border border-white/15 text-white/60 hover:text-white hover:border-white/30 transition">
          <RotateCcw size={11} /> Reset to default chain
        </button>
      </div>
      <p className="text-xs text-white/40">{subtitle}</p>

      {/* Primary provider buttons */}
      <div className="flex gap-3">
        {providers.map((p) => (
          <motion.button key={p} whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
            onClick={() => pickPrimaryProvider(p)}
            className={cn(
              "flex-1 py-2.5 rounded-xl text-sm font-semibold border transition-all",
              chain.provider === p ? activeBtn : "border-white/[0.08] text-white/40 hover:text-white/70",
            )}
          >
            {PROVIDER_LABEL[p]}
          </motion.button>
        ))}
      </div>

      {/* Primary model */}
      <GlassSelect
        label={`${labelFor(chain.provider)} Model (primary)`}
        value={chain.model}
        onChange={setPrimaryModel}
        options={modelsFor(chain.provider)}
      />

      {/* Fallback chain editor */}
      <div className="flex items-center justify-between pt-1">
        <p className="text-[11px] font-semibold text-white/50 uppercase tracking-wider">Fallback Chain</p>
        <button onClick={addFallback}
          className="text-xs px-2.5 py-1 rounded-lg border border-white/15 text-white/70 hover:text-white hover:border-white/30 transition">+ Add</button>
      </div>
      <p className="text-[11px] text-white/35 -mt-1">Tried in order if the primary fails or is rate-limited.</p>
      {chain.fallbacks.length === 0 && (
        <p className="text-[11px] text-white/30 italic">No fallbacks — only the primary is used.</p>
      )}
      {chain.fallbacks.map((f, i) => (
        <div key={i} className="flex items-center gap-2 rounded-lg p-2" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
          <span className="text-[10px] text-white/30 w-4 text-center">{i + 1}</span>
          <select value={f.provider} onChange={(e) => setFbProvider(i, e.target.value as AIProvider)}
            className="px-2 py-1.5 rounded-lg text-xs text-white outline-none" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}>
            {providers.map((p) => <option key={p} value={p} style={{ background: "#1a1a2e" }}>{labelFor(p)}</option>)}
          </select>
          <select value={f.model} onChange={(e) => setFbModel(i, e.target.value)}
            className="flex-1 px-2 py-1.5 rounded-lg text-xs text-white outline-none" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}>
            {modelsFor(f.provider).map((m) => <option key={m} value={m} style={{ background: "#1a1a2e" }}>{m}</option>)}
          </select>
          <button onClick={() => moveFallback(i, -1)} disabled={i === 0} className="text-white/40 hover:text-white disabled:opacity-20 px-1">↑</button>
          <button onClick={() => moveFallback(i, 1)} disabled={i === chain.fallbacks.length - 1} className="text-white/40 hover:text-white disabled:opacity-20 px-1">↓</button>
          <button onClick={() => removeFallback(i)} className="text-red-400/70 hover:text-red-400 px-1">✕</button>
        </div>
      ))}
    </div>
  );
}

function AiTab() {
  const [loading,       setLoading]       = useState(true);
  const [saving,        setSaving]        = useState(false);
  const [defaultTone,   setDefaultTone]   = useState("Friendly");
  const [defaultType,   setDefaultType]   = useState("Educational");
  const [language,      setLanguage]      = useState("English");
  const [geminiApiKey,  setGeminiApiKey]  = useState("");
  const [cerebrasApiKey, setCerebrasApiKey] = useState("");

  // Three per-task lanes.
  const [contentChain, setContentChain] = useState<Chain>(() => defaultChainFor("groq"));
  const [replyChain,   setReplyChain]   = useState<Chain>(() => defaultChainFor("groq"));
  const [visionChain,  setVisionChain]  = useState<Chain>(() => defaultVisionChainFor("gemini"));

  // Normalize a stored chain (content/reply) into a valid Chain, falling back to a default.
  const loadChain = (raw: any, fallbackProvider: AIProvider): Chain => {
    if (!raw || typeof raw !== "object") return defaultChainFor(fallbackProvider);
    const provider = normalizeProvider(raw.provider);
    const model = resolveModel(provider, raw.model);
    const fallbacks = Array.isArray(raw.fallbacks)
      ? raw.fallbacks.map((f: any) => { const p = normalizeProvider(f?.provider); return { provider: p, model: resolveModel(p, f?.model) }; })
      : [];
    return { provider, model, fallbacks };
  };

  // Normalize a stored VISION chain; vision providers must be ∈ VISION_PROVIDERS.
  const loadVisionChain = (raw: any): Chain => {
    if (!raw || typeof raw !== "object") return defaultVisionChainFor("gemini");
    let provider = normalizeProvider(raw.provider);
    if (!VISION_PROVIDERS.includes(provider)) provider = "gemini";
    const model = resolveVisionModel(provider, raw.model);
    const fallbacks = (Array.isArray(raw.fallbacks) ? raw.fallbacks : [])
      .map((f: any) => { let p = normalizeProvider(f?.provider); if (!VISION_PROVIDERS.includes(p)) p = "gemini"; return { provider: p, model: resolveVisionModel(p, f?.model) }; });
    return { provider, model, fallbacks };
  };

  useEffect(() => {
    fetch("/api/settings/ai")
      .then((r) => r.json())
      .then((d) => {
        if (d.success) {
          setDefaultTone(d.data.defaultTone ?? "Friendly");
          setDefaultType(d.data.defaultType ?? "Educational");
          setLanguage(d.data.language       ?? "English");
          setContentChain(loadChain(d.data.contentChain, "groq"));
          setReplyChain(loadChain(d.data.replyChain, "groq"));
          setVisionChain(loadVisionChain(d.data.visionChain));
          setGeminiApiKey(d.data.geminiApiKey     ?? "");
          setCerebrasApiKey(d.data.cerebrasApiKey ?? "");
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    const tid = toast.loading("Saving AI preferences...");
    try {
      const res  = await fetch("/api/settings/ai", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ defaultTone, defaultType, language, contentChain, replyChain, visionChain, geminiApiKey, cerebrasApiKey }),
      });
      const data = await res.json();
      if (data.success) toast.success("AI Config saved ✅", { id: tid });
      else              toast.error(data.error ?? "Save failed", { id: tid });
    } catch {
      toast.error("Network error", { id: tid });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <SkeletonBlock rows={3} />;

  const tones = ["Friendly", "Professional", "Engaging", "Educational", "Casual", "Urgent"];
  const types  = ["Educational", "Knowledge Quiz", "Pro Tip", "Story / Example", "Myth-Fact", "Carousel", "How-To / Tips", "CTA"];
  const langs  = ["English", "Arabic", "Hindi", "Spanish", "French", "German"];

  return (
    <div className="space-y-5">
      <h3 className="text-base font-bold text-white" style={{ fontFamily: "var(--font-sora), sans-serif" }}>AI Configuration</h3>
      <p className="text-xs text-white/40 -mt-3">
        Configure each task lane independently — pick its primary provider + model and an ordered fallback chain.
        Switching a lane&apos;s primary provider auto-seeds a sensible default chain you can then tweak.
      </p>

      {/* ── Lane 1: Content generation ── */}
      <LaneEditor
        title="Content generation"
        subtitle="Powers post/caption/hook/script generation. Pick the provider, primary model, and fallback order."
        accent="purple"
        kind="content"
        chain={contentChain}
        onChange={setContentChain}
      />

      {/* ── Lane 2: Comment reply ── */}
      <LaneEditor
        title="YouTube comment reply"
        subtitle="Powers automated YouTube comment replies. Often a fast/cheap model with reliable fallbacks."
        accent="purple"
        kind="content"
        chain={replyChain}
        onChange={setReplyChain}
      />

      {/* ── Lane 3: Vision (image / video analysis) ── */}
      <LaneEditor
        title="Vision — image & video analysis"
        subtitle="Used when you upload media so the AI LOOKS at the image/video to write the caption. Gemini handles images + video; Groq (Qwen 3.8) handles images."
        accent="cyan"
        kind="vision"
        chain={visionChain}
        onChange={setVisionChain}
      />

      {/* ── Provider API keys ── */}
      <div className="rounded-xl p-4 space-y-3 border border-white/[0.06]" style={{ background: "rgba(255,255,255,0.02)" }}>
        <p className="text-xs font-semibold text-white/50 uppercase tracking-wider">Provider API Keys</p>
        <p className="text-[11px] text-white/35 -mt-1">Needed for any provider used above. Env vars (<code className="text-white/40">GEMINI_API_KEY</code>, <code className="text-white/40">CEREBRAS_API_KEY</code>) take priority over these. Groq uses <code className="text-white/40">GROK_API_KEY</code> (env only).</p>
        <GlassInput label="Gemini API Key"   value={geminiApiKey}   onChange={setGeminiApiKey}   placeholder="AIzaSy..." masked />
        <GlassInput label="Cerebras API Key" value={cerebrasApiKey} onChange={setCerebrasApiKey} placeholder="csk-..."   masked />
      </div>

      <div className="space-y-5">
        <div>
          <label className="text-xs font-medium text-white/40 block mb-2.5 uppercase tracking-wider">Default Tone</label>
          <div className="flex flex-wrap gap-2">
            {tones.map((t) => (
              <motion.button key={t} whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}
                onClick={() => setDefaultTone(t)}
                className={cn("px-3.5 py-2 rounded-full text-xs font-semibold border transition-all",
                  defaultTone === t
                    ? "bg-gradient-to-r from-brand/20 to-brand-light/10 text-brand-light border-brand/30"
                    : "border-white/[0.08] text-white/40 hover:text-white/70 hover:border-white/20"
                )}
              >
                {t}
              </motion.button>
            ))}
          </div>
        </div>

        <GlassSelect label="Default Post Type" value={defaultType} onChange={setDefaultType} options={types} />
        <GlassSelect label="Content Language"  value={language}    onChange={setLanguage}    options={langs} />

        <div className="rounded-xl p-4 border border-white/[0.06]" style={{ background: "rgba(255,255,255,0.02)" }}>
          <p className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-2">Current Defaults</p>
          <div className="flex flex-wrap gap-2">
            {[
              { label: "Content",  value: `${MODEL_CATALOG[contentChain.provider].label} · ${contentChain.model}` },
              { label: "Reply",    value: `${MODEL_CATALOG[replyChain.provider].label} · ${replyChain.model}` },
              { label: "Vision",   value: `${VISION_CATALOG[visionChain.provider]?.label ?? visionChain.provider} · ${visionChain.model}` },
              { label: "Tone",     value: defaultTone },
              { label: "Type",     value: defaultType },
              { label: "Language", value: language    },
            ].map((item) => (
              <span key={item.label} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border border-white/10 text-white/60" style={{ background: "rgba(255,255,255,0.03)" }}>
                <span className="text-white/30">{item.label}:</span>
                <span className="font-semibold text-white/80">{item.value}</span>
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="flex justify-end pt-2">
        <SaveButton onClick={handleSave} loading={saving} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AI PROMPTS TAB
// ─────────────────────────────────────────────────────────────────────────────
const POST_TYPES_META = [
  { id: "EDUCATIONAL",      label: "Educational",       emoji: "📚" },
  { id: "QUIZ",             label: "Quiz",              emoji: "❓" },
  { id: "CAROUSEL",         label: "Carousel",          emoji: "🖼️" },
  { id: "MYTH_FACT",        label: "Myth vs Fact",      emoji: "⚖️" },
  { id: "PRO_TIP",   label: "Pro Tip",           emoji: "💎" },
  { id: "CASE_STUDY",       label: "Story / Example",   emoji: "🔬" },
  { id: "IMAGE_QUIZ", label: "Image Quiz",        emoji: "🖼️" },
  { id: "KNOWLEDGE_QUIZ",         label: "Knowledge Quiz",    emoji: "📈" },
  { id: "PREVENTIVE",       label: "How-To / Tips",     emoji: "🛡️" },
  { id: "CTA",              label: "CTA",               emoji: "📣" },
];

function PromptsTab() {
  const { brandId, isAll, selected: selectedBrand } = useSelectedBrand();
  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(false);
  const [selected, setSelected] = useState("EDUCATIONAL");
  const [defaults, setDefaults] = useState<Record<string, string>>({});
  const [saved,    setSaved]    = useState<Record<string, string>>({});
  const [draft,    setDraft]    = useState<Record<string, string>>({});

  // Per-account default content prompts (saved through this same route).
  const [ytDefaultPrompt, setYtDefaultPrompt] = useState("");
  const [savedYtDefault,  setSavedYtDefault]  = useState("");
  const [savingDefaults,  setSavingDefaults]  = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(withBrand("/api/settings/prompts", brandId))
      .then((r) => r.json())
      .then((d) => {
        if (d.success) {
          setDefaults(d.data.defaults ?? {});
          setSaved(d.data.saved ?? {});
          setDraft(d.data.saved ?? {});
          const yt = d.data.ytDefaultPrompt ?? "";
          setYtDefaultPrompt(yt); setSavedYtDefault(yt);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [brandId]);

  const currentText  = draft[selected] ?? "";
  const defaultHint  = defaults[selected] ?? "";
  const isCustomized = !!saved[selected];
  const isDirty      = (draft[selected] ?? "") !== (saved[selected] ?? "");

  const handleSave = async () => {
    setSaving(true);
    const tid = toast.loading("Saving prompt...");
    try {
      const res  = await fetch(withBrand("/api/settings/prompts", brandId), {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ prompts: { [selected]: draft[selected] ?? "" } }),
      });
      const data = await res.json();
      if (data.success) {
        setSaved(data.data?.saved ?? data.data);
        setDraft(data.data?.saved ?? data.data);
        toast.success("Prompt saved ✅", { id: tid });
      } else {
        toast.error(data.error ?? "Save failed", { id: tid });
      }
    } catch {
      toast.error("Network error", { id: tid });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveDefaults = async () => {
    setSavingDefaults(true);
    const tid = toast.loading("Saving default prompts...");
    try {
      const res  = await fetch(withBrand("/api/settings/prompts", brandId), {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ ytDefaultPrompt }),
      });
      const data = await res.json();
      if (data.success) {
        setSavedYtDefault(ytDefaultPrompt);
        toast.success("Default prompts saved ✅", { id: tid });
      } else {
        toast.error(data.error ?? "Save failed", { id: tid });
      }
    } catch {
      toast.error("Network error", { id: tid });
    } finally {
      setSavingDefaults(false);
    }
  };

  const handleReset = async () => {
    // Clear override for this type (send empty string)
    setSaving(true);
    const tid = toast.loading("Resetting to default...");
    try {
      const res  = await fetch(withBrand("/api/settings/prompts", brandId), {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ prompts: { [selected]: "" } }),
      });
      const data = await res.json();
      if (data.success) {
        setSaved(data.data?.saved ?? data.data);
        setDraft((prev) => { const n = { ...prev }; delete n[selected]; return n; });
        toast.success("Reset to default ✅", { id: tid });
      } else {
        toast.error(data.error ?? "Reset failed", { id: tid });
      }
    } catch {
      toast.error("Network error", { id: tid });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <SkeletonBlock rows={5} />;

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-bold text-white" style={{ fontFamily: "var(--font-sora), sans-serif" }}>AI Prompt Editor</h3>
        <p className="text-xs text-white/35 mt-1 leading-relaxed">
          Customize the system instructions for each post type. Your prompt is appended after the base brand voice context. Leave blank to use the built-in default.
        </p>
        <p className="text-[11px] text-white/30 mt-1">
          Editing for:{" "}
          <span className="text-white/60 font-medium">
            {isAll ? "Primary (aggregate view cannot edit per-account)" : selectedBrand?.label ?? "Primary"}
          </span>
        </p>
      </div>

      {/* Per-account default content prompts */}
      <div className="rounded-2xl border border-white/[0.07] p-5 space-y-4" style={{ background: "rgba(255,255,255,0.02)" }}>
        <div>
          <h4 className="text-sm font-semibold text-white flex items-center gap-2">
            <Sparkles size={14} className="text-yellow-400" /> Default Content Prompts (this account)
          </h4>
          <p className="text-[11px] text-white/35 mt-1">
            Used as the default instruction when generating content for this account.
          </p>
        </div>
        <div>
          <label className="text-xs font-medium text-white/40 block mb-1.5 uppercase tracking-wider flex items-center gap-1.5">
            <Youtube size={11} /> YouTube default prompt
          </label>
          <textarea
            value={ytDefaultPrompt}
            onChange={(e) => setYtDefaultPrompt(e.target.value)}
            placeholder="e.g. Script punchy vertical Shorts with a strong hook in the first 2 seconds…"
            rows={3}
            className="w-full px-4 py-3 rounded-xl text-sm text-white placeholder-white/25 outline-none resize-y"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
          />
        </div>
        <div className="flex justify-end">
          <SaveButton onClick={handleSaveDefaults} loading={savingDefaults} label="Save Default Prompts" />
        </div>
      </div>

      {/* Type selector */}
      <div className="flex flex-wrap gap-2">
        {POST_TYPES_META.map((pt) => {
          const hasCustom = !!saved[pt.id];
          return (
            <motion.button
              key={pt.id}
              whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}
              onClick={() => setSelected(pt.id)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all",
                selected === pt.id
                  ? "bg-gradient-to-r from-brand/20 to-brand-light/10 text-white border-brand/30"
                  : "border-white/[0.08] text-white/40 hover:text-white/70 hover:border-white/20",
              )}
            >
              <span>{pt.emoji}</span>
              {pt.label}
              {hasCustom && (
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" title="Custom prompt active" />
              )}
            </motion.button>
          );
        })}
      </div>

      {/* Editor panel */}
      <div className="rounded-xl border border-white/[0.07] overflow-hidden" style={{ background: "rgba(255,255,255,0.02)" }}>
        {/* Editor header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-white">
              {POST_TYPES_META.find((p) => p.id === selected)?.emoji}{" "}
              {POST_TYPES_META.find((p) => p.id === selected)?.label}
            </span>
            {isCustomized ? (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/25 text-emerald-400 font-medium">
                Custom active
              </span>
            ) : (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-white/35 font-medium">
                Using default
              </span>
            )}
          </div>
          {isCustomized && (
            <motion.button
              whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}
              onClick={handleReset}
              disabled={saving}
              className="flex items-center gap-1.5 text-xs text-white/40 hover:text-red-400 transition-colors px-2 py-1 rounded-lg border border-white/[0.06] hover:border-red-500/30"
            >
              <RotateCw size={11} />
              Reset to default
            </motion.button>
          )}
        </div>

        {/* Textarea */}
        <div className="p-4">
          <textarea
            value={currentText}
            onChange={(e) => setDraft((prev) => ({ ...prev, [selected]: e.target.value }))}
            rows={10}
            placeholder={`System default for ${POST_TYPES_META.find((p) => p.id === selected)?.label}:\n\n${defaultHint}\n\nType your custom instructions here to override...`}
            className="w-full text-sm text-white/80 leading-relaxed resize-y outline-none rounded-lg px-4 py-3 placeholder-white/20"
            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", minHeight: 200, fontFamily: "monospace" }}
            onFocus={(e) => { e.target.style.borderColor = "rgb(var(--accent-rgb) / 0.4)"; }}
            onBlur={(e)  => { e.target.style.borderColor = "rgba(255,255,255,0.06)"; }}
          />
          <p className="text-[11px] text-white/25 mt-2 leading-relaxed">
            Your instructions are appended after the base brand voice context. Use plain English  -  describe exactly what format, length, and style you want for this post type.
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between pt-1">
        <button
          onClick={() => setDraft((prev) => ({ ...prev, [selected]: saved[selected] ?? "" }))}
          disabled={!isDirty}
          className="text-xs text-white/30 hover:text-white/60 transition-colors disabled:opacity-30"
        >
          Discard changes
        </button>
        <SaveButton onClick={handleSave} loading={saving} label={isDirty ? "Save Prompt" : "Saved"} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AUTO-POST TAB
// ─────────────────────────────────────────────────────────────────────────────
const ALL_POST_TYPES = [
  { id: "EDUCATIONAL",      label: "Educational",    emoji: "📚" },
  { id: "QUIZ",             label: "Quiz",           emoji: "❓" },
  { id: "CAROUSEL",         label: "Carousel",       emoji: "🖼️" },
  { id: "MYTH_FACT",        label: "Myth vs Fact",   emoji: "⚖️" },
  { id: "PRO_TIP",   label: "Pro Tip",        emoji: "💎" },
  { id: "CASE_STUDY",       label: "Story / Example",emoji: "🔬" },
  { id: "IMAGE_QUIZ", label: "Image Quiz",     emoji: "🖼️" },
  { id: "KNOWLEDGE_QUIZ",         label: "Knowledge Quiz", emoji: "📈" },
  { id: "PREVENTIVE",       label: "How-To / Tips",  emoji: "🛡️" },
  { id: "CTA",              label: "CTA",            emoji: "📣" },
];

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_FULL   = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// Per-weekday schedule entry shape (mirrors lib/preferences DayScheduleEntry).
type DayScheduleEntry = { day: number; enabled: boolean; postsPerDay: number; times: string[] };

/**
 * Per-weekday timing + post-count editor. 7 rows: weekday name, an enabled toggle,
 * a posts/day stepper, and an editable time list. A day with no entry uses the
 * global controls ("used when a day has no custom schedule").
 * Value is the dailySchedule array; onChange writes the full updated array.
 */
function DayScheduleEditor({
  value, onChange,
}: { value: DayScheduleEntry[]; onChange: (v: DayScheduleEntry[]) => void }) {
  const entryFor = (day: number) => value.find((e) => e.day === day) ?? null;

  const upsert = (day: number, patch: Partial<DayScheduleEntry>) => {
    const existing = entryFor(day);
    const base: DayScheduleEntry = existing ?? { day, enabled: true, postsPerDay: 1, times: [] };
    const next = { ...base, ...patch };
    const without = value.filter((e) => e.day !== day);
    onChange([...without, next].sort((a, b) => a.day - b.day));
  };

  const removeDay = (day: number) => onChange(value.filter((e) => e.day !== day));

  const addTime = (day: number, t: string) => {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) return;
    const e = entryFor(day);
    const times = e ? e.times : [];
    if (times.includes(t)) return;
    upsert(day, { times: [...times, t].sort() });
  };

  const removeTime = (day: number, t: string) => {
    const e = entryFor(day);
    if (!e) return;
    upsert(day, { times: e.times.filter((x) => x !== t) });
  };

  return (
    <div className="space-y-2">
      {DAY_FULL.map((name, day) => {
        const e = entryFor(day);
        const active = !!e;
        return (
          <DayScheduleRow
            key={day}
            name={name}
            entry={e}
            active={active}
            onToggleActive={() => (active ? removeDay(day) : upsert(day, {}))}
            onToggleEnabled={(v) => upsert(day, { enabled: v })}
            onSetPosts={(n) => upsert(day, { postsPerDay: n })}
            onAddTime={(t) => addTime(day, t)}
            onRemoveTime={(t) => removeTime(day, t)}
          />
        );
      })}
    </div>
  );
}

function DayScheduleRow({
  name, entry, active,
  onToggleActive, onToggleEnabled, onSetPosts, onAddTime, onRemoveTime,
}: {
  name: string;
  entry: DayScheduleEntry | null;
  active: boolean;
  onToggleActive: () => void;
  onToggleEnabled: (v: boolean) => void;
  onSetPosts: (n: number) => void;
  onAddTime: (t: string) => void;
  onRemoveTime: (t: string) => void;
}) {
  const [newTime, setNewTime] = useState("12:00");
  const dayOn = entry?.enabled ?? true;
  return (
    <div className={cn(
      "rounded-xl p-3 border transition-all",
      active ? "border-brand/25 bg-brand/[0.03]" : "border-white/[0.06] bg-white/[0.01]"
    )}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <button
            onClick={onToggleActive}
            className={cn(
              "px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-all",
              active ? "border-brand/40 text-brand-light bg-brand/10"
                     : "border-white/[0.1] text-white/40 hover:text-white/70"
            )}
          >
            {active ? "Custom" : "Use global"}
          </button>
          <span className="text-sm font-medium text-white/80">{name}</span>
        </div>
        {active && (
          // Prominent per-day ON/OFF switch. OFF → this weekday generates nothing
          // (resolveDaySchedule returns null for a disabled custom day).
          <button
            onClick={() => onToggleEnabled(!dayOn)}
            className={cn(
              "px-3 py-1 rounded-lg text-[11px] font-bold border transition-all tracking-wide",
              dayOn ? "border-emerald-500/40 text-emerald-300 bg-emerald-500/10"
                    : "border-white/[0.12] text-white/40 hover:text-white/70"
            )}
            aria-pressed={dayOn}
            title={dayOn ? "Publishing ON this day — click to turn off" : "Publishing OFF this day — click to turn on"}
          >
            {dayOn ? "ON" : "OFF"}
          </button>
        )}
      </div>

      {active && (entry?.enabled ?? true) && (
        <div className="mt-3 space-y-3 pl-1">
          <div>
            <label className="text-[11px] font-medium text-white/35 block mb-1.5 uppercase tracking-wider">Posts</label>
            <div className="flex gap-2">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  onClick={() => onSetPosts(n)}
                  className={cn(
                    "w-9 h-9 rounded-lg text-xs font-bold border transition-all",
                    (entry?.postsPerDay ?? 1) === n
                      ? "bg-gradient-to-br from-brand/30 to-brand-light/20 text-white border-brand/40"
                      : "border-white/[0.08] text-white/40 hover:text-white hover:border-white/20"
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-[11px] font-medium text-white/35 block mb-1.5 uppercase tracking-wider">
              Times ({entry?.times.length ?? 0})
            </label>
            <div className="flex flex-wrap gap-2 mb-2">
              {(entry?.times ?? []).map((t) => (
                <span key={t} className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-mono border border-white/10 text-white/80" style={{ background: "rgba(255,255,255,0.04)" }}>
                  <Clock size={11} className="text-brand" />
                  {t}
                  <button onClick={() => onRemoveTime(t)} className="text-white/30 hover:text-red-400 transition-colors">
                    <X size={10} />
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                type="time"
                value={newTime}
                onChange={(ev) => setNewTime(ev.target.value)}
                className="px-3 py-1.5 rounded-lg text-xs text-white outline-none font-mono"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", colorScheme: "dark" }}
              />
              <button
                onClick={() => onAddTime(newTime)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-white border border-white/[0.12] hover:border-brand/40 hover:text-brand-light transition-all flex items-center gap-1"
              >
                <Plus size={12} /> Add
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// APPEARANCE TAB — pick one of 10 app-wide themes (persists via next-themes)
// ─────────────────────────────────────────────────────────────────────────────
function AppearanceTab() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const active = mounted ? (theme ?? "crimson") : "crimson";

  return (
    <div className="space-y-5">
      <h3 className="text-base font-bold text-white" style={{ fontFamily: "var(--font-sora), sans-serif" }}>Appearance</h3>
      <p className="text-xs text-white/40 -mt-2">Pick a theme — it applies across the whole app instantly and is remembered on this device.</p>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {THEMES.map((t) => {
          const selected = active === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTheme(t.id)}
              className={cn(
                "relative rounded-xl p-3 text-left border transition-all",
                selected ? "border-white/40 ring-1 ring-white/30" : "border-white/[0.08] hover:border-white/20"
              )}
              style={{ background: t.bg }}
            >
              <div className="flex items-center gap-1.5 mb-2">
                {t.swatch.map((c, i) => (
                  <span key={i} className="h-5 w-5 rounded-full" style={{ background: c, boxShadow: i === 0 ? `0 0 10px ${c}88` : undefined }} />
                ))}
              </div>
              <div className="text-xs font-semibold text-white/90">{t.label}</div>
              {selected && <span className="absolute top-2 right-2 text-[10px] text-white/80">✓</span>}
            </button>
          );
        })}
      </div>

      <div className="rounded-xl p-4 border border-white/[0.06]" style={{ background: "rgb(var(--surface-rgb))" }}>
        <p className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-2">Live preview</p>
        <div className="flex flex-wrap items-center gap-3">
          <span className="px-3 py-1.5 rounded-full text-xs font-semibold text-white" style={{ background: "var(--gradient-accent)" }}>Accent button</span>
          <span className="px-3 py-1.5 rounded-full text-xs font-semibold" style={{ background: "rgb(var(--accent-rgb) / 0.15)", color: "rgb(var(--accent-2-rgb))", border: "1px solid rgb(var(--accent-rgb) / 0.3)" }}>Badge</span>
          <span className="text-sm font-bold" style={{ background: "var(--gradient-accent)", WebkitBackgroundClip: "text", backgroundClip: "text", WebkitTextFillColor: "transparent" }}>Gradient text</span>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// NOTIFICATIONS TAB
// ─────────────────────────────────────────────────────────────────────────────
function NotificationsTab() {
  const [loading,           setLoading]           = useState(true);
  const [saving,            setSaving]            = useState(false);
  const [notificationEmail, setNotificationEmail] = useState("");
  const [notifs,            setNotifs]            = useState({
    emailPublish: true, emailAnalytics: true, emailFails: true,
    pushPublish: false, pushComments: false, pushWeeklyReport: true,
  });

  useEffect(() => {
    fetch("/api/settings/notifications")
      .then((r) => r.json())
      .then((d) => {
        if (d.success) {
          const { notificationEmail: ne, ...rest } = d.data;
          setNotifs(rest);
          setNotificationEmail(ne ?? "");
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const set = (key: keyof typeof notifs) => (v: boolean) =>
    setNotifs((prev) => ({ ...prev, [key]: v }));

  const handleSave = async () => {
    setSaving(true);
    const tid = toast.loading("Saving notification preferences...");
    try {
      const res  = await fetch("/api/settings/notifications", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ ...notifs, notificationEmail }),
      });
      const data = await res.json();
      if (data.success) toast.success("Notification preferences saved ✅", { id: tid });
      else              toast.error(data.error ?? "Save failed", { id: tid });
    } catch {
      toast.error("Network error", { id: tid });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <SkeletonBlock rows={4} />;

  return (
    <div className="space-y-5">
      <h3 className="text-base font-bold text-white" style={{ fontFamily: "var(--font-sora), sans-serif" }}>Notification Preferences</h3>

      {/* Alert email address */}
      <div className="rounded-xl p-4 space-y-3" style={{ background: "rgba(239,68,68,0.05)", border: "1px solid rgba(239,68,68,0.15)" }}>
        <p className="text-xs font-semibold text-red-400 uppercase tracking-wider">🚨 Failure Alert Email</p>
        <GlassInput
          label="Recipient Email Address"
          type="email"
          value={notificationEmail}
          onChange={setNotificationEmail}
          placeholder="you@example.com"
        />
        <div className="text-[10px] text-white/35 leading-relaxed space-y-1">
          <p>Emails are sent via SMTP when: posts fail to publish, API rate limits hit, webhook goes down, or story fails.</p>
          <p>Configure SMTP in Railway env vars: <code className="text-red-300/70 bg-red-900/20 px-1 rounded">SMTP_HOST</code> <code className="text-red-300/70 bg-red-900/20 px-1 rounded">SMTP_USER</code> <code className="text-red-300/70 bg-red-900/20 px-1 rounded">SMTP_PASS</code></p>
          <p>For Gmail: use smtp.gmail.com + port 587 + an App Password (not your account password).</p>
        </div>
      </div>

      {/* Info banner */}
      <div className="rounded-xl p-3.5 border border-white/[0.06] flex items-start gap-3" style={{ background: "rgba(255,255,255,0.02)" }}>
        <AlertCircle size={14} className="text-white/30 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-xs text-white/50 leading-relaxed">
            Failure alerts are <strong className="text-white/70">active</strong> once SMTP is configured. Real-time in-app alerts appear in the notification bell (top-right) regardless.
          </p>
        </div>
      </div>

      <div>
        <p className="text-sm font-semibold text-white/50 mb-3">📧 Email Notifications</p>
        <div className="rounded-xl border border-white/[0.06] px-4" style={{ background: "rgba(255,255,255,0.02)" }}>
          <Toggle label="Post Published"    description="Get notified when a post goes live"   value={notifs.emailPublish}   onChange={set("emailPublish")} />
          <Toggle label="Analytics Reports" description="Weekly performance summaries"         value={notifs.emailAnalytics} onChange={set("emailAnalytics")} />
          <Toggle label="Publish Failures"  description="Alert when a post fails to publish"  value={notifs.emailFails}     onChange={set("emailFails")} />
        </div>
      </div>

      <div>
        <p className="text-sm font-semibold text-white/50 mb-3">🔔 Push Notifications <span className="text-[10px] font-medium text-amber-300/70 uppercase tracking-wider">(coming soon)</span></p>
        <p className="text-xs text-white/35 mb-3 leading-relaxed">Browser push notifications aren&apos;t active yet. These toggles are saved but have no effect until web-push support ships.</p>
        <div className="rounded-xl border border-white/[0.06] px-4" style={{ background: "rgba(255,255,255,0.02)" }}>
          <Toggle label="Post Published (coming soon)"  description="Browser push when post goes live"        value={notifs.pushPublish}      onChange={set("pushPublish")}      disabled />
          <Toggle label="New Comments (coming soon)"    description="When you receive YouTube comments"       value={notifs.pushComments}     onChange={set("pushComments")}     disabled />
          <Toggle label="Weekly Report (coming soon)"   description="Summary every Monday morning"           value={notifs.pushWeeklyReport} onChange={set("pushWeeklyReport")} disabled />
        </div>
      </div>

      <div className="flex justify-end pt-2">
        <SaveButton onClick={handleSave} loading={saving} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MORNING DIGEST TAB — pick exactly what goes into the once-a-day 24h summary email
// ─────────────────────────────────────────────────────────────────────────────
function MorningDigestTab() {
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [cfg, setCfg] = useState({
    enabled: false, sendTime: "08:00",
    ytInsights: true, ytComments: true, ytPublished: true, ytSubscribers: true,
    topContent: true, engagement: true, upcomingToday: true, failures: true,
    systemHealth: true, growthDeltas: true, aiUsage: false,
  });

  useEffect(() => {
    fetch("/api/settings/morning-digest")
      .then((r) => r.json())
      .then((d) => { if (d.success && d.data) setCfg((p) => ({ ...p, ...d.data })); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const set = (key: keyof typeof cfg) => (v: boolean) => setCfg((p) => ({ ...p, [key]: v }));

  const handleSave = async () => {
    setSaving(true);
    const tid = toast.loading("Saving morning digest…");
    try {
      const res  = await fetch("/api/settings/morning-digest", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cfg),
      });
      const data = await res.json();
      if (data.success) toast.success("Morning digest saved ✅", { id: tid });
      else              toast.error(data.error ?? "Save failed", { id: tid });
    } catch { toast.error("Network error", { id: tid }); }
    finally { setSaving(false); }
  };

  if (loading) return <SkeletonBlock rows={5} />;

  const card = "rounded-xl border border-white/[0.06] px-4";
  const cardBg = { background: "rgba(255,255,255,0.02)" };

  return (
    <div className="space-y-5">
      <h3 className="text-base font-bold text-white" style={{ fontFamily: "var(--font-sora), sans-serif" }}>Morning Digest</h3>
      <p className="text-xs text-white/40 leading-relaxed -mt-2">
        One email each morning summarising the <strong className="text-white/60">last 24 hours</strong> of your YouTube channel. Turn it on, pick a send time, and choose exactly what to include.
      </p>

      {/* Master + time */}
      <div className={card} style={cardBg}>
        <Toggle
          label="Send the Morning Digest"
          description="Master switch. When off, no digest email is sent."
          value={cfg.enabled}
          onChange={set("enabled")}
        />
        <div className="flex items-center justify-between py-3 border-t border-white/[0.04]">
          <div>
            <p className="text-sm text-white/80 font-medium">Send time (IST)</p>
            <p className="text-xs text-white/35 mt-0.5">Delivered once daily, in this hour.</p>
          </div>
          <input
            type="time"
            value={cfg.sendTime}
            onChange={(e) => setCfg((p) => ({ ...p, sendTime: e.target.value || "08:00" }))}
            className="px-3 py-2 rounded-lg text-sm text-white outline-none"
            style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}
          />
        </div>
      </div>

      {/* YouTube items */}
      <div>
        <p className="text-sm font-semibold text-white/50 mb-3">▶️ YouTube</p>
        <div className={card} style={cardBg}>
          <Toggle label="Insights (24h)"   description="Views, likes, comments on videos from the last 24h" value={cfg.ytInsights}    onChange={set("ytInsights")} />
          <Toggle label="New comments"      description="The actual comment text + author from the last 24h"  value={cfg.ytComments}    onChange={set("ytComments")} />
          <Toggle label="Published videos"  description="Shorts/videos that went live in the last 24h"        value={cfg.ytPublished}   onChange={set("ytPublished")} />
          <Toggle label="Subscribers"       description="Current subscriber count"                            value={cfg.ytSubscribers} onChange={set("ytSubscribers")} />
        </div>
      </div>

      {/* Cross-cutting items */}
      <div>
        <p className="text-sm font-semibold text-white/50 mb-3">✨ More</p>
        <div className={card} style={cardBg}>
          <Toggle label="Top performer"        description="Best video of the last 24h"                      value={cfg.topContent}    onChange={set("topContent")} />
          <Toggle label="Auto-engagement"      description="How many comments the bot replied to"            value={cfg.engagement}    onChange={set("engagement")} />
          <Toggle label="Scheduled for today"  description="What's queued to publish today"                  value={cfg.upcomingToday} onChange={set("upcomingToday")} />
          <Toggle label="Failures"             description="Any failed publishes/errors in the last 24h"     value={cfg.failures}      onChange={set("failures")} />
          <Toggle label="Growth vs prior day"  description="Subscriber change"                               value={cfg.growthDeltas}  onChange={set("growthDeltas")} />
          <Toggle label="System health"        description="API / webhook / quota status"                    value={cfg.systemHealth}  onChange={set("systemHealth")} />
          <Toggle label="AI usage"             description="AI generations + tokens used in the last 24h"    value={cfg.aiUsage}       onChange={set("aiUsage")} />
        </div>
      </div>

      <div className="flex justify-end pt-2">
        <SaveButton onClick={handleSave} loading={saving} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DANGER ZONE TAB
// ─────────────────────────────────────────────────────────────────────────────
function DangerTab() {
  const [busy, setBusy] = useState<string | null>(null);

  const confirm = (message: string) => window.confirm(message);

  const runAction = async (action: string, confirmMsg: string, successMsg: string) => {
    if (!confirm(confirmMsg)) return;
    setBusy(action);
    const tid = toast.loading("Processing...");
    try {
      const res  = await fetch("/api/settings/danger", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ action }),
      });
      const data = await res.json();
      if (data.success) {
        const count = data.data?.deleted ?? data.data?.cancelled ?? null;
        toast.success(`${successMsg}${count !== null ? ` (${count} items)` : ""}`, { id: tid });
      } else {
        toast.error(data.error ?? "Action failed", { id: tid });
      }
    } catch {
      toast.error("Network error", { id: tid });
    } finally {
      setBusy(null);
    }
  };

  const actions = [
    {
      id:          "delete-drafts",
      title:       "Delete All Drafts",
      description: "Permanently delete all draft posts. Published posts are not affected.",
      label:       "Delete Drafts",
      icon:        Trash2,
      confirm:     "Delete ALL draft posts? This cannot be undone.",
      success:     "All drafts deleted",
    },
    {
      id:          "delete-scheduled",
      title:       "Cancel All Scheduled Posts",
      description: "Cancel all pending scheduled posts and return them to Draft status.",
      label:       "Cancel Scheduled",
      icon:        Calendar,
      confirm:     "Cancel ALL pending scheduled posts?",
      success:     "Scheduled posts cancelled",
    },
    {
      id:          "clear-library",
      title:       "Clear Entire Content Library",
      description: "Permanently delete ALL posts (drafts, scheduled, and published records).",
      label:       "Clear Library",
      icon:        Trash2,
      confirm:     "⚠️ Delete ALL posts including published records? This cannot be undone.",
      success:     "Content library cleared",
    },
    {
      id:          "reset-ai",
      title:       "Reset AI Settings",
      description: "Reset all AI configuration preferences back to factory defaults.",
      label:       "Reset AI Config",
      icon:        RotateCcw,
      confirm:     "Reset all AI settings to defaults?",
      success:     "AI settings reset to defaults",
    },
    {
      id:          "clear-activity",
      title:       "Clear Activity Log",
      description: "Wipe all activity log entries. Useful for a fresh start.",
      label:       "Clear Log",
      icon:        Activity,
      confirm:     "Delete the entire activity log?",
      success:     "Activity log cleared",
    },
  ];

  return (
    <div className="space-y-5">
      <h3 className="text-base font-bold text-red-400" style={{ fontFamily: "var(--font-sora), sans-serif" }}>Danger Zone</h3>
      <p className="text-sm text-white/40 -mt-2">These actions are permanent and cannot be undone. A confirmation dialog will appear before each action.</p>

      <div className="space-y-3">
        {actions.map((item) => (
          <motion.div key={item.id}
            className="flex items-start justify-between gap-4 p-4 rounded-xl border border-red-500/15"
            style={{ background: "rgba(239,68,68,0.04)" }}
            whileHover={{ borderColor: "rgba(239,68,68,0.25)" }}
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-white/80">{item.title}</p>
              <p className="text-xs text-white/40 mt-0.5 leading-relaxed">{item.description}</p>
            </div>
            <motion.button
              whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
              disabled={busy === item.id}
              onClick={() => runAction(item.id, item.confirm, item.success)}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold text-red-400 border border-red-500/20 hover:bg-red-500/15 transition-all flex-shrink-0 disabled:opacity-50"
            >
              {busy === item.id ? <Loader2 size={12} className="animate-spin" /> : <item.icon size={12} />}
              {busy === item.id ? "Working..." : item.label}
            </motion.button>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// YOUTUBE TAB
// ─────────────────────────────────────────────────────────────────────────────
function YouTubeTab() {
  const { brandId } = useSelectedBrand();
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);

  const [enabled,           setEnabled]           = useState(false);
  const [privacy,           setPrivacy]           = useState("public");
  const [secondsPerImage,   setSecondsPerImage]   = useState(5);
  const [targetShortSeconds, setTargetShortSeconds] = useState<number>(DEFAULT_SHORT_SECONDS);
  const [postsPerDay,       setPostsPerDay]       = useState(1);
  const [descriptionSuffix, setDescriptionSuffix] = useState("");
  const [replyToComments,   setReplyToComments]   = useState(true);
  const [topics,            setTopics]            = useState<string[]>([]);
  const [postTypes,         setPostTypes]         = useState<string[]>(["EDUCATIONAL", "PRO_TIP", "PREVENTIVE"]);
  const [customPromptExtra, setCustomPromptExtra] = useState("");
  const [postTimes,         setPostTimes]         = useState<string[]>(["19:00"]);
  const [scheduleDays,      setScheduleDays]      = useState<number[]>([0, 1, 2, 3, 4, 5, 6]);
  const [voiceover,         setVoiceover]         = useState(false);
  const [voiceoverVoice,    setVoiceoverVoice]    = useState("daniel");
  const [burnCaptions,      setBurnCaptions]      = useState(false);
  const [dailySchedule,     setDailySchedule]     = useState<DayScheduleEntry[]>([]);
  const [customScheduleOnly, setCustomScheduleOnly] = useState(false);
  const [newTopic,          setNewTopic]          = useState("");
  const [newTime,           setNewTime]           = useState("19:00");
  const [status, setStatus] = useState<{ configured: boolean; ok: boolean; channel?: string; error?: string } | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch(withBrand("/api/settings/youtube", brandId))
      .then((r) => r.json())
      .then((d) => {
        if (d.success) {
          const cfg = d.data;
          setEnabled(cfg.enabled ?? false);
          setPrivacy(cfg.privacy ?? "public");
          setSecondsPerImage(cfg.secondsPerImage ?? 5);
          setTargetShortSeconds(normalizeShortSeconds(cfg.targetShortSeconds));
          setPostsPerDay(cfg.postsPerDay ?? 1);
          setDescriptionSuffix(cfg.descriptionSuffix ?? "");
          setReplyToComments(cfg.replyToComments ?? true);
          setTopics(cfg.topics ?? []);
          setPostTypes(cfg.postTypes ?? ["EDUCATIONAL", "PRO_TIP", "PREVENTIVE"]);
          setCustomPromptExtra(cfg.customPromptExtra ?? "");
          setPostTimes(cfg.postTimes ?? ["19:00"]);
          setScheduleDays(cfg.scheduleDays ?? [0, 1, 2, 3, 4, 5, 6]);
          setVoiceover(cfg.voiceover ?? false);
          setVoiceoverVoice(cfg.voiceoverVoice ?? "daniel");
          setBurnCaptions(cfg.burnCaptions ?? false);
          setDailySchedule(Array.isArray(cfg.dailySchedule) ? cfg.dailySchedule : []);
          setCustomScheduleOnly(cfg.customScheduleOnly ?? false);
          setStatus(d.status ?? null);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [brandId]);

  const toggleDay = (d: number) =>
    setScheduleDays((prev) => prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort((a, b) => a - b));

  const toggleType = (id: string) =>
    setPostTypes((prev) => prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]);

  const addTopic = () => {
    const t = newTopic.trim();
    if (!t || topics.includes(t)) return;
    setTopics((prev) => [...prev, t]);
    setNewTopic("");
  };

  const addTime = () => {
    if (!newTime || postTimes.includes(newTime)) return;
    setPostTimes((prev) => [...prev, newTime].sort());
  };

  const handleSave = async () => {
    setSaving(true);
    const tid = toast.loading("Saving YouTube settings...");
    try {
      const res  = await fetch(withBrand("/api/settings/youtube", brandId), {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ enabled, privacy, secondsPerImage, targetShortSeconds, postsPerDay, descriptionSuffix, replyToComments, topics, postTypes, customPromptExtra, postTimes, scheduleDays, voiceover, voiceoverVoice, burnCaptions, dailySchedule, customScheduleOnly }),
      });
      const data = await res.json();
      if (data.success) toast.success("YouTube settings saved ✅", { id: tid });
      else              toast.error(data.error ?? "Save failed", { id: tid });
    } catch {
      toast.error("Network error", { id: tid });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <SkeletonBlock rows={5} />;

  const connected = status?.configured && status?.ok;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-bold text-white" style={{ fontFamily: "var(--font-sora), sans-serif" }}>YouTube Settings</h3>
        <p className="text-xs text-white/35 mt-1 leading-relaxed">
          Publish auto-generated content to YouTube as a vertical <strong className="text-white/50">Short</strong>.
          The card images are stitched into a 1080×1920 video and uploaded automatically on the schedule below.
        </p>
      </div>

      {/* Connection status */}
      <div className="rounded-xl p-4 border border-white/[0.07] bg-white/[0.01]">
        <div className="flex items-center gap-3">
          <Youtube size={16} className={connected ? "text-emerald-400" : status?.configured ? "text-red-400" : "text-white/30"} />
          <div>
            <p className="text-sm text-white/80 font-medium">
              {connected ? `Connected  -  ${status?.channel ?? "YouTube"}`
                : status?.configured ? "Credentials set but not working"
                : "Not configured"}
            </p>
            <p className="text-xs text-white/35 mt-0.5">
              {connected ? "Refresh token is valid — uploads will work."
                : status?.error
                ? status.error
                : "Set YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET and YOUTUBE_REFRESH_TOKEN in your environment."}
            </p>
            <p className="text-[11px] text-white/30 mt-1.5 leading-relaxed">
              The refresh token is never entered here — it lives in the{" "}
              <code className="text-white/40">YOUTUBE_REFRESH_TOKEN</code> env var. Generate one with{" "}
              <code className="text-white/40">npm run youtube:auth</code>.
            </p>
          </div>
        </div>
      </div>

      {/* Master enable */}
      <div className={cn(
        "rounded-xl p-4 border transition-all",
        enabled ? "border-brand/30 bg-brand/5" : "border-white/[0.07] bg-white/[0.01]"
      )}>
        <Toggle
          label="Enable YouTube auto-poster & comment replies"
          description={enabled
            ? "YouTube generates its own Shorts from the topics below and the AI auto-replies to comments."
            : "The YouTube auto-poster and comment replies are off."}
          value={enabled}
          onChange={setEnabled}
        />
      </div>

      <div className={cn("space-y-6 transition-opacity", !enabled && "opacity-40 pointer-events-none")}>
        {/* Privacy */}
        <div>
          <label className="text-xs font-medium text-white/40 block mb-3 uppercase tracking-wider">Video Privacy</label>
          <div className="flex gap-2">
            {["public", "unlisted", "private"].map((p) => (
              <button
                key={p}
                onClick={() => setPrivacy(p)}
                className={cn(
                  "px-4 py-2 rounded-xl text-sm font-medium capitalize transition-all",
                  privacy === p ? "text-white" : "text-white/40 bg-white/[0.03] hover:bg-white/[0.06]"
                )}
                style={privacy === p ? { background: "var(--gradient-accent)" } : {}}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        {/* Target Short length */}
        <div>
          <label className="text-xs font-medium text-white/40 block mb-3 uppercase tracking-wider">Target Short length</label>
          <div className="flex gap-2 flex-wrap">
            {SHORT_LENGTH_OPTIONS.map((n) => (
              <motion.button
                key={n}
                whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.96 }}
                onClick={() => setTargetShortSeconds(n)}
                className={cn(
                  "px-4 py-2 rounded-xl text-sm font-semibold border transition-all",
                  targetShortSeconds === n ? "text-white" : "text-white/40 bg-white/[0.03] border-white/[0.08] hover:text-white hover:border-white/20"
                )}
                style={targetShortSeconds === n ? { background: "var(--gradient-accent)", border: "1px solid transparent" } : {}}
              >
                {n}s
              </motion.button>
            ))}
          </div>
          <p className="text-xs text-white/30 mt-2">
            The AI sizes each Short&apos;s script and voiceover to fit this length (soft target).
          </p>
        </div>

        {/* Posts per day */}
        <div>
          <label className="text-xs font-medium text-white/40 block mb-3 uppercase tracking-wider">Posts Per Day</label>
          <div className="flex gap-3">
            {[1, 2, 3, 4, 5].map((n) => (
              <motion.button
                key={n}
                whileHover={{ scale: 1.06 }} whileTap={{ scale: 0.96 }}
                onClick={() => setPostsPerDay(n)}
                className={cn(
                  "w-12 h-12 rounded-xl text-sm font-bold border transition-all",
                  postsPerDay === n
                    ? "bg-gradient-to-br from-brand/30 to-brand-light/20 text-white border-brand/40"
                    : "border-white/[0.08] text-white/40 hover:text-white hover:border-white/20"
                )}
              >
                {n}
              </motion.button>
            ))}
          </div>
          <p className="text-xs text-white/30 mt-2">
            How many YouTube Shorts the auto-poster generates and schedules each day, distributed across the post times below.
          </p>
        </div>


        {/* Description suffix */}
        <div>
          <label className="text-xs font-medium text-white/40 block mb-3 uppercase tracking-wider">
            Description footer (optional)
          </label>
          <textarea
            value={descriptionSuffix}
            onChange={(e) => setDescriptionSuffix(e.target.value)}
            rows={3}
            placeholder="e.g. Follow @yourhandle for daily tips."
            className="w-full px-4 py-3 rounded-xl text-sm text-white outline-none resize-none"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
          />
          <p className="text-xs text-white/30 mt-2">Appended to every YouTube description. <code className="text-white/40">#Shorts</code> is added automatically.</p>
        </div>

        {/* Auto-reply to comments */}
        <div className="rounded-xl p-4 border border-white/[0.07] bg-white/[0.01]">
          <Toggle
            label="Auto-reply to YouTube comments"
            description="Let the AI generate and post replies to comments on your YouTube videos."
            value={replyToComments}
            onChange={setReplyToComments}
          />
        </div>

        {/* Posts / Shorts timing */}
        <div className="space-y-5">
          <div>
            <p className="text-sm font-semibold text-white/70">Posts / Shorts Timing</p>
            <p className="text-xs text-white/30 mt-1 leading-relaxed">
              These timing preferences control when YouTube-targeted Shorts are generated and published.
            </p>
          </div>

          {/* AI voiceover + word-by-word captions (beta) */}
          <div className="rounded-xl p-4 border border-white/[0.07] bg-white/[0.01]">
            <Toggle
              label="AI voiceover + word-by-word captions (beta)"
              description="Narrates each Short with an AI voice and optionally burns in synced captions. Adds render time — uses Groq-hosted Orpheus (or your self-hosted Canopy/Orpheus endpoint)."
              value={voiceover}
              onChange={setVoiceover}
            />
            {voiceover && (
              <div className="mt-4 pt-4 border-t border-white/[0.06]">
                <label className="text-xs font-medium text-white/40 block mb-1.5 uppercase tracking-wider">
                  Narration voice
                </label>
                <select
                  value={voiceoverVoice}
                  onChange={(e) => setVoiceoverVoice(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl text-sm text-white outline-none transition-all"
                  style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
                >
                  <optgroup label="Male" style={{ background: "rgb(var(--surface-rgb))" }}>
                    <option value="daniel" style={{ background: "rgb(var(--surface-rgb))" }}>Daniel — warm, natural (recommended)</option>
                    <option value="austin" style={{ background: "rgb(var(--surface-rgb))" }}>Austin — bright, energetic</option>
                    <option value="troy"   style={{ background: "rgb(var(--surface-rgb))" }}>Troy — deep, authoritative</option>
                  </optgroup>
                  <optgroup label="Female" style={{ background: "rgb(var(--surface-rgb))" }}>
                    <option value="autumn" style={{ background: "rgb(var(--surface-rgb))" }}>Autumn — warm, friendly</option>
                    <option value="diana"  style={{ background: "rgb(var(--surface-rgb))" }}>Diana — calm, clear</option>
                    <option value="hannah" style={{ background: "rgb(var(--surface-rgb))" }}>Hannah — soft, youthful</option>
                  </optgroup>
                </select>
                <p className="text-[11px] text-white/35 mt-2 leading-relaxed">
                  The voice that narrates every Short. Changes apply to the next generated Short.
                </p>

                <div className="mt-4 pt-4 border-t border-white/[0.06]">
                  <Toggle
                    label="Burn captions into the video"
                    description="OFF (recommended): no hardcoded captions, so YouTube auto-generates captions and auto-translates them per viewer's location/language. ON: hardcoded word-by-word captions (same text for everyone, can't be translated)."
                    value={burnCaptions}
                    onChange={setBurnCaptions}
                  />
                </div>
              </div>
            )}
          </div>

          <div className="rounded-xl p-3.5 border border-white/[0.06] flex items-start gap-3" style={{ background: "rgba(255,255,255,0.02)" }}>
            <AlertCircle size={14} className="text-white/30 flex-shrink-0 mt-0.5" />
            <p className="text-[11px] text-white/40 leading-relaxed">
              When <strong className="text-white/55">Auto-Post → Also publish to YouTube</strong> is OFF, the YouTube
              auto-poster generates its own Shorts from the YouTube topics list below (auto-expanding with no repeats).
            </p>
          </div>

          {/* Days */}
          <div>
            <label className="text-xs font-medium text-white/40 block mb-3 uppercase tracking-wider">
              Publishing Days
              <span className="ml-1.5 normal-case tracking-normal text-[10px] text-white/25 font-normal">(global — used when a day is set to “Use global”)</span>
            </label>
            <div className="flex gap-2 flex-wrap">
              {DAY_LABELS.map((label, idx) => (
                <motion.button
                  key={idx}
                  whileHover={{ scale: 1.06 }} whileTap={{ scale: 0.96 }}
                  onClick={() => toggleDay(idx)}
                  className={cn(
                    "w-12 h-12 rounded-xl text-xs font-bold border transition-all",
                    scheduleDays.includes(idx)
                      ? "bg-gradient-to-br from-brand/30 to-brand-light/20 text-white border-brand/40"
                      : "border-white/[0.08] text-white/35 hover:text-white hover:border-white/20"
                  )}
                >
                  {label}
                </motion.button>
              ))}
            </div>
          </div>

          {/* Times */}
          <div>
            <label className="text-xs font-medium text-white/40 block mb-3 uppercase tracking-wider">
              Publish Times ({postTimes.length} slot{postTimes.length !== 1 ? "s" : ""})
              <span className="ml-1.5 normal-case tracking-normal text-[10px] text-white/25 font-normal">(global — used when a day is set to “Use global”)</span>
            </label>
            <div className="flex flex-wrap gap-2 mb-3">
              {postTimes.map((t) => (
                <span
                  key={t}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm font-mono font-medium border border-white/10 text-white/80"
                  style={{ background: "rgba(255,255,255,0.04)" }}
                >
                  <Clock size={12} className="text-brand" />
                  {t}
                  <button
                    onClick={() => setPostTimes((prev) => prev.filter((x) => x !== t))}
                    className="text-white/30 hover:text-red-400 transition-colors"
                  >
                    <X size={11} />
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                type="time"
                value={newTime}
                onChange={(e) => setNewTime(e.target.value)}
                className="px-4 py-2.5 rounded-xl text-sm text-white outline-none font-mono"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", colorScheme: "dark" }}
              />
              <motion.button
                whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}
                onClick={addTime}
                className="px-4 py-2.5 rounded-xl text-sm font-medium text-white border border-white/[0.12] hover:border-brand/40 hover:text-brand-light transition-all flex items-center gap-1.5"
              >
                <Plus size={13} /> Add Time
              </motion.button>
            </div>
          </div>

          {/* Per-weekday schedule (Feature 1) */}
          <div>
            <label className="text-xs font-medium text-white/40 block mb-2 uppercase tracking-wider">
              Per-Day Schedule (optional)
            </label>
            <p className="text-xs text-white/30 mb-3 leading-relaxed">
              Override posts-per-day and publish times for specific weekdays. Days left on
              <strong className="text-white/45"> “Use global”</strong> fall back to the global
              Posts Per Day, Publishing Days and Publish Times above. Use the
              <strong className="text-emerald-300/70"> ON/OFF</strong> switch to skip a custom day entirely.
            </p>
            <DayScheduleEditor value={dailySchedule} onChange={setDailySchedule} />
            <div className="mt-3 rounded-xl px-4 border border-white/[0.07] bg-white/[0.01]">
              <Toggle
                label="Only post on custom days"
                description="Ignore the global Publishing Days/Times when a day has no custom schedule — publish only on days you've configured above."
                value={customScheduleOnly}
                onChange={setCustomScheduleOnly}
              />
            </div>
          </div>
        </div>

        {/* Post types to publish as Shorts */}
        <div>
          <label className="text-xs font-medium text-white/40 block mb-3 uppercase tracking-wider">
            Which content types to publish as Shorts
          </label>
          <div className="flex flex-wrap gap-2">
            {ALL_POST_TYPES.map((pt) => (
              <motion.button
                key={pt.id}
                whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}
                onClick={() => toggleType(pt.id)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all",
                  postTypes.includes(pt.id)
                    ? "bg-gradient-to-r from-brand/20 to-brand-light/10 text-white border-brand/30"
                    : "border-white/[0.08] text-white/35 hover:text-white/70 hover:border-white/20"
                )}
              >
                {pt.emoji} {pt.label}
              </motion.button>
            ))}
          </div>
          <p className="text-xs text-white/30 mt-2">Only these post types will be auto-published as YouTube Shorts.</p>
        </div>

        {/* Topics */}
        <div>
          <label className="text-xs font-medium text-white/40 block mb-3 uppercase tracking-wider">
            YouTube Topics ({topics.length})
          </label>
          <div className="flex flex-wrap gap-2 mb-3">
            {topics.map((t) => (
              <span
                key={t}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border border-white/10 text-white/70"
                style={{ background: "rgba(255,255,255,0.04)" }}
              >
                {t}
                <button
                  onClick={() => setTopics((prev) => prev.filter((x) => x !== t))}
                  className="text-white/30 hover:text-red-400 transition-colors ml-0.5"
                >
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              value={newTopic}
              onChange={(e) => setNewTopic(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addTopic()}
              placeholder="e.g. Tutorials, Industry insights..."
              className="flex-1 px-4 py-2.5 rounded-xl text-sm text-white placeholder-white/25 outline-none"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
              onFocus={(e) => { e.target.style.borderColor = "rgb(var(--accent-rgb) / 0.5)"; }}
              onBlur={(e)  => { e.target.style.borderColor = "rgba(255,255,255,0.08)"; }}
            />
            <motion.button
              whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}
              onClick={addTopic}
              className="px-4 py-2.5 rounded-xl text-sm font-medium text-white border border-white/[0.12] hover:border-brand/40 hover:text-brand-light transition-all flex items-center gap-1.5"
            >
              <Plus size={13} /> Add
            </motion.button>
          </div>
        </div>

        {/* Prompts */}
        <div>
          <label className="text-xs font-medium text-white/40 block mb-3 uppercase tracking-wider">
            Extra Prompt Instructions
          </label>
          <textarea
            value={customPromptExtra}
            onChange={(e) => setCustomPromptExtra(e.target.value)}
            rows={4}
            placeholder="e.g. Keep hooks punchy for Shorts. Add a strong call-to-subscribe in the first line."
            className="w-full px-4 py-3 rounded-xl text-sm text-white outline-none resize-y"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
          />
          <p className="text-xs text-white/30 mt-2">Appended to the base prompt when generating YouTube-targeted content.</p>
        </div>

        <div className="rounded-xl p-4 border border-red-500/15 bg-red-500/[0.03]">
          <p className="text-xs font-semibold text-red-400 mb-2">▶ How YouTube publishing works</p>
          <ul className="text-xs text-white/40 space-y-1 leading-relaxed">
            <li>• Shorts are generated from the topics above and published on the schedule below</li>
            <li>• The card image(s) are encoded into a vertical 1080×1920 MP4 with #Shorts</li>
            <li>• Carousels become multi-slide Shorts; single posts become one clip</li>
            <li>• Uploads run independently — a failed upload retries without affecting other posts</li>
          </ul>
        </div>
      </div>

      <div className="flex justify-end pt-2">
        <SaveButton onClick={handleSave} loading={saving} label="Save YouTube Settings" />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AI SETUP TAB  (describe your channel → AI asks questions → generates full config)
// ─────────────────────────────────────────────────────────────────────────────

type SetupQuestion = {
  id: string;
  label: string;
  hint: string;
  type: "text" | "select" | "chips";
  options?: string[];
};

// The generated-config preview shape returned by /api/ai/setup (stage:"generate").
interface SetupConfig {
  brand: {
    appName?: string;
    tagline?: string;
    niche?: string;
    purpose?: string;
    audience?: string;
    language?: string;
    defaultTone?: string;
    commentCtaLine?: string;
    persona?: { role?: string; voice?: string; handle?: string; displayName?: string };
    youtube?: { handle?: string; channelName?: string };
    contentTypes?: Record<string, { label?: string; enabled?: boolean }>;
    topics?: string[];
  };
  youtube: {
    postsPerDay: number;
    postTimes: string[];
    scheduleDays: number[];
    topics: string[];
    postTypes: string[];
  };
  ytDefaultPrompt: string;
  summary: { enabledTypes: Array<{ id: string; label: string }>; topics: string[] };
}

const SETUP_DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function AiSetupTab({ onGoToTab }: { onGoToTab: (id: string) => void }) {
  const { brandId } = useSelectedBrand();
  const { reload } = useBrandContext();

  const [mode, setMode]   = useState<"ai" | "manual">("ai");
  const [step, setStep]   = useState<"describe" | "answer" | "review">("describe");
  const [busy, setBusy]   = useState(false);

  const [description, setDescription] = useState("");
  const [questions, setQuestions]     = useState<SetupQuestion[]>([]);
  // Answers: text/select store a string; chips store a string[] joined on submit.
  const [answers, setAnswers]   = useState<Record<string, string>>({});
  const [chipSel, setChipSel]   = useState<Record<string, string[]>>({});
  const [config,  setConfig]    = useState<SetupConfig | null>(null);

  const resetFlow = () => {
    setStep("describe"); setQuestions([]); setAnswers({}); setChipSel({}); setConfig(null);
  };

  const generateQuestions = async () => {
    if (!description.trim()) { toast.error("Describe your channel first"); return; }
    setBusy(true);
    const tid = toast.loading("Thinking up the right questions…");
    try {
      const res  = await fetch(withBrand("/api/ai/setup", brandId), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage: "questions", description }),
      });
      const data = await res.json();
      if (data.success && Array.isArray(data.questions)) {
        setQuestions(data.questions);
        setAnswers({}); setChipSel({});
        setStep("answer");
        toast.success("Answer a few questions ✨", { id: tid });
      } else {
        toast.error(data.error ?? "Could not generate questions", { id: tid });
      }
    } catch {
      toast.error("Network error", { id: tid });
    } finally {
      setBusy(false);
    }
  };

  const generateConfig = async () => {
    setBusy(true);
    const tid = toast.loading("Building your channel config…");
    // Fold chip selections into the answers map (comma-joined).
    const merged: Record<string, string> = { ...answers };
    for (const [k, arr] of Object.entries(chipSel)) {
      if (arr.length) merged[k] = arr.join(", ");
    }
    try {
      const res  = await fetch(withBrand("/api/ai/setup", brandId), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage: "generate", description, answers: merged }),
      });
      const data = await res.json();
      if (data.success && data.config) {
        setConfig(data.config as SetupConfig);
        setStep("review");
        toast.success("Here's your setup — review it 👇", { id: tid });
      } else {
        toast.error(data.error ?? "Could not generate config", { id: tid });
      }
    } catch {
      toast.error("Network error", { id: tid });
    } finally {
      setBusy(false);
    }
  };

  const applyConfig = async () => {
    if (!config) return;
    setBusy(true);
    const tid = toast.loading("Applying setup…");
    try {
      const res  = await fetch(withBrand("/api/ai/setup", brandId), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage: "apply", config }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success("Setup applied ✅ Refine anytime in the other tabs.", { id: tid });
        reload();
      } else {
        toast.error(data.error ?? "Apply failed", { id: tid });
      }
    } catch {
      toast.error("Network error", { id: tid });
    } finally {
      setBusy(false);
    }
  };

  const toggleChip = (qid: string, opt: string) => {
    setChipSel((prev) => {
      const cur = prev[qid] ?? [];
      return { ...prev, [qid]: cur.includes(opt) ? cur.filter((x) => x !== opt) : [...cur, opt] };
    });
  };

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-bold text-white flex items-center gap-2" style={{ fontFamily: "var(--font-sora), sans-serif" }}>
          <Wand2 size={16} className="text-brand" /> AI Setup
        </h3>
        <p className="text-xs text-white/35 mt-1 leading-relaxed">
          Set up your whole channel by describing it. The AI asks a few tailored questions, then fills
          your brand, content types, topics, schedule, persona and channel details for you.
        </p>
      </div>

      {/* Mode toggle */}
      <div className="flex gap-2 p-1 rounded-xl w-fit" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
        {(["ai", "manual"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={cn(
              "flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-all",
              mode === m ? "text-white" : "text-white/40 hover:text-white/70",
            )}
            style={mode === m ? { background: "var(--gradient-accent)" } : {}}
          >
            {m === "ai" ? <><Wand2 size={13} /> AI setup</> : <><FileText size={13} /> Manual</>}
          </button>
        ))}
      </div>

      {mode === "manual" && (
        <div className="rounded-2xl border border-white/[0.07] p-5 space-y-3" style={{ background: "rgba(255,255,255,0.02)" }}>
          <p className="text-sm text-white/70">Prefer to configure everything yourself? Use these tabs:</p>
          <div className="flex flex-wrap gap-2">
            {[
              { id: "brand", label: "Brand", icon: Sparkles },
              { id: "content-types", label: "Content Types", icon: FileText },
              { id: "youtube", label: "YouTube", icon: Youtube },
            ].map((t) => (
              <button
                key={t.id}
                onClick={() => onGoToTab(t.id)}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold text-white/70 border border-white/[0.08] hover:text-white hover:border-white/20 transition-all"
              >
                <t.icon size={13} /> {t.label}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-white/30">The AI path writes to these very same settings — you can always fine-tune afterward.</p>
        </div>
      )}

      {mode === "ai" && (
        <>
          {/* Step indicator */}
          <div className="flex items-center gap-2 text-[11px] text-white/40">
            {[
              { k: "describe", n: 1, label: "Describe" },
              { k: "answer",   n: 2, label: "Answer" },
              { k: "review",   n: 3, label: "Review" },
            ].map((s, i) => (
              <div key={s.k} className="flex items-center gap-2">
                <span className={cn(
                  "flex items-center justify-center w-5 h-5 rounded-full font-bold",
                  step === s.k ? "bg-brand text-white" : "bg-white/[0.06] text-white/40",
                )}>{s.n}</span>
                <span className={cn(step === s.k && "text-white/80 font-medium")}>{s.label}</span>
                {i < 2 && <span className="text-white/15">—</span>}
              </div>
            ))}
          </div>

          {/* Step 1: Describe */}
          {step === "describe" && (
            <div className="rounded-2xl border border-white/[0.07] p-5 space-y-4" style={{ background: "rgba(255,255,255,0.02)" }}>
              <div>
                <label className="text-xs font-medium text-white/40 block mb-1.5 uppercase tracking-wider">
                  What kind of channel do you want?
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={5}
                  placeholder="e.g. A channel that teaches beginner home cooks quick 15-minute weeknight dinners, upbeat and friendly, for busy parents. Publish daily."
                  className="w-full px-4 py-3 rounded-xl text-sm text-white placeholder-white/25 outline-none resize-y"
                  style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
                />
              </div>
              <div className="flex justify-end">
                <motion.button
                  whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                  onClick={generateQuestions}
                  disabled={busy}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-60"
                  style={{ background: "var(--gradient-accent)" }}
                >
                  {busy ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
                  {busy ? "Thinking…" : "Generate Questions"}
                </motion.button>
              </div>
            </div>
          )}

          {/* Step 2: Answer */}
          {step === "answer" && (
            <div className="rounded-2xl border border-white/[0.07] p-5 space-y-5" style={{ background: "rgba(255,255,255,0.02)" }}>
              <p className="text-xs text-white/40">
                Answer what you can — leave anything blank and the AI will decide.
              </p>
              {questions.map((q) => (
                <div key={q.id}>
                  <label className="text-xs font-medium text-white/60 block mb-1">{q.label}</label>
                  {q.hint && <p className="text-[11px] text-white/30 mb-2">{q.hint}</p>}

                  {q.type === "text" && (
                    <input
                      type="text"
                      value={answers[q.id] ?? ""}
                      onChange={(e) => setAnswers((p) => ({ ...p, [q.id]: e.target.value }))}
                      placeholder="Type your answer, or leave blank to let AI decide"
                      className="w-full px-4 py-2.5 rounded-xl text-sm text-white placeholder-white/25 outline-none"
                      style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
                    />
                  )}

                  {q.type === "select" && (
                    <select
                      value={answers[q.id] ?? ""}
                      onChange={(e) => setAnswers((p) => ({ ...p, [q.id]: e.target.value }))}
                      className="w-full px-4 py-2.5 rounded-xl text-sm text-white outline-none"
                      style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
                    >
                      <option value="" style={{ background: "rgb(var(--surface-rgb))" }}>Let AI decide</option>
                      {(q.options ?? []).map((o) => (
                        <option key={o} value={o} style={{ background: "rgb(var(--surface-rgb))" }}>{o}</option>
                      ))}
                    </select>
                  )}

                  {q.type === "chips" && (
                    <div className="flex flex-wrap gap-2">
                      {(q.options ?? []).map((o) => {
                        const on = (chipSel[q.id] ?? []).includes(o);
                        return (
                          <button
                            key={o}
                            onClick={() => toggleChip(q.id, o)}
                            className={cn(
                              "px-3 py-1.5 rounded-full text-xs font-semibold border transition-all",
                              on
                                ? "bg-gradient-to-r from-brand/20 to-brand-light/10 text-white border-brand/30"
                                : "border-white/[0.08] text-white/40 hover:text-white/70 hover:border-white/20",
                            )}
                          >
                            {on && <Check size={11} className="inline mr-1 -mt-0.5" />}{o}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
              <div className="flex items-center justify-between pt-2">
                <button
                  onClick={() => setStep("describe")}
                  className="flex items-center gap-1.5 text-xs text-white/40 hover:text-white/70 transition-colors"
                >
                  <ArrowLeft size={13} /> Back
                </button>
                <motion.button
                  whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                  onClick={generateConfig}
                  disabled={busy}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-60"
                  style={{ background: "var(--gradient-accent)" }}
                >
                  {busy ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />}
                  {busy ? "Generating…" : "Generate Setup"}
                </motion.button>
              </div>
            </div>
          )}

          {/* Step 3: Review */}
          {step === "review" && config && (
            <div className="space-y-4">
              {/* Brand card */}
              <div className="rounded-2xl border border-white/[0.07] p-5 space-y-3" style={{ background: "rgba(255,255,255,0.02)" }}>
                <p className="text-xs font-semibold text-white/50 uppercase tracking-wider flex items-center gap-1.5">
                  <Sparkles size={12} className="text-brand" /> Brand
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                  <ReviewField label="App name" value={config.brand.appName} />
                  <ReviewField label="Niche" value={config.brand.niche} />
                  <ReviewField label="Audience" value={config.brand.audience} />
                  <ReviewField label="Language" value={config.brand.language} />
                  <ReviewField label="Default tone" value={config.brand.defaultTone} />
                  <ReviewField label="Subscribe CTA" value={config.brand.commentCtaLine} />
                </div>
                {config.brand.purpose && <ReviewField label="Purpose" value={config.brand.purpose} />}
              </div>

              {/* Channel card */}
              <div className="rounded-2xl border border-white/[0.07] p-5 space-y-3" style={{ background: "rgba(255,255,255,0.02)" }}>
                <p className="text-xs font-semibold text-white/50 uppercase tracking-wider flex items-center gap-1.5">
                  <Youtube size={12} className="text-red-400" /> YouTube Channel
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                  <ReviewField label="Handle" value={config.brand.youtube?.handle ? `@${config.brand.youtube.handle}` : "—"} />
                  <ReviewField label="Channel name" value={config.brand.youtube?.channelName} />
                </div>
              </div>

              {/* Persona card */}
              <div className="rounded-2xl border border-white/[0.07] p-5 space-y-3" style={{ background: "rgba(255,255,255,0.02)" }}>
                <p className="text-xs font-semibold text-white/50 uppercase tracking-wider flex items-center gap-1.5">
                  <User size={12} className="text-brand" /> Persona
                </p>
                <div className="space-y-3 text-sm">
                  <ReviewField label="Role" value={config.brand.persona?.role} />
                  <ReviewField label="Voice" value={config.brand.persona?.voice} />
                </div>
              </div>

              {/* Content types */}
              <div className="rounded-2xl border border-white/[0.07] p-5 space-y-3" style={{ background: "rgba(255,255,255,0.02)" }}>
                <p className="text-xs font-semibold text-white/50 uppercase tracking-wider flex items-center gap-1.5">
                  <FileText size={12} className="text-brand" /> Content types (enabled)
                </p>
                <div className="flex flex-wrap gap-2">
                  {config.summary.enabledTypes.length === 0 && (
                    <span className="text-xs text-white/30 italic">None selected</span>
                  )}
                  {config.summary.enabledTypes.map((t) => (
                    <span key={t.id} className="text-xs px-3 py-1.5 rounded-full border border-white/10 text-white/70" style={{ background: "rgba(255,255,255,0.03)" }}>
                      {t.label}
                    </span>
                  ))}
                </div>
              </div>

              {/* Topics */}
              <div className="rounded-2xl border border-white/[0.07] p-5 space-y-3" style={{ background: "rgba(255,255,255,0.02)" }}>
                <p className="text-xs font-semibold text-white/50 uppercase tracking-wider flex items-center gap-1.5">
                  <Activity size={12} className="text-brand" /> Topics ({config.summary.topics.length})
                </p>
                <div className="flex flex-wrap gap-2">
                  {config.summary.topics.map((t, i) => (
                    <span key={i} className="text-xs px-3 py-1.5 rounded-full border border-white/10 text-white/70" style={{ background: "rgba(255,255,255,0.03)" }}>
                      {t}
                    </span>
                  ))}
                </div>
              </div>

              {/* Schedule */}
              <div className="rounded-2xl border border-white/[0.07] p-5 space-y-3" style={{ background: "rgba(255,255,255,0.02)" }}>
                <p className="text-xs font-semibold text-white/50 uppercase tracking-wider flex items-center gap-1.5">
                  <Clock size={12} className="text-brand" /> Schedule
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                  <ReviewField label="Shorts / day" value={String(config.youtube.postsPerDay)} />
                  <ReviewField label="Publish times" value={config.youtube.postTimes.join(", ")} />
                  <ReviewField
                    label="Days"
                    value={config.youtube.scheduleDays.map((d) => SETUP_DAY_LABELS[d]).join(", ")}
                  />
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center justify-between pt-1">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setStep("answer")}
                    className="flex items-center gap-1.5 text-xs text-white/40 hover:text-white/70 transition-colors"
                  >
                    <ArrowLeft size={13} /> Back
                  </button>
                  <button
                    onClick={generateConfig}
                    disabled={busy}
                    className="flex items-center gap-1.5 text-xs text-white/40 hover:text-white/70 transition-colors disabled:opacity-40"
                  >
                    <RotateCw size={12} /> Regenerate
                  </button>
                </div>
                <motion.button
                  whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                  onClick={applyConfig}
                  disabled={busy}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-60"
                  style={{ background: "var(--gradient-accent)" }}
                >
                  {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                  {busy ? "Applying…" : "Apply Setup"}
                </motion.button>
              </div>

              <button
                onClick={resetFlow}
                className="text-[11px] text-white/25 hover:text-white/50 transition-colors"
              >
                Start over
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ReviewField({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <p className="text-[10px] font-medium text-white/30 uppercase tracking-wider mb-0.5">{label}</p>
      <p className="text-sm text-white/80 leading-snug break-words">{value?.trim() || "—"}</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// BRAND TAB  (white-label identity, persona, colours, topics, hashtag seeds)
// ─────────────────────────────────────────────────────────────────────────────

/** Build the account-scoped brand URL. "all"/empty → omit query (→ primary). */
function brandUrl(brandId: string): string {
  return brandId && brandId !== ALL_BRANDS
    ? `/api/settings/brand?brand=${encodeURIComponent(brandId)}`
    : "/api/settings/brand";
}

/** Chip editor: add via Enter or button, remove via ×. */
function ChipEditor({
  label, items, onChange, placeholder, accent = "red",
}: {
  label: string; items: string[]; onChange: (next: string[]) => void;
  placeholder?: string; accent?: "red" | "fuchsia";
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim();
    if (!v || items.includes(v)) { setDraft(""); return; }
    onChange([...items, v]);
    setDraft("");
  };
  const focusColor = accent === "fuchsia" ? "rgba(192,38,211,0.5)" : "rgb(var(--accent-rgb) / 0.5)";
  return (
    <div>
      <label className="text-xs font-medium text-white/40 block mb-2 uppercase tracking-wider">
        {label} ({items.length})
      </label>
      <div className="flex flex-wrap gap-2 mb-3">
        {items.map((t) => (
          <span
            key={t}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border border-white/10 text-white/70"
            style={{ background: "rgba(255,255,255,0.04)" }}
          >
            {t}
            <button
              onClick={() => onChange(items.filter((x) => x !== t))}
              className="text-white/30 hover:text-red-400 transition-colors ml-0.5"
            >
              <X size={10} />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          placeholder={placeholder}
          className="flex-1 px-4 py-2.5 rounded-xl text-sm text-white placeholder-white/25 outline-none"
          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
          onFocus={(e) => { e.target.style.borderColor = focusColor; }}
          onBlur={(e)  => { e.target.style.borderColor = "rgba(255,255,255,0.08)"; }}
        />
        <motion.button
          whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}
          onClick={add}
          className="px-4 py-2.5 rounded-xl text-sm font-medium text-white border border-white/[0.12] hover:border-brand/40 hover:text-brand-light transition-all flex items-center gap-1.5"
        >
          <Plus size={13} /> Add
        </motion.button>
      </div>
    </div>
  );
}

/** color swatch + hex text input pair. */
function ColorField({
  label, value, onChange,
}: { label: string; value: string; onChange: (v: string) => void }) {
  const safe = /^#[0-9a-fA-F]{6}$/.test(value) ? value : "#000000";
  return (
    <div>
      <label className="text-xs font-medium text-white/40 block mb-1.5 uppercase tracking-wider">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={safe}
          onChange={(e) => onChange(e.target.value)}
          className="w-10 h-10 rounded-lg cursor-pointer bg-transparent border border-white/10 flex-shrink-0"
          style={{ colorScheme: "dark" }}
        />
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#000000"
          className="flex-1 px-3 py-2.5 rounded-xl text-sm text-white placeholder-white/25 outline-none font-mono"
          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
        />
      </div>
    </div>
  );
}

interface BrandState {
  appName: string;
  tagline: string;
  niche: string;
  purpose: string;
  audience: string;
  language: string;
  defaultTone: string;
  persona: { handle: string; displayName: string; role: string; voice: string };
  dmAutoReply: string;
  commentCtaLine: string;
  colors: { bg: string; bg2: string; accent: string; accent2: string; accent3: string };
  lockCardTheme: boolean;
  youtube: { handle: string; channelName: string };
  topics: string[];
  hashtagSeeds: string[];
}

const EMPTY_BRAND: BrandState = {
  appName: "", tagline: "", niche: "", purpose: "", audience: "", language: "",
  defaultTone: "",
  persona: { handle: "", displayName: "", role: "", voice: "" },
  dmAutoReply: "", commentCtaLine: "",
  colors: { bg: "#0b0b12", bg2: "#111118", accent: "#ef4444", accent2: "#ec4899", accent3: "#8b5cf6" },
  lockCardTheme: false,
  youtube: { handle: "", channelName: "" },
  topics: [], hashtagSeeds: [],
};

function BrandTab() {
  const { brandId } = useSelectedBrand();
  const { reload } = useBrandContext();
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [b,       setB]       = useState<BrandState>(EMPTY_BRAND);

  useEffect(() => {
    setLoading(true);
    fetch(brandUrl(brandId))
      .then((r) => r.json())
      .then((d) => {
        if (d.success && d.data) {
          const x = d.data;
          setB({
            appName:     x.appName     ?? "",
            tagline:     x.tagline     ?? "",
            niche:       x.niche       ?? "",
            purpose:     x.purpose     ?? "",
            audience:    x.audience    ?? "",
            language:    x.language    ?? "",
            defaultTone: x.defaultTone ?? "",
            persona: {
              handle:      x.persona?.handle      ?? "",
              displayName: x.persona?.displayName ?? "",
              role:        x.persona?.role        ?? "",
              voice:       x.persona?.voice       ?? "",
            },
            dmAutoReply:    x.dmAutoReply    ?? "",
            commentCtaLine: x.commentCtaLine ?? "",
            colors: {
              bg:      x.colors?.bg      ?? EMPTY_BRAND.colors.bg,
              bg2:     x.colors?.bg2     ?? EMPTY_BRAND.colors.bg2,
              accent:  x.colors?.accent  ?? EMPTY_BRAND.colors.accent,
              accent2: x.colors?.accent2 ?? EMPTY_BRAND.colors.accent2,
              accent3: x.colors?.accent3 ?? EMPTY_BRAND.colors.accent3,
            },
            lockCardTheme: Boolean(x.lockCardTheme),
            youtube: {
              handle:      x.youtube?.handle      ?? "",
              channelName: x.youtube?.channelName ?? "",
            },
            topics:       Array.isArray(x.topics)       ? x.topics       : [],
            hashtagSeeds: Array.isArray(x.hashtagSeeds) ? x.hashtagSeeds : [],
          });
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [brandId]);

  const setField = <K extends keyof BrandState>(k: K, v: BrandState[K]) =>
    setB((prev) => ({ ...prev, [k]: v }));
  const setPersona = (k: keyof BrandState["persona"], v: string) =>
    setB((prev) => ({ ...prev, persona: { ...prev.persona, [k]: v } }));
  const setColor = (k: keyof BrandState["colors"], v: string) =>
    setB((prev) => ({ ...prev, colors: { ...prev.colors, [k]: v } }));
  const setYoutube = (k: keyof BrandState["youtube"], v: string) =>
    setB((prev) => ({ ...prev, youtube: { ...prev.youtube, [k]: v } }));

  const handleSave = async () => {
    setSaving(true);
    const tid = toast.loading("Saving brand settings...");
    try {
      const res = await fetch(brandUrl(brandId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(b),
      });
      const data = await res.json();
      if (data.success) {
        toast.success("Brand settings saved ✅", { id: tid });
        reload();
      } else {
        toast.error(data.error ?? "Save failed", { id: tid });
      }
    } catch {
      toast.error("Network error", { id: tid });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <SkeletonBlock rows={6} />;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-bold text-white" style={{ fontFamily: "var(--font-sora), sans-serif" }}>Brand</h3>
        <p className="text-xs text-white/35 mt-1 leading-relaxed">
          White-label the entire app — name, voice, persona, colours and content topics. These settings re-skin the dashboard and steer how the AI writes for this account.
        </p>
      </div>

      {/* Identity */}
      <div className="space-y-4">
        <p className="text-xs font-semibold text-white/40 uppercase tracking-wider">Identity</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <GlassInput label="App Name" value={b.appName} onChange={(v) => setField("appName", v)} placeholder="e.g. YouTubePilot AI" />
          <GlassInput label="Niche"    value={b.niche}   onChange={(v) => setField("niche", v)}   placeholder="e.g. fitness coaching" />
        </div>
        <GlassInput label="Tagline" value={b.tagline} onChange={(v) => setField("tagline", v)} placeholder="e.g. AI-powered content on autopilot" />
        <div>
          <label className="text-xs font-medium text-white/40 block mb-1.5 uppercase tracking-wider">Purpose</label>
          <textarea
            value={b.purpose}
            onChange={(e) => setField("purpose", e.target.value)}
            rows={3}
            placeholder="What is this account about and what should every post try to achieve?"
            className="w-full px-4 py-3 rounded-xl text-sm text-white placeholder-white/25 outline-none resize-y"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <GlassInput label="Audience"     value={b.audience}    onChange={(v) => setField("audience", v)}    placeholder="e.g. busy professionals 25-45" />
          <GlassInput label="Language"     value={b.language}    onChange={(v) => setField("language", v)}    placeholder="e.g. English" />
        </div>
        <GlassInput label="Default Tone" value={b.defaultTone} onChange={(v) => setField("defaultTone", v)} placeholder="e.g. Professional, Engaging" />
      </div>

      {/* Persona */}
      <div className="space-y-4 pt-2 border-t border-white/[0.06]">
        <p className="text-xs font-semibold text-white/40 uppercase tracking-wider">Persona</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <GlassInput label="Handle"       value={b.persona.handle}      onChange={(v) => setPersona("handle", v)}      placeholder="@yourhandle" />
          <GlassInput label="Display Name" value={b.persona.displayName} onChange={(v) => setPersona("displayName", v)} placeholder="Your Brand" />
        </div>
        <GlassInput label="Role" value={b.persona.role} onChange={(v) => setPersona("role", v)} placeholder="e.g. Certified fitness coach" />
        <div>
          <label className="text-xs font-medium text-white/40 block mb-1.5 uppercase tracking-wider">Voice</label>
          <textarea
            value={b.persona.voice}
            onChange={(e) => setPersona("voice", e.target.value)}
            rows={2}
            placeholder="How should the brand sound? e.g. warm, authoritative, no jargon"
            className="w-full px-4 py-3 rounded-xl text-sm text-white placeholder-white/25 outline-none resize-y"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
          />
        </div>
      </div>

      {/* Engagement copy */}
      <div className="space-y-4 pt-2 border-t border-white/[0.06]">
        <p className="text-xs font-semibold text-white/40 uppercase tracking-wider">Engagement</p>
        <div>
          <label className="text-xs font-medium text-white/40 block mb-1.5 uppercase tracking-wider">DM Auto-Reply</label>
          <textarea
            value={b.dmAutoReply}
            onChange={(e) => setField("dmAutoReply", e.target.value)}
            rows={3}
            placeholder="Default reply sent to new direct messages."
            className="w-full px-4 py-3 rounded-xl text-sm text-white placeholder-white/25 outline-none resize-y"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
          />
        </div>
        <GlassInput label="Comment CTA Line" value={b.commentCtaLine} onChange={(v) => setField("commentCtaLine", v)} placeholder="e.g. Follow for daily tips!" />
      </div>

      {/* YouTube */}
      <div className="space-y-4 pt-2 border-t border-white/[0.06]">
        <p className="text-xs font-semibold text-white/40 uppercase tracking-wider flex items-center gap-1.5">
          <Youtube size={12} /> YouTube
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <GlassInput label="YouTube Handle"  value={b.youtube.handle}      onChange={(v) => setYoutube("handle", v)}      placeholder="@yourchannel" />
          <GlassInput label="Channel Name"    value={b.youtube.channelName} onChange={(v) => setYoutube("channelName", v)} placeholder="Your Channel" />
        </div>
      </div>

      {/* Colours */}
      <div className="space-y-4 pt-2 border-t border-white/[0.06]">
        <p className="text-xs font-semibold text-white/40 uppercase tracking-wider">Colours</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <ColorField label="Background"  value={b.colors.bg}      onChange={(v) => setColor("bg", v)} />
          <ColorField label="Background 2" value={b.colors.bg2}     onChange={(v) => setColor("bg2", v)} />
          <ColorField label="Accent"      value={b.colors.accent}  onChange={(v) => setColor("accent", v)} />
          <ColorField label="Accent 2"    value={b.colors.accent2} onChange={(v) => setColor("accent2", v)} />
          <ColorField label="Accent 3"    value={b.colors.accent3} onChange={(v) => setColor("accent3", v)} />
        </div>
        <div className="rounded-xl px-4 border border-white/[0.07] bg-white/[0.01]">
          <Toggle
            label="Lock card theme"
            description="Keep card backgrounds fixed to the brand colours instead of varying per post."
            value={b.lockCardTheme}
            onChange={(v) => setField("lockCardTheme", v)}
          />
        </div>
      </div>

      {/* Topics + hashtag seeds */}
      <div className="space-y-5 pt-2 border-t border-white/[0.06]">
        <ChipEditor
          label="Topics"
          items={b.topics}
          onChange={(next) => setField("topics", next)}
          placeholder="Add a topic and press Enter…"
        />
        <ChipEditor
          label="Hashtag Seeds"
          items={b.hashtagSeeds}
          onChange={(next) => setField("hashtagSeeds", next)}
          placeholder="e.g. fitness, wellness (press Enter)…"
        />
      </div>

      <div className="flex justify-end pt-2">
        <SaveButton onClick={handleSave} loading={saving} label="Save Brand" />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTENT TYPES TAB  (11 slots: label / description / enabled / custom prompt)
// ─────────────────────────────────────────────────────────────────────────────
const CONTENT_TYPE_SLOTS: { id: string; defaultLabel: string }[] = [
  { id: "EDUCATIONAL",      defaultLabel: "Educational" },
  { id: "QUIZ",             defaultLabel: "Quiz" },
  { id: "CAROUSEL",         defaultLabel: "Carousel" },
  { id: "MYTH_FACT",        defaultLabel: "Myth vs Fact" },
  { id: "PRO_TIP",   defaultLabel: "Pro Tip" },
  { id: "CASE_STUDY",       defaultLabel: "Story / Example" },
  { id: "IMAGE_QUIZ", defaultLabel: "Image Quiz" },
  { id: "KNOWLEDGE_QUIZ",         defaultLabel: "Knowledge Quiz" },
  { id: "PREVENTIVE",       defaultLabel: "How-To / Tips" },
  { id: "CTA",              defaultLabel: "Call to Action" },
  { id: "STORY",            defaultLabel: "Story" },
];

interface ContentTypeState {
  label: string; description: string; prompt: string; enabled: boolean;
}

function ContentTypesTab() {
  const { brandId } = useSelectedBrand();
  const { reload } = useBrandContext();
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [types,   setTypes]   = useState<Record<string, ContentTypeState>>({});
  const [open,    setOpen]    = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch(brandUrl(brandId))
      .then((r) => r.json())
      .then((d) => {
        const saved: Record<string, any> = (d.success && d.data?.contentTypes) || {};
        const next: Record<string, ContentTypeState> = {};
        for (const slot of CONTENT_TYPE_SLOTS) {
          const c = saved[slot.id] ?? {};
          next[slot.id] = {
            label:       typeof c.label === "string" && c.label ? c.label : slot.defaultLabel,
            description: typeof c.description === "string" ? c.description : "",
            prompt:      typeof c.prompt === "string" ? c.prompt : "",
            enabled:     typeof c.enabled === "boolean" ? c.enabled : true,
          };
        }
        setTypes(next);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [brandId]);

  const patch = (id: string, p: Partial<ContentTypeState>) =>
    setTypes((prev) => ({ ...prev, [id]: { ...prev[id], ...p } }));

  const handleSave = async () => {
    setSaving(true);
    const tid = toast.loading("Saving content types...");
    try {
      const res = await fetch(brandUrl(brandId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentTypes: types }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success("Content types saved ✅", { id: tid });
        reload();
      } else {
        toast.error(data.error ?? "Save failed", { id: tid });
      }
    } catch {
      toast.error("Network error", { id: tid });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <SkeletonBlock rows={6} />;

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-bold text-white" style={{ fontFamily: "var(--font-sora), sans-serif" }}>Content Types</h3>
        <p className="text-xs text-white/35 mt-1 leading-relaxed">
          Rename, describe, enable/disable, and give a custom AI prompt to each content slot. These labels appear throughout the app and steer generation for this account.
        </p>
      </div>

      <div className="space-y-3">
        {CONTENT_TYPE_SLOTS.map((slot) => {
          const t = types[slot.id];
          if (!t) return null;
          const isOpen = open === slot.id;
          return (
            <div
              key={slot.id}
              className={cn(
                "rounded-2xl border p-4 transition-all",
                t.enabled ? "border-white/[0.08]" : "border-white/[0.05] opacity-70",
              )}
              style={{ background: "rgba(255,255,255,0.02)" }}
            >
              <div className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <input
                    value={t.label}
                    onChange={(e) => patch(slot.id, { label: e.target.value })}
                    placeholder={slot.defaultLabel}
                    className="w-full px-3 py-2 rounded-lg text-sm font-semibold text-white placeholder-white/25 outline-none"
                    style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
                  />
                  <p className="text-[10px] text-white/25 mt-1 font-mono uppercase tracking-wider">{slot.id}</p>
                </div>
                <button
                  onClick={() => setOpen(isOpen ? null : slot.id)}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-white/40 border border-white/[0.08] hover:text-white hover:border-white/20 transition-all flex-shrink-0"
                  title="Edit details"
                >
                  {isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
                <motion.button
                  onClick={() => patch(slot.id, { enabled: !t.enabled })}
                  className={cn(
                    "relative w-11 h-6 rounded-full transition-all flex-shrink-0",
                    t.enabled ? "bg-gradient-to-r from-brand to-brand-light" : "bg-white/10",
                  )}
                  style={t.enabled ? { boxShadow: "0 0 12px rgb(var(--accent-rgb) / 0.4)" } : {}}
                  title={t.enabled ? "Enabled" : "Disabled"}
                >
                  <motion.div
                    animate={{ x: t.enabled ? 20 : 2 }}
                    transition={{ type: "spring", bounce: 0.2, duration: 0.3 }}
                    className="absolute top-1 w-4 h-4 rounded-full bg-white shadow-sm"
                  />
                </motion.button>
              </div>

              {isOpen && (
                <div className="mt-4 space-y-3 pt-3 border-t border-white/[0.06]">
                  <div>
                    <label className="text-[11px] font-medium text-white/35 block mb-1.5 uppercase tracking-wider">Description</label>
                    <input
                      value={t.description}
                      onChange={(e) => patch(slot.id, { description: e.target.value })}
                      placeholder="Short description of this content type"
                      className="w-full px-3 py-2.5 rounded-lg text-sm text-white placeholder-white/25 outline-none"
                      style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-medium text-white/35 block mb-1.5 uppercase tracking-wider">Custom AI prompt (optional)</label>
                    <textarea
                      value={t.prompt}
                      onChange={(e) => patch(slot.id, { prompt: e.target.value })}
                      rows={4}
                      placeholder="Override the AI instructions for this content type. Leave blank to use the built-in default."
                      className="w-full px-3 py-2.5 rounded-lg text-sm text-white/80 placeholder-white/20 outline-none resize-y"
                      style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", fontFamily: "monospace" }}
                    />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex justify-end pt-2">
        <SaveButton onClick={handleSave} loading={saving} label="Save Content Types" />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN PAGE
// ─────────────────────────────────────────────────────────────────────────────
// Tabs whose data is scoped to the currently-selected account (brand).
const BRAND_SCOPED_TABS = new Set([
  "ai-setup", "brand", "content-types", "prompts", "youtube",
]);

export default function SettingsPage() {
  const { isAll, selected: selectedBrand, brands } = useSelectedBrand();
  const [activeTab, setActiveTab] = useState("brand");
  const [signingOut, setSigningOut] = useState(false);

  // Deep-link: read ?tab= from the URL on mount and select it if valid.
  useEffect(() => {
    const param = new URLSearchParams(window.location.search).get("tab");
    if (param && tabs.some((t) => t.id === param)) setActiveTab(param);
  }, []);

  // Reflect the active tab in the URL so it's linkable / back-button friendly.
  const selectTab = useCallback((id: string) => {
    setActiveTab(id);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", id);
    window.history.replaceState(null, "", url.toString());
  }, []);

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
    } finally {
      window.location.replace("/login");
    }
  }

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="max-w-5xl mx-auto">
      <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-6">
        {/* Sidebar */}
        <div className="rounded-2xl p-3 h-fit flex gap-2 overflow-x-auto lg:flex-col lg:gap-0 lg:overflow-visible" style={panelStyle}>
          {tabs.map((tab) => (
            <motion.button
              key={tab.id}
              whileHover={{ x: 2 }}
              onClick={() => selectTab(tab.id)}
              className={cn(
                "flex-shrink-0 whitespace-nowrap flex items-center gap-2 lg:gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all lg:w-full lg:mb-1 lg:last:mb-0",
                activeTab === tab.id
                  ? tab.id === "danger"
                    ? "bg-red-500/20 text-red-300 border border-red-500/20"
                    : "bg-gradient-to-r from-brand/20 to-brand-light/10 text-white border border-red-500/20"
                  : tab.id === "danger"
                  ? "text-red-400/60 hover:text-red-400 hover:bg-red-500/5"
                  : "text-white/40 hover:text-white/70 hover:bg-white/[0.04]"
              )}
            >
              <tab.icon size={15} />
              {tab.label}
              {tab.id === "prompts" && (
                <span className="ml-auto text-[9px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 font-bold">NEW</span>
              )}
            </motion.button>
          ))}

          {/* Sign Out */}
          <div className="flex-shrink-0 lg:mt-3 lg:pt-3 lg:border-t border-white/[0.06]">
            <motion.button
              whileHover={{ x: 2 }}
              onClick={handleSignOut}
              disabled={signingOut}
              className="flex-shrink-0 whitespace-nowrap flex items-center gap-2 lg:gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all text-red-400/60 hover:text-red-400 hover:bg-red-500/5 disabled:opacity-40 lg:w-full"
            >
              {signingOut ? <Loader2 size={15} className="animate-spin" /> : <LogOut size={15} />}
              {signingOut ? "Signing out…" : "Sign Out"}
            </motion.button>
          </div>
        </div>

        {/* Content panel */}
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -10 }}
            transition={{ duration: 0.2 }}
            className="rounded-2xl p-6 space-y-5"
            style={panelStyle}
          >
            {/* Brand-scope banner — shows which account these settings apply to */}
            {brands.length > 1 && BRAND_SCOPED_TABS.has(activeTab) && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-white/[0.06] bg-white/[0.02] text-xs text-white/50">
                <Layers size={13} className="text-brand" />
                These settings apply to:{" "}
                <span className="text-white/80 font-medium">
                  {isAll ? "Primary (switch off ‘All accounts’ to edit a specific one)" : selectedBrand?.label ?? "Primary"}
                </span>
              </div>
            )}

            {activeTab === "ai-setup"      && <AiSetupTab onGoToTab={selectTab} />}
            {activeTab === "brand"         && <BrandTab />}
            {activeTab === "content-types" && <ContentTypesTab />}
            {activeTab === "appearance"    && <AppearanceTab />}
            {activeTab === "account"       && <AccountTab />}
            {activeTab === "accounts"      && <AccountsTab />}
            {activeTab === "ai"            && <AiTab />}
            {activeTab === "prompts"       && <PromptsTab />}
            {activeTab === "youtube"       && <YouTubeTab />}
            {activeTab === "notifications" && <NotificationsTab />}
            {activeTab === "morning-digest" && <MorningDigestTab />}
            {activeTab === "danger"        && <DangerTab />}
          </motion.div>
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
