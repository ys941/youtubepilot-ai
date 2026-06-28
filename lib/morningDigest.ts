/**
 * lib/morningDigest.ts
 *
 * Builds and sends the once-a-day "Morning Digest" email — a last-24h summary of the
 * YouTube channel. Which sections appear is controlled entirely by the user's
 * Settings → Morning Digest toggles (preferences.morningDigest). Every collector is
 * best-effort and isolated in try/catch so one failing source never blocks the digest.
 *
 * YouTube-only build: there are no Instagram/Facebook sections.
 *
 * Scheduling: runMorningDigest() is polled from instrumentation.ts on the same ~10-min
 * loop as the daily health check; it gates on the configured IST send-hour + a
 * once-per-day guard.
 */

import { prisma } from "@/lib/prisma";
import { readPreferences, type MorningDigestSettings } from "@/lib/preferences";
import { getRecentVideos, getChannelStats, listCommentThreads } from "@/lib/youtube";
import { sendMorningDigestEmail, type MorningDigestPayload } from "@/lib/notifier";
import { wallTimeToUTC } from "@/lib/utils";

const IST_TZ = "Asia/Kolkata";

function istParts(d = new Date()) {
  const p: Record<string, number> = {};
  for (const part of new Intl.DateTimeFormat("en-US", {
    timeZone: IST_TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d)) if (part.type !== "literal") p[part.type] = parseInt(part.value, 10);
  return p;
}

const istTime = (d: Date) => d.toLocaleTimeString("en-IN", { timeZone: IST_TZ, hour: "2-digit", minute: "2-digit", hour12: true });

let _lastDigestDate: string | null = null;

/** Poll-gated entry: send the digest once per day at the configured IST hour. */
export async function runMorningDigest(): Promise<boolean> {
  let cfg: MorningDigestSettings | undefined;
  try { cfg = (await readPreferences()).morningDigest; } catch { return false; }
  if (!cfg?.enabled) return false;

  const now = istParts();
  const todayKey = `${now.year}-${now.month}-${now.day}`;
  if (_lastDigestDate === todayKey) return false;

  // Honor the full HH:MM send time. The poll runs every ~10 min, so fire once the
  // current time has reached the configured minute within the target hour
  // (the once-per-day guard above prevents a second send later in the same hour).
  const [hStr, mStr] = (cfg.sendTime || "08:00").split(":");
  const targetHour = parseInt(hStr || "8", 10);
  const targetMin = parseInt(mStr || "0", 10) || 0;
  if (now.hour !== targetHour) return false;
  if (now.minute < targetMin) return false; // not yet at HH:MM

  _lastDigestDate = todayKey;
  console.log("[MorningDigest] Composing & sending digest…");
  try {
    const payload = await collectDigest(cfg);
    await sendMorningDigestEmail(payload);
    console.log("[MorningDigest] Sent.");
    return true;
  } catch (e: any) {
    console.warn("[MorningDigest] Failed:", e?.message ?? e);
    return false;
  }
}

/** Build the payload, including only the sections the user enabled. */
export async function collectDigest(cfg: MorningDigestSettings): Promise<MorningDigestPayload> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const dateLabel = new Date().toLocaleDateString("en-IN", { timeZone: IST_TZ, weekday: "long", day: "numeric", month: "short" });
  const p: MorningDigestPayload = { dateLabel };

  // ── YouTube videos published in last 24h (for insights / published / top) ──
  let ytVideos: any[] = [];
  try { ytVideos = await getRecentVideos(15); } catch { /* not configured */ }
  const yt24 = ytVideos.filter((v) => v.publishedAt && new Date(v.publishedAt) >= since);

  if (cfg.ytInsights) {
    const s = yt24.reduce((a, v) => ({ views: a.views + (v.views || 0), likes: a.likes + (v.likes || 0), comments: a.comments + (v.comments || 0) }), { views: 0, likes: 0, comments: 0 });
    p.yt = { videos24h: yt24.length, ...s };
  }
  if (cfg.ytPublished) p.ytPublished = yt24.map((v) => ({ title: v.title, url: v.url }));
  if (cfg.ytSubscribers) {
    try { const cs = await getChannelStats(); if (cs) p.ytSubscribers = { count: cs.subscribers, delta: null }; } catch { /* best-effort */ }
  }
  if (cfg.ytComments) {
    try {
      const out: Array<{ author: string; text: string; videoTitle?: string }> = [];
      for (const v of ytVideos.slice(0, 5)) {
        const threads = await listCommentThreads(v.videoId, 30).catch(() => []);
        for (const t of threads) if (t.publishedAt && new Date(t.publishedAt) >= since) out.push({ author: t.author, text: t.text, videoTitle: v.title });
      }
      if (out.length) p.ytComments = out.slice(0, 20);
    } catch { /* best-effort */ }
  }

  // ── Top performer (highest YT views in the last 24h) ──
  if (cfg.topContent) {
    const ytBest = yt24
      .map((v) => ({ platform: "YouTube", title: v.title, score: v.views || 0, metric: `${v.views || 0} views` }))
      .sort((a, b) => b.score - a.score)[0];
    if (ytBest && ytBest.score > 0) p.topContent = { platform: ytBest.platform, title: ytBest.title, metric: ytBest.metric };
  }

  // ── Auto-engagement (comments the bot replied to) ──
  if (cfg.engagement) {
    try {
      const acts = await prisma.activityLog.findMany({ where: { createdAt: { gte: since } }, select: { action: true } });
      const commentsReplied = acts.filter((a) => /comment/i.test(a.action) && /repl/i.test(a.action)).length;
      p.engagement = { commentsReplied };
    } catch { /* best-effort */ }
  }

  // ── Scheduled for today (IST) ──
  if (cfg.upcomingToday) {
    try {
      const t = istParts();
      const start = wallTimeToUTC(t.year, t.month, t.day, 0, 0, IST_TZ);
      const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
      const sp = await prisma.scheduledPost.findMany({
        where: { status: "PENDING", scheduledFor: { gte: start, lt: end } },
        orderBy: { scheduledFor: "asc" }, select: { title: true, scheduledFor: true },
      });
      if (sp.length) p.upcoming = sp.map((x) => ({ title: x.title, when: istTime(x.scheduledFor) }));
    } catch { /* best-effort */ }
  }

  // ── Failures (last 24h, excluding the transient __CLAIMING__ sentinel) ──
  if (cfg.failures) {
    try {
      const f = await prisma.scheduledPost.findMany({
        where: { status: "FAILED", scheduledFor: { gte: since }, NOT: { error: { startsWith: "__CLAIMING__" } } },
        orderBy: { scheduledFor: "desc" }, take: 10, select: { title: true, error: true },
      });
      if (f.length) p.failures = f.map((x) => ({ title: x.title, error: x.error || "Unknown error" }));
    } catch { /* best-effort */ }
  }

  // ── Growth vs prior day (subscribers from AccountAnalytics snapshots) ──
  if (cfg.growthDeltas) {
    try {
      const rows = await prisma.accountAnalytics.findMany({ orderBy: { date: "desc" }, take: 2, select: { followers: true } });
      const g: Array<{ label: string; value: string }> = [];
      if (rows.length >= 2) { const d = rows[0].followers - rows[1].followers; g.push({ label: "Subscribers", value: `${rows[0].followers} (${d >= 0 ? "+" : ""}${d})` }); }
      if (g.length) p.growth = g;
    } catch { /* best-effort */ }
  }

  // ── System health ──
  if (cfg.systemHealth) {
    let dbOk = false;
    try { await prisma.$queryRaw`SELECT 1`; dbOk = true; } catch { dbOk = false; }
    p.health = [
      { label: "Database", ok: dbOk },
      { label: "YouTube connected", ok: !!(process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_REFRESH_TOKEN) },
      { label: "Webhook configured", ok: !!process.env.WEBHOOK_VERIFY_TOKEN },
      { label: "AI key (Groq)", ok: !!(process.env.GROK_API_KEY || process.env.GROQ_API_KEY) },
    ];
  }

  // ── AI usage ──
  if (cfg.aiUsage) {
    try {
      const rows = await prisma.aIGeneration.findMany({ where: { createdAt: { gte: since } }, select: { tokensUsed: true } });
      p.aiUsage = { generations: rows.length, tokens: rows.reduce((a, r) => a + (r.tokensUsed || 0), 0) };
    } catch { /* best-effort */ }
  }

  return p;
}
