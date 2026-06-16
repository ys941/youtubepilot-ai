"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Eye, Users, MessageCircle, RefreshCw,
  AlertCircle, Repeat2,
  Youtube, PlayCircle, Settings,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { formatNumber, formatRelativeTime } from "@/lib/utils";
import { useSelectedBrand, withBrand } from "@/components/dashboard/useSelectedBrand";

// ─── Variants ─────────────────────────────────────────────────────────────────
const containerVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.06, delayChildren: 0.05 } },
};
const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: "easeOut" } },
};

// ─── Tooltip ──────────────────────────────────────────────────────────────────
const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl px-4 py-3 border border-white/10 text-xs" style={{ background: "rgba(17,17,24,0.98)", backdropFilter: "blur(20px)" }}>
      <p className="text-white/50 mb-2">{label}</p>
      {payload.map((e: any) => (
        <div key={e.name} className="flex items-center gap-2 mb-1">
          <div className="w-2 h-2 rounded-full" style={{ background: e.color }} />
          <span className="text-white/50 capitalize">{e.name}:</span>
          <span className="text-white font-medium">
            {typeof e.value === "number" && e.value > 100 ? formatNumber(e.value) : e.value}
          </span>
        </div>
      ))}
    </div>
  );
};

// ─── Skeleton ─────────────────────────────────────────────────────────────────
function SkeletonKPI() {
  return (
    <div className="rounded-2xl p-4 animate-pulse" style={{ background: "rgba(17,17,24,0.8)", border: "1px solid rgba(255,255,255,0.07)" }}>
      <div className="w-8 h-8 rounded-lg bg-white/5 mb-3" />
      <div className="h-2 bg-white/5 rounded w-1/2 mb-2" />
      <div className="h-6 bg-white/5 rounded w-3/4 mb-1" />
      <div className="h-2 bg-white/5 rounded w-1/4" />
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function AnalyticsPage() {
  const queryClient = useQueryClient();
  const { brandId, isAll, selected } = useSelectedBrand();
  const [secondsSinceUpdate, setSecondsSinceUpdate] = useState(0);

  // ── YouTube analytics (channel stats + recent videos) ─────────────────────
  const {
    data: ytData,
    isLoading: ytLoading,
    isError: ytError,
    dataUpdatedAt,
  } = useQuery({
    queryKey: ["youtube-overview", brandId],
    queryFn: () => fetch(withBrand("/api/youtube/overview", brandId)).then((r) => r.json()),
    refetchInterval: 300000,             // auto-refresh every 5 min
    refetchIntervalInBackground: false,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });

  // ── YouTube comments (flat list across recent videos) ─────────────────────
  const { data: ytCommentsData, isLoading: ytCommentsLoading } = useQuery({
    queryKey: ["youtube-comments", brandId],
    queryFn: () => fetch(withBrand("/api/youtube/comments", brandId)).then((r) => r.json()),
    refetchInterval: 600000,             // auto-refresh every 10 min (quota-friendly)
    refetchIntervalInBackground: false,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });

  // ── Seconds-ago counter ───────────────────────────────────────────────────
  useEffect(() => {
    if (!dataUpdatedAt) return;
    const update = () => setSecondsSinceUpdate(Math.floor((Date.now() - dataUpdatedAt) / 1000));
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [dataUpdatedAt]);

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ["youtube-overview"] });
    queryClient.invalidateQueries({ queryKey: ["youtube-comments"] });
    toast.success("Analytics refreshed");
  };

  // ── YouTube derived data ──────────────────────────────────────────────────
  const ytConfigured: boolean   = ytData?.data?.configured ?? false;
  const ytChannel               = ytData?.data?.channel ?? null;
  const ytStats                 = ytData?.data?.stats ?? null;
  const ytRecentVideos: any[]   = ytData?.data?.recentVideos ?? [];
  // Chart data: most-recent-first → reverse so oldest is on the left.
  // Truncate long titles for axis labels.
  const ytChartData = [...ytRecentVideos]
    .slice(0, 10)
    .reverse()
    .map((v: any) => ({
      name: (v.title ?? "Untitled").length > 16 ? `${(v.title ?? "Untitled").slice(0, 16)}…` : (v.title ?? "Untitled"),
      views: v.views ?? 0,
      likes: v.likes ?? 0,
      comments: v.comments ?? 0,
    }));
  // Top videos sorted by views (desc) for the table.
  const ytTopVideos = [...ytRecentVideos].sort((a: any, b: any) => (b.views ?? 0) - (a.views ?? 0));
  // Flat YouTube comments across recent videos (already newest-first from API).
  const ytComments: any[] = ytCommentsData?.data ?? [];

  return (
    <motion.div variants={containerVariants} initial="hidden" animate="visible" className="max-w-7xl mx-auto space-y-6">
      {/* ── Header bar ─────────────────────────────────────────────────────── */}
      <motion.div variants={itemVariants} className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-bold text-white" style={{ fontFamily: "Sora, sans-serif" }}>Analytics</h2>
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-white/[0.05] border border-white/[0.08] text-white/50">
            {isAll ? "All accounts" : selected?.label ?? "Primary"}
          </span>
          {dataUpdatedAt ? (
            <span className="text-xs text-white/30">
              Last synced: {secondsSinceUpdate < 60 ? `${secondsSinceUpdate}s ago` : `${Math.floor(secondsSinceUpdate / 60)}m ago`}
            </span>
          ) : null}
        </div>
        <motion.button
          whileHover={{ scale: 1.04 }}
          whileTap={{ scale: 0.96 }}
          onClick={handleRefresh}
          className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-medium text-white/60 border border-white/[0.08] hover:text-white hover:border-white/20 transition-all"
        >
          <RefreshCw size={11} />
          Refresh
        </motion.button>
      </motion.div>

      {/* ── Error banner ───────────────────────────────────────────────────── */}
      {ytError && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-2 px-4 py-3 rounded-xl border border-red-500/20 bg-red-500/10 text-xs text-red-400"
        >
          <AlertCircle size={13} />
          Could not load data  -  retrying...
        </motion.div>
      )}

      {/* ── YouTube Analytics ──────────────────────────────────────────────── */}
      <motion.div variants={itemVariants} className="pt-2">
        {/* Section header */}
        <div className="flex items-center gap-2.5 mb-4">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "rgba(255,0,0,0.12)" }}>
            <Youtube size={16} className="text-red-500" />
          </div>
          <h2 className="text-lg font-bold text-white" style={{ fontFamily: "Sora, sans-serif" }}>YouTube</h2>
          {ytConfigured && (ytChannel?.title || ytStats?.channelTitle) && (
            <span className="text-xs text-white/30 truncate max-w-[200px]">@{ytChannel?.title || ytStats?.channelTitle}</span>
          )}
          {ytConfigured && (
            <span className="ml-auto text-[10px] text-white/25 flex items-center gap-1">
              <Repeat2 size={9} className="text-red-500" /> Live
            </span>
          )}
        </div>

        {/* ── Loading ── */}
        {ytLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {Array.from({ length: 3 }).map((_, i) => <SkeletonKPI key={i} />)}
          </div>
        ) : !ytConfigured ? (
          /* ── Not connected placeholder ── */
          <div className="rounded-2xl p-8 flex flex-col items-center justify-center text-center gap-3" style={{ background: "rgba(17,17,24,0.8)", backdropFilter: "blur(20px)", border: "1px solid rgba(255,255,255,0.07)" }}>
            <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: "rgba(255,0,0,0.1)" }}>
              <Youtube size={24} className="text-red-500/60" />
            </div>
            <p className="text-sm font-semibold text-white" style={{ fontFamily: "Sora, sans-serif" }}>YouTube not connected</p>
            <p className="text-[11px] text-white/40 max-w-xs leading-relaxed">
              Connect your YouTube channel to see channel stats, video performance charts and your top videos here.
            </p>
            <a
              href="/settings?tab=youtube"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-[11px] font-medium text-red-400 border border-red-500/20 hover:bg-red-500/10 transition-all"
            >
              <Settings size={11} /> Settings → YouTube
            </a>
          </div>
        ) : (
          <div className="space-y-4">
            {/* ── Channel stat tiles ── */}
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "Subscribers", value: ytStats?.subscribers ?? 0, icon: Users,      bg: "rgba(255,0,0,0.1)",   text: "text-red-500" },
                { label: "Views",       value: ytStats?.views       ?? 0, icon: Eye,        bg: "rgba(236,72,153,0.1)", text: "text-pink-400" },
                { label: "Videos",      value: ytStats?.videos      ?? 0, icon: PlayCircle, bg: "rgba(147,51,234,0.1)", text: "text-purple-400" },
              ].map((t, i) => (
                <motion.div
                  key={t.label}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.06 }}
                  whileHover={{ scale: 1.03 }}
                  className="rounded-2xl p-4"
                  style={{ background: "rgba(17,17,24,0.8)", backdropFilter: "blur(20px)", border: "1px solid rgba(255,255,255,0.07)" }}
                >
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center mb-3" style={{ background: t.bg }}>
                    <t.icon size={15} className={t.text} />
                  </div>
                  <p className="text-[10px] text-white/40 uppercase tracking-wider mb-1">{t.label}</p>
                  <p className="text-xl font-bold text-white" style={{ fontFamily: "Sora, sans-serif" }}>{formatNumber(Number(t.value))}</p>
                </motion.div>
              ))}
            </div>

            {/* ── Recent video performance chart ── */}
            <div className="rounded-2xl p-5" style={{ background: "rgba(17,17,24,0.8)", backdropFilter: "blur(20px)", border: "1px solid rgba(255,255,255,0.07)" }}>
              <h3 className="text-sm font-semibold text-white mb-4" style={{ fontFamily: "Sora, sans-serif" }}>Recent Video Performance</h3>
              <div className="h-52">
                {ytChartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={ytChartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                      <defs>
                        <linearGradient id="ytViewsGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#ff0000" stopOpacity={0.85} />
                          <stop offset="95%" stopColor="#ff0000" stopOpacity={0.35} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                      <XAxis dataKey="name" tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 9 }} axisLine={false} tickLine={false} interval={0} />
                      <YAxis tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => formatNumber(v)} />
                      <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
                      <Bar dataKey="views"    fill="url(#ytViewsGrad)" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="likes"    fill="#ec4899" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="comments" fill="#9333ea" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-white/25 text-xs">
                    No videos yet  -  publish your first video to see performance here
                  </div>
                )}
              </div>
            </div>

            {/* ── Top videos table ── */}
            <div className="rounded-2xl overflow-hidden" style={{ background: "rgba(17,17,24,0.8)", backdropFilter: "blur(20px)", border: "1px solid rgba(255,255,255,0.07)" }}>
              <div className="flex items-center gap-2 px-5 py-4 border-b border-white/[0.06]">
                <h3 className="text-sm font-semibold text-white" style={{ fontFamily: "Sora, sans-serif" }}>Top Videos</h3>
                <span className="text-[10px] text-white/25">by views</span>
              </div>
              {ytTopVideos.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-white/[0.04]">
                        {["Video", "Views", "Likes", "Comments"].map((h) => (
                          <th key={h} className="text-left px-5 py-3 text-[10px] font-medium text-white/30 uppercase tracking-wider">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {ytTopVideos.map((v: any, i: number) => (
                        <motion.tr
                          key={v.videoId ?? i}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={{ delay: 0.1 + i * 0.04 }}
                          className="border-b border-white/[0.03] hover:bg-white/[0.03] transition-colors group"
                        >
                          <td className="px-5 py-3 max-w-[260px]">
                            <div className="flex items-center gap-2.5">
                              <a
                                href={v.url ?? (v.videoId ? `https://www.youtube.com/watch?v=${v.videoId}` : undefined)}
                                target="_blank" rel="noopener noreferrer"
                                className="flex-shrink-0 relative group/thumb"
                                title="Watch on YouTube"
                              >
                                {v.thumbnail ? (
                                  <img src={v.thumbnail} alt="" className="w-14 h-8 rounded-md object-cover opacity-85 group-hover/thumb:opacity-100 transition-opacity" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                                ) : (
                                  <div className="w-14 h-8 rounded-md bg-white/5 flex items-center justify-center">
                                    <PlayCircle size={12} className="text-white/30" />
                                  </div>
                                )}
                              </a>
                              <div className="min-w-0">
                                <p className="text-xs text-white/80 font-medium truncate group-hover:text-white transition-colors">{v.title ?? "Untitled"}</p>
                                <a
                                  href={v.url ?? (v.videoId ? `https://www.youtube.com/watch?v=${v.videoId}` : undefined)}
                                  target="_blank" rel="noopener noreferrer"
                                  className="text-[9px] text-white/20 hover:text-red-500 transition-colors flex items-center gap-0.5 mt-0.5"
                                >
                                  Watch on YouTube ↗
                                </a>
                              </div>
                            </div>
                          </td>
                          <td className="px-5 py-3 text-xs tabular-nums">
                            <span className={v.views > 0 ? "text-white/70" : "text-white/30"}>{formatNumber(v.views ?? 0)}</span>
                          </td>
                          <td className="px-5 py-3 text-xs tabular-nums">
                            <span className={v.likes > 0 ? "text-pink-400" : "text-white/30"}>{formatNumber(v.likes ?? 0)}</span>
                          </td>
                          <td className="px-5 py-3 text-xs tabular-nums">
                            <span className={v.comments > 0 ? "text-purple-400" : "text-white/30"}>{formatNumber(v.comments ?? 0)}</span>
                          </td>
                        </motion.tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="py-10 text-center text-white/30 text-sm">No videos yet  -  publish your first video!</div>
              )}
            </div>

            {/* ── YouTube comments ── */}
            <div className="rounded-2xl overflow-hidden" style={{ background: "rgba(17,17,24,0.8)", backdropFilter: "blur(20px)", border: "1px solid rgba(255,255,255,0.07)" }}>
              <div className="flex items-center gap-2 px-5 py-4 border-b border-white/[0.06]">
                <MessageCircle size={13} className="text-red-500" />
                <h3 className="text-sm font-semibold text-white" style={{ fontFamily: "Sora, sans-serif" }}>Comments</h3>
                {ytComments.length > 0 && (
                  <span className="ml-1 px-1.5 py-0.5 rounded-full text-[9px] bg-red-500/20 text-red-400">{ytComments.length}</span>
                )}
                <span className="ml-auto text-[10px] text-white/25">recent videos</span>
              </div>

              {ytCommentsLoading ? (
                <div className="p-4 space-y-3">
                  {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-12 animate-pulse bg-white/5 rounded-xl" />)}
                </div>
              ) : ytComments.length > 0 ? (
                <div className="divide-y divide-white/[0.04] max-h-[420px] overflow-y-auto">
                  {ytComments.map((c: any, i: number) => (
                    <motion.div
                      key={c.commentId ?? i}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: i * 0.04 }}
                      className="px-4 py-3 hover:bg-white/[0.02] transition-colors"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[11px] font-semibold text-red-500">{c.author ?? "User"}</span>
                        <span className="text-[10px] text-white/25">{c.publishedAt ? formatRelativeTime(c.publishedAt) : ""}</span>
                      </div>
                      <p className="text-xs text-white/60 leading-relaxed mb-1.5">{c.text ?? ""}</p>
                      {c.videoTitle && (
                        <a
                          href={c.url ?? (c.videoId ? `https://youtube.com/shorts/${c.videoId}` : undefined)}
                          target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[10px] text-white/30 hover:text-red-500 transition-colors max-w-full"
                          title={c.videoTitle}
                        >
                          <PlayCircle size={10} className="flex-shrink-0" />
                          <span className="truncate">{c.videoTitle}</span>
                          <span className="flex-shrink-0">↗</span>
                        </a>
                      )}
                    </motion.div>
                  ))}
                </div>
              ) : (
                <div className="py-10 text-center text-white/30 text-sm">No comments yet</div>
              )}
            </div>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
