"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { usePathname } from "next/navigation";
import Link from "next/link";
import Sidebar from "@/components/dashboard/Sidebar";
import Header from "@/components/dashboard/Header";
import { useBrand } from "@/components/BrandContext";
import {
  CheckCircle, AlertTriangle, Calendar, X, Sparkles, ArrowRight,
} from "lucide-react";

// ─── First-run "finish setup" banner ──────────────────────────────────────────
// Shows until the user saves Settings → Brand the first time (brand.configured).
function FirstRunBanner() {
  const brand = useBrand();
  const [dismissed, setDismissed] = useState(false);
  if (brand.configured || dismissed) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ type: "spring", bounce: 0.2, duration: 0.5 }}
      className="mx-4 sm:mx-6 lg:mx-8 mt-4 mb-0 rounded-2xl border overflow-hidden"
      style={{ background: "rgba(99,102,241,0.08)", borderColor: "rgba(99,102,241,0.25)" }}
    >
      <div className="flex items-start gap-4 px-5 py-4">
        <div
          className="flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center mt-0.5"
          style={{ background: "rgba(99,102,241,0.15)" }}
        >
          <Sparkles size={16} className="text-indigo-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold" style={{ color: "#a5b4fc", fontFamily: "Sora, sans-serif" }}>
            Finish setting up {brand.appName}
          </p>
          <p className="text-xs text-white/60 mt-1">
            Configure your brand, niche, handle, and persona so every post sounds like you.
          </p>
          <Link
            href="/settings"
            className="inline-flex items-center gap-1.5 mt-2.5 text-xs font-semibold text-indigo-300 hover:text-indigo-200 transition-colors"
          >
            Open Brand settings <ArrowRight size={12} />
          </Link>
        </div>
        <button
          onClick={() => setDismissed(true)}
          className="flex-shrink-0 text-white/20 hover:text-white/60 transition-colors mt-0.5"
        >
          <X size={16} />
        </button>
      </div>
    </motion.div>
  );
}

// ─── Catch-up banner ─────────────────────────────────────────────────────────
interface CatchupResult {
  scheduledPublished: number;
  scheduledFailed:    number;
  errors:             string[];
  ranAt:              string;
}

function CatchupBanner({
  result,
  onClose,
}: {
  result: CatchupResult;
  onClose: () => void;
}) {
  const hasActivity =
    result.scheduledPublished > 0 ||
    result.scheduledFailed > 0;

  if (!hasActivity) return null;

  const hasErrors = result.scheduledFailed > 0 || result.errors.length > 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ type: "spring", bounce: 0.2, duration: 0.5 }}
      className="mx-4 sm:mx-6 lg:mx-8 mt-4 mb-0 rounded-2xl border overflow-hidden"
      style={{
        background: hasErrors
          ? "rgba(234,179,8,0.08)"
          : "rgba(34,197,94,0.08)",
        borderColor: hasErrors
          ? "rgba(234,179,8,0.2)"
          : "rgba(34,197,94,0.2)",
      }}
    >
      <div className="flex items-start gap-4 px-5 py-4">
        {/* Icon */}
        <div
          className="flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center mt-0.5"
          style={{
            background: hasErrors ? "rgba(234,179,8,0.15)" : "rgba(34,197,94,0.15)",
          }}
        >
          {hasErrors ? (
            <AlertTriangle size={16} className="text-yellow-400" />
          ) : (
            <CheckCircle size={16} className="text-green-400" />
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <p
            className="text-sm font-semibold"
            style={{ color: hasErrors ? "#fbbf24" : "#4ade80", fontFamily: "Sora, sans-serif" }}
          >
            {hasErrors ? "Catch-up completed with some issues" : "✅ Catch-up complete  -  you're all caught up!"}
          </p>

          <div className="flex flex-wrap gap-4 mt-2">
            {result.scheduledPublished > 0 && (
              <span className="flex items-center gap-1.5 text-xs text-white/60">
                <Calendar size={12} className="text-green-400" />
                <span>
                  <strong className="text-white">{result.scheduledPublished}</strong>{" "}
                  scheduled post{result.scheduledPublished > 1 ? "s" : ""} published
                </span>
              </span>
            )}
            {result.scheduledFailed > 0 && (
              <span className="flex items-center gap-1.5 text-xs text-yellow-400/80">
                <AlertTriangle size={12} />
                <span>
                  <strong>{result.scheduledFailed}</strong>{" "}
                  post{result.scheduledFailed > 1 ? "s" : ""} failed (no media URL)
                </span>
              </span>
            )}
          </div>

          {result.errors.length > 0 && (
            <p className="text-[11px] text-white/30 mt-1.5 truncate">
              {result.errors[0]}
              {result.errors.length > 1 && ` (+${result.errors.length - 1} more)`}
            </p>
          )}
        </div>

        {/* Close */}
        <button
          onClick={onClose}
          className="flex-shrink-0 text-white/20 hover:text-white/60 transition-colors mt-0.5"
        >
          <X size={16} />
        </button>
      </div>
    </motion.div>
  );
}

