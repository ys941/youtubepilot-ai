"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { MoreHorizontal, ThumbsUp, MessageCircle, Share2, Bookmark } from "lucide-react";
import { useBrand } from "@/components/BrandContext";

export interface PostPreviewProps {
  username?: string;
  content: string;
  hook?: string;
  hashtags?: string[];
  type?: string;
  viralScore?: number;
  imagePrompt?: string;
  mediaUrl?: string; // actual generated card image
}

// ─── Neutral channel avatar ──────────────────────────────────────────────────
function ChannelAvatar({ size = 32, label }: { size?: number; label?: string }) {
  const initial = (label || "•").replace(/^@/, "").charAt(0).toUpperCase() || "•";
  return (
    <div style={{ width: size, height: size, borderRadius: "50%", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg,#ef4444,#b91c1c)", color: "#fff", fontWeight: 700, fontSize: Math.round(size * 0.42), fontFamily: "-apple-system,sans-serif" }}>
      {initial}
    </div>
  );
}

// ─── Image placeholder (decorative pulse + accent) ───────────────────────────
function ImagePlaceholder({ handle }: { handle: string }) {
  return (
    <div style={{ width: "100%", paddingBottom: "100%", position: "relative", background: "linear-gradient(150deg,#0a0010 0%,#0d0020 50%,#080010 100%)" }}>
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {/* subtle grid */}
        <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.15 }}>
          <defs>
            <pattern id="pp-grid" x="0" y="0" width="32" height="32" patternUnits="userSpaceOnUse">
              <path d="M 32 0 L 0 0 0 32" fill="none" stroke="#e63946" strokeWidth="0.3" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#pp-grid)" />
        </svg>
        {/* animated waveform accent */}
        <svg viewBox="0 0 400 60" style={{ position: "absolute", width: "90%", opacity: 0.4, top: "50%", transform: "translateY(-50%)" }} preserveAspectRatio="none">
          <motion.polyline
            points="0,30 40,30 55,30 60,8 65,52 70,30 90,30 130,30 145,30 150,5 155,55 160,30 185,30 225,30 240,30 245,6 250,54 255,30 280,30 315,30 330,30 335,7 340,53 345,30 375,30 400,30"
            fill="none" stroke="#e63946" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 1 }}
            transition={{ pathLength: { duration: 3.5, ease: "linear", repeat: Infinity, repeatType: "loop" }, opacity: { duration: 0.5 } }}
          />
        </svg>
        {/* play glyph */}
        <motion.svg viewBox="0 0 120 120" style={{ position: "absolute", width: "30%", opacity: 0.16 }}
          animate={{ scale: [1, 1.04, 1] }} transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}>
          <circle cx="60" cy="60" r="56" fill="none" stroke="#e63946" strokeWidth="2" />
          <path d="M48 40 L84 60 L48 80 Z" fill="#e63946" />
        </motion.svg>
        {/* label */}
        <div style={{ position: "absolute", bottom: 16, left: 0, right: 0, textAlign: "center" }}>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.2)", letterSpacing: "0.1em", fontFamily: "-apple-system,sans-serif" }}>
            {handle}
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Viral score ring ─────────────────────────────────────────────────────────
function ViralRing({ score }: { score: number }) {
  const r = 26;
  const circ = 2 * Math.PI * r;
  const offset = circ - (score / 100) * circ;
  const color = score >= 70 ? "#22c55e" : score >= 40 ? "#f59e0b" : "#ef4444";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ position: "relative", width: 52, height: 52 }}>
        <svg width="52" height="52" style={{ transform: "rotate(-90deg)" }}>
          <circle cx="26" cy="26" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="3.5" />
          <motion.circle cx="26" cy="26" r={r} fill="none" stroke={color} strokeWidth="3.5"
            strokeLinecap="round" strokeDasharray={circ}
            initial={{ strokeDashoffset: circ }} animate={{ strokeDashoffset: offset }}
            transition={{ duration: 1.2, ease: "easeOut", delay: 0.3 }}
          />
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ fontSize: 12, fontWeight: 700, color, fontFamily: "-apple-system,sans-serif" }}>{score}</span>
        </div>
      </div>
      <div>
        <p style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.6)", fontFamily: "-apple-system,sans-serif" }}>Viral Score</p>
        <p style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", fontFamily: "-apple-system,sans-serif" }}>/ 100</p>
      </div>
    </div>
  );
}