// ─── Layout ───────────────────────────────────────────────────────────────────
export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  const [catchupResult,   setCatchupResult]   = useState<CatchupResult | null>(null);
  const [showBanner,      setShowBanner]      = useState(false);
  const [mobileMenuOpen,  setMobileMenuOpen]  = useState(false);

  const handleMobileClose   = useCallback(() => setMobileMenuOpen(false), []);
  const handleMobileToggle  = useCallback(() => setMobileMenuOpen((v) => !v), []);

  // ── One-time catchup on mount ─────────────────────────────────────────────
  // Publishes overdue scheduled posts that were due while the server was offline.
  useEffect(() => {
    fetch("/api/startup")
      .then((r) => r.json())
      .then((d) => {
        if (d.success && d.data) {
          const result: CatchupResult = d.data;
          setCatchupResult(result);
          const hasActivity =
            result.scheduledPublished > 0 ||
            result.scheduledFailed > 0;
          if (hasActivity) setShowBanner(true);
        }
      })
      .catch(() => {}); // silent  -  catch-up is best-effort
  }, []); // only on mount

  // ── Scheduler polling  -  every 30 seconds ────────────────────────────────
  // Fallback that publishes any overdue scheduled posts even if a background
  // worker missed them. Each route debounces so multiple open tabs don't double-publish.
  useEffect(() => {
    const poll = () => {
      fetch("/api/scheduler/check").catch(() => {}); // publishes any overdue scheduled posts
    };

    // First run after 25s (let startup catchup finish first)
    const initialDelay = setTimeout(poll, 25_000);
    // Then every 30s
    const interval = setInterval(poll, 30_000);

    return () => {
      clearTimeout(initialDelay);
      clearInterval(interval);
    };
  }, []);

  return (
    <div className="relative min-h-screen bg-appbg flex overflow-hidden">
      {/* Background radial gradients */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div
          className="orb-float absolute top-[-200px] left-[-200px] w-[700px] h-[700px] rounded-full opacity-[0.07]"
          style={{
            background: "radial-gradient(circle, #ef4444 0%, #ec4899 50%, transparent 70%)",
          }}
        />
        <div
          className="orb-float-delayed absolute bottom-[-200px] right-[-200px] w-[600px] h-[600px] rounded-full opacity-[0.05]"
          style={{
            background: "radial-gradient(circle, #9333ea 0%, #ec4899 50%, transparent 70%)",
          }}
        />
        <div
          className="orb-float-slow absolute top-[40%] left-[40%] w-[500px] h-[500px] rounded-full opacity-[0.04]"
          style={{
            background: "radial-gradient(circle, #ec4899 0%, transparent 70%)",
          }}
        />
        {/* Subtle grid */}
        <div
          className="absolute inset-0 opacity-[0.015]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(239,68,68,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(239,68,68,0.3) 1px, transparent 1px)",
            backgroundSize: "60px 60px",
          }}
        />
      </div>

      {/* Sidebar */}
      <Sidebar mobileOpen={mobileMenuOpen} onMobileClose={handleMobileClose} />

      {/* Main area — no left margin on mobile (sidebar hidden), 260px on md+ */}
      <div className="flex-1 flex flex-col min-h-screen md:ml-[260px]">
        <Header onMobileMenuToggle={handleMobileToggle} />

        {/* First-run banner  -  until Settings → Brand is saved the first time */}
        <FirstRunBanner />

        {/* Catch-up banner  -  shows once per session if something was missed */}
        <AnimatePresence>
          {showBanner && catchupResult && (
            <CatchupBanner
              result={catchupResult}
              onClose={() => setShowBanner(false)}
            />
          )}
        </AnimatePresence>

        <main className="flex-1 overflow-y-auto">
          <AnimatePresence mode="popLayout">
            <motion.div
              key={pathname}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12, ease: "easeOut" }}
              className="p-4 sm:p-6 lg:p-8"
            >
              {children}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}