// ─── Main Component — neutral / YouTube-style Short preview ────────────────────
export default function PostPreview({
  username,
  content,
  hook,
  hashtags = [],
  type,
  viralScore = 0,
  imagePrompt,
  mediaUrl,
}: PostPreviewProps) {
  const brand = useBrand();
  const handleText = username || brand.handle || "yourchannel";
  const atHandleText = `@${handleText.replace(/^@/, "")}`;
  const [captionExpanded, setCaptionExpanded] = useState(false);
  const [liked, setLiked]   = useState(false);
  const [saved, setSaved]   = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);

  const score    = viralScore <= 1 ? Math.round(viralScore * 100) : Math.round(viralScore);
  const baseLikes    = Math.round(score * 4800 + 800);
  const baseComments = Math.round(baseLikes * 0.035);
  const baseSaves    = Math.round(baseLikes * 0.08);
  const baseReach    = Math.round(baseLikes * 3.5);
  const fmt = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);

  const fullCaption  = [hook, content].filter(Boolean).join("\n\n");
  const shortCaption = fullCaption.length > 200 ? fullCaption.slice(0, 200).trimEnd() : fullCaption;
  const isTruncated  = fullCaption.length > 200;

  // ── Neutral dark-mode colours ──
  const BG      = "#0f0f0f";
  const DIVIDER = "#272727";
  const TEXT1   = "#f5f5f5";
  const TEXT2   = "#a8a8a8";
  const ACCENT  = "#ff4d4d";

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      style={{ display: "flex", flexDirection: "column", gap: 20 }}
    >
      {/* ══════════════════════════════════════════════════════
          SHORT PREVIEW CARD  -  neutral dark mode
      ══════════════════════════════════════════════════════ */}
      <div style={{
        background: BG,
        border: `1px solid ${DIVIDER}`,
        borderRadius: 12,
        overflow: "hidden",
        maxWidth: 470,
        width: "100%",
        fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif",
      }}>

        {/* ── Header ───────────────────────────────────────── */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px 8px 12px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <ChannelAvatar size={34} label={handleText} />
            <div>
              <p style={{ fontSize: 14, fontWeight: 600, color: TEXT1, lineHeight: 1.2, margin: 0 }}>{handleText}</p>
              {type && (
                <p style={{ fontSize: 11, color: TEXT2, margin: 0, lineHeight: 1.2 }}>
                  {type.replace(/_/g, " ").toLowerCase()}
                </p>
              )}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button style={{ fontSize: 13, fontWeight: 700, color: "#fff", background: ACCENT, border: "none", cursor: "pointer", padding: "6px 14px", borderRadius: 999 }}>
              Subscribe
            </button>
            <MoreHorizontal size={20} color={TEXT1} />
          </div>
        </div>

        {/* ── Video frame (square preview of the card) ──────── */}
        <div style={{ position: "relative", width: "100%", aspectRatio: "1/1", background: "#111", overflow: "hidden" }}>
          {mediaUrl ? (
            <>
              {!imgLoaded && <ImagePlaceholder handle={atHandleText} />}
              <img
                src={mediaUrl}
                alt="Short preview"
                onLoad={() => setImgLoaded(true)}
                style={{
                  position: imgLoaded ? "relative" : "absolute",
                  inset: 0,
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  display: "block",
                  opacity: imgLoaded ? 1 : 0,
                  transition: "opacity 0.5s ease",
                }}
              />
            </>
          ) : (
            <ImagePlaceholder handle={atHandleText} />
          )}
        </div>

        {/* ── Action bar ───────────────────────────────────── */}
        <div style={{ padding: "8px 12px 0" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
              <motion.button
                whileTap={{ scale: 0.85 }}
                onClick={() => setLiked(v => !v)}
                style={{ background: "none", border: "none", cursor: "pointer", padding: 4, display: "flex" }}
              >
                <ThumbsUp size={22} color={liked ? ACCENT : TEXT1} fill={liked ? ACCENT : "none"} />
              </motion.button>
              <button style={{ background: "none", border: "none", cursor: "pointer", padding: 4, display: "flex" }}>
                <MessageCircle size={22} color={TEXT1} />
              </button>
              <button style={{ background: "none", border: "none", cursor: "pointer", padding: 4, display: "flex" }}>
                <Share2 size={22} color={TEXT1} />
              </button>
            </div>
            <motion.button
              whileTap={{ scale: 0.85 }}
              onClick={() => setSaved(v => !v)}
              style={{ background: "none", border: "none", cursor: "pointer", padding: 4, display: "flex" }}
            >
              <Bookmark size={22} color={saved ? ACCENT : TEXT1} fill={saved ? ACCENT : "none"} />
            </motion.button>
          </div>
        </div>

        {/* ── Likes ────────────────────────────────────────── */}
        <div style={{ padding: "4px 16px 0" }}>
          <p style={{ fontSize: 14, fontWeight: 600, color: TEXT1, margin: 0 }}>
            {fmt(baseLikes + (liked ? 1 : 0))} likes
          </p>
        </div>

        {/* ── Caption ──────────────────────────────────────── */}
        <div style={{ padding: "6px 16px 0" }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: TEXT1 }}>{handleText} </span>
          <span style={{ fontSize: 14, color: TEXT1, lineHeight: 1.5 }}>
            {captionExpanded ? fullCaption : shortCaption}
            {isTruncated && !captionExpanded && (
              <>{"... "}
                <button onClick={() => setCaptionExpanded(true)}
                  style={{ fontSize: 14, color: TEXT2, background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                  more
                </button>
              </>
            )}
          </span>
        </div>

        {/* ── Hashtags ─────────────────────────────────────── */}
        {hashtags.length > 0 && (
          <div style={{ padding: "4px 16px 0", display: "flex", flexWrap: "wrap", gap: "2px 4px" }}>
            {hashtags.map((tag) => (
              <span key={tag} style={{ fontSize: 14, color: "#e0f1ff", cursor: "pointer" }}>
                {tag.startsWith("#") ? tag : `#${tag}`}
              </span>
            ))}
          </div>
        )}

        {/* ── View comments ────────────────────────────────── */}
        <div style={{ padding: "6px 16px 0" }}>
          <button style={{ fontSize: 14, color: TEXT2, background: "none", border: "none", cursor: "pointer", padding: 0 }}>
            View all {fmt(baseComments)} comments
          </button>
        </div>

        {/* ── Sample comments ──────────────────────────────── */}
        <div style={{ padding: "4px 16px 0", display: "flex", flexDirection: "column", gap: 4 }}>
          {[
            { user: "alex_creates",   text: "This is incredibly helpful 🙏 saving this for later!" },
            { user: "jordan.makes",   text: "Always learning from your videos 💙 keep it up!" },
          ].map((c) => (
            <p key={c.user} style={{ fontSize: 14, color: TEXT1, margin: 0, lineHeight: 1.4 }}>
              <span style={{ fontWeight: 600 }}>{c.user} </span>
              <span style={{ color: "rgba(245,245,245,0.85)" }}>{c.text}</span>
            </p>
          ))}
        </div>

        {/* ── Timestamp ────────────────────────────────────── */}
        <div style={{ padding: "6px 16px 2px" }}>
          <p style={{ fontSize: 10, color: TEXT2, textTransform: "uppercase", letterSpacing: "0.04em", margin: 0 }}>
            2 hours ago
          </p>
        </div>

        {/* ── Add a comment ────────────────────────────────── */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px 12px", borderTop: `1px solid ${DIVIDER}`, marginTop: 10 }}>
          <ChannelAvatar size={26} label={handleText} />
          <span style={{ flex: 1, fontSize: 14, color: TEXT2 }}>Add a comment...</span>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════
          STATS ROW
      ══════════════════════════════════════════════════════ */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
        {score > 0 && <ViralRing score={score} />}

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, flex: 1 }}>
          {[
            { emoji: "👍", label: "Est. Likes",    value: fmt(baseLikes) },
            { emoji: "💬", label: "Comments",      value: fmt(baseComments) },
            { emoji: "🔖", label: "Saves",         value: fmt(baseSaves) },
            { emoji: "👁️", label: "Reach",         value: fmt(baseReach) },
          ].map(({ emoji, label, value }) => (
            <div key={label} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 12, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", flexShrink: 0 }}>
              <span style={{ fontSize: 14 }}>{emoji}</span>
              <div>
                <p style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", margin: 0, fontFamily: "-apple-system,sans-serif" }}>{label}</p>
                <p style={{ fontSize: 13, fontWeight: 600, color: "#fff", margin: 0, fontFamily: "-apple-system,sans-serif" }}>{value}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Caption meta */}
        <div style={{ padding: "8px 12px", borderRadius: 12, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", fontSize: 10, color: "rgba(255,255,255,0.35)", fontFamily: "-apple-system,sans-serif", flexShrink: 0 }}>
          <span>{fullCaption.length} chars</span>
          <span style={{ margin: "0 6px" }}>·</span>
          <span>{hashtags.length} tags</span>
        </div>
      </div>
    </motion.div>
  );
}
