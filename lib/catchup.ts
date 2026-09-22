/**
 * lib/catchup.ts
 *
 * Startup catch-up logic -- runs when the app boots (and on the 5-min loop).
 * Handles work that may have been missed while the app was offline:
 *   1. Publish overdue scheduled YouTube Shorts
 *   2. Auto-generate today's YouTube Shorts
 *   3. Auto-reply to new YouTube comments
 */

import { prisma } from "@/lib/prisma";
import { claimCommentForReply, releaseCommentClaim, markCommentReplied } from "@/lib/commentClaim";
import { PostCommentContext, checkGrokHealth } from "@/lib/grok";
import { getAIClient, generateJSONResilient } from "@/lib/ai-factory";
// renderPostToJpeg and renderStoryToJpeg are imported dynamically at call sites
// to prevent Turbopack from bundling Node.js-only modules (satori/sharp) for the edge runtime.
import { readPreferences, readPreferencesForBrand, resolveDaySchedule } from "@/lib/preferences";
import { atHandle, buildBrandSystemPrompt, type BrandConfig } from "@/lib/brandConfig";
import { listBrands, getBrandCredentials, getPrimaryBrandId, type BrandRecord, type BrandCredentials } from "@/lib/brands";
import { wallTimeToUTC } from "@/lib/utils";
import { isWebhookActive } from "@/lib/webhookCounter";
import {
  notifyPostFailed,
  notifyGenerationFailed,
  notifyApiHealthDegraded,
  notifySystemError,
  notifyYouTubePublished,
  notifyYouTubeCommentReplied,
  notifyYouTubeFailed,
  logSystemErrorEvent,
  getRecentRateLimitEvents,
  getRecentSystemErrors,
  getRecentHealthChanges,
} from "@/lib/notifier";
import {
  isYouTubeConfigured,
  getRecentVideos,
  listCommentThreads,
  listCommentReplies,
  replyToYouTubeComment,
  getOwnChannelInfo,
} from "@/lib/youtube";
import { publishPostToYouTubeShort } from "@/lib/youtubePublish";
import { shortPlan, DEFAULT_SHORT_SECONDS } from "@/lib/shortLength";

// Our own channel handle -- used to skip AI-generated replies in comment lists
// (self-reply detection keys off the brand/YouTube channel handle).
const OWN_USERNAME = (process.env.BRAND_HANDLE ?? "").toLowerCase();

// -- Branded fallback replies (used only when Groq is unavailable) -------------
// Built per-brand so each white-label account falls back to its OWN handle/CTA.
function fallbackCommentReplies(brand?: BrandConfig | null): string[] {
  const handle = brand ? atHandle(brand) : (OWN_USERNAME ? `@${OWN_USERNAME}` : "this account");
  const cta    = brand?.commentCtaLine?.trim() || "Follow for more!";
  const niche  = brand?.niche?.trim() || "great";
  return [
    `Glad you are engaging! ${cta} â¤ï¸`,
    `Thanks for stopping by! More ${niche} content coming soon â¤ï¸`,
    `Appreciate the engagement! Follow ${handle} for daily updates! ðŸ™`,
    "Love seeing the community engage! More on the way ðŸ’™",
    `Great to have you here! ${cta} âœ¨`,
  ];
}

// -- AI-powered comment reply generator ----------------------------------------
// Falls back to a branded generic reply when the AI provider is unavailable.
// Pass the active account's `brand` so the fallback resolves to that account's skin.
export async function generateAICommentReply(
  commentText: string,
  username: string,
  postContext: PostCommentContext,
  brand?: BrandConfig | null,
  brandId?: string | null,
): Promise<string | null> {
  try {
    // Comment replies use the configured REPLY task chain (Settings â†’ AI Config â†’
    // Reply): the operator picks the primary provider/model + ordered fallbacks
    // that answer YouTube comments. getAIClient("reply") returns the primary
    // client for that lane (falling down the chain when a key is missing).
    const ai = await getAIClient("reply", brandId ?? null);
    const reply = await ai.generateCommentReply(commentText, username, postContext);
    const clean = (reply ?? "").trim();
    if (clean) {
      console.log(`[Catchup] Comment reply generated via reply chain (${clean.length} chars)`);
      return clean;
    }
    throw new Error("empty AI comment reply");
  } catch (err) {
    console.warn("[Catchup] AI comment reply unavailable -- using fallback reply:", String(err));
    // Return a varied fallback so the comment still gets acknowledged
    const fallbacks = fallbackCommentReplies(brand);
    return fallbacks[Math.floor(Math.random() * fallbacks.length)];
  }
}

// â”€â”€ Multi-brand context â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Everything the per-brand pipeline needs, resolved ONCE per brand per cycle so the
// engine never reaches for module-level env consts. The primary brand's creds come
// from ENV (via getBrandCredentials), preserving the exact single-account behaviour.
export interface BrandContext {
  brandId:    string;            // resolved brand id (always a real id)
  isPrimary:  boolean;
  primaryId:  string;            // the primary brand id (for null==primary filtering)
  ownHandle:  string;            // lowercased own channel handle (self-reply detection)
  ytCreds:    { clientId: string; clientSecret: string; refreshToken: string } | undefined;
  hasYouTube:   boolean;
  // Lazily-read brand preferences (readPreferencesForBrand). Cached on the context
  // so each per-brand function doesn't re-read independently within a cycle.
  prefs: Awaited<ReturnType<typeof readPreferencesForBrand>>;
}

// YouTube creds for youtube.ts/youtubePublish.ts calls: undefined â‡’ env/primary.
function ytCredsFor(creds: BrandCredentials): BrandContext["ytCreds"] {
  if (creds.ytClientId && creds.ytClientSecret && creds.ytRefreshToken) {
    return { clientId: creds.ytClientId, clientSecret: creds.ytClientSecret, refreshToken: creds.ytRefreshToken };
  }
  return undefined;
}

/**
 * Build the full per-brand context for one brand. The primary brand resolves its
 * creds from ENV (getBrandCredentials), so passing undefined ytCreds there makes
 * the youtube.ts helpers fall back to env â€” i.e. byte-identical to today.
 */
async function buildBrandContext(brand: BrandRecord, primaryId: string): Promise<BrandContext> {
  const creds = await getBrandCredentials(brand.id);
  const prefs = await readPreferencesForBrand(brand.id);
  return {
    brandId:    brand.id,
    isPrimary:  brand.isPrimary,
    primaryId,
    // Own channel handle for self-reply detection: prefer the brand's YT channel
    // title, then the env BRAND_HANDLE fallback.
    ownHandle:  (brand.ytChannelTitle || OWN_USERNAME).toLowerCase(),
    ytCreds:    brand.isPrimary ? undefined : ytCredsFor(creds),
    hasYouTube:   brand.hasYouTube   || !!(creds.ytClientId && creds.ytRefreshToken) || (brand.isPrimary && isYouTubeConfigured()),
    prefs,
  };
}

// Build the primary brand's context on demand. Used by exported entry points
// (scheduleAutoStory / runAutoGeneratePosts / runAutoGenerateYouTube) when an
// external caller doesn't supply a context â€” preserves single-account behaviour.
async function getPrimaryBrandContext(): Promise<BrandContext> {
  const primaryId = await getPrimaryBrandId();
  const brands = await listBrands();
  const primary = brands.find((b) => b.isPrimary)
    ?? { id: primaryId, label: "Primary", isPrimary: true, active: true,
         ytChannelTitle: "", hasYouTube: false } as BrandRecord;
  return buildBrandContext(primary, primaryId);
}

// Normalise the dual call shapes of the per-brand functions. The new engine passes
// (ctx, errors); legacy API-route callers pass (errors, ...) and mean "the primary
// brand". Returns a resolved { ctx, errors } either way.
async function normalizeBrandArgs(
  a: BrandContext | string[],
  b?: string[] | string,
): Promise<{ ctx: BrandContext; errors: string[] }> {
  if (Array.isArray(a)) {
    // Legacy form: (errors, ...). Build/return the primary context.
    return { ctx: await getPrimaryBrandContext(), errors: a };
  }
  return { ctx: a, errors: (b as string[]) ?? [] };
}

// â”€â”€ null == primary DB filtering â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Contract: a NULL brandId on Post/ScheduledPost/Comment/Analytics rows means
// "the primary brand". When operating AS the primary brand we must match rows where
// brandId IS NULL *or* brandId == primaryId. For a non-primary brand we match that
// brand's id exactly. Returns a Prisma where-fragment to spread into queries.
function brandFilter(ctx: BrandContext): Record<string, unknown> {
  if (ctx.isPrimary) {
    return { OR: [{ brandId: null }, { brandId: ctx.primaryId }] };
  }
  return { brandId: ctx.brandId };
}

// The brandId value to STAMP on rows this brand creates.
//   â€¢ PRIMARY brand â†’ null. This keeps the primary path's DB writes byte-identical
//     to today (rows have always had brandId == NULL, and brandFilter matches NULL
//     OR primaryId for the primary brand, so reads are unaffected either way).
//   â€¢ NON-PRIMARY brand â†’ its real id, so its rows are isolated from the primary.
function brandIdForWrite(ctx: BrandContext): string | null {
  return ctx.isPrimary ? null : ctx.brandId;
}

// --- Get a real user ID for ActivityLog FK (falls back to skip logging) -------
let _systemUserId: string | null = null;
async function getSystemUserId(): Promise<string | null> {
  if (_systemUserId) return _systemUserId;
  try {
    const user = await prisma.user.findFirst({ select: { id: true }, orderBy: { createdAt: "asc" } });
    _systemUserId = user?.id ?? null;
    return _systemUserId;
  } catch {
    return null;
  }
}

// Silent activity log -- never throws, never blocks the main operation
async function safeLog(data: {
  action: string; entity: string; entityId: string; metadata: object;
}) {
  try {
    const userId = await getSystemUserId();
    if (!userId) return; // no users in DB yet -- skip silently
    await prisma.activityLog.create({ data: { userId, ...data, metadata: data.metadata as any } });
  } catch {
    // swallow -- activity logging is best-effort
  }
}

// â”€â”€ Topic rotation + auto-expansion â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Every topic ever used (for stories or posts) is recorded in ActivityLog as
// action "AUTO_TOPIC_USED" with entity = "story" | "post" and entityId = topic.
// This gives an EXACT, persistent list of used topics so nothing repeats.

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

async function getUsedTopics(kind: "story" | "post"): Promise<Set<string>> {
  try {
    const logs = await prisma.activityLog.findMany({
      where:  { action: "AUTO_TOPIC_USED", entity: kind },
      select: { entityId: true },
    });
    return new Set(logs.map((l) => norm(l.entityId ?? "")).filter(Boolean));
  } catch {
    return new Set<string>();
  }
}

async function logTopicUsed(kind: "story" | "post", topic: string): Promise<void> {
  await safeLog({ action: "AUTO_TOPIC_USED", entity: kind, entityId: topic, metadata: { topic } });
}

// Ask the AI for NEW topics in the same style as the configured ones, excluding
// everything already used. Returns a de-duplicated, unused list (may be empty).
async function generateSimilarTopics(
  baseTopics: string[],
  usedTopics: Set<string>,
  count = 12,
  brand?: BrandConfig | null,
): Promise<string[]> {
  try {
    const ai = await getAIClient();
    const usedList = [...usedTopics];
    const niche  = brand?.niche?.trim() || "this account's topic";
    const handle = brand ? atHandle(brand) : "this account";
    const prompt = `You manage a ${niche} YouTube channel (${handle}).

EXISTING TOPIC STYLE (match this style, tone, and subject area):
${baseTopics.map((t) => `- ${t}`).join("\n")}

ALREADY USED â€” never repeat, rephrase, or closely paraphrase any of these:
${usedList.length ? usedList.map((t) => `- ${t}`).join("\n") : "- (none yet)"}

Generate ${count} BRAND-NEW ${niche} content topics in the same style and subject area as the existing ones. Each must be a genuinely DIFFERENT SUBJECT/THEME from every topic above â€” not a reworded angle on the same theme (e.g. if "saving money on groceries" is used, do NOT return "cutting your grocery bill"). Each topic must also be distinct from the others you return.
Return ONLY a JSON array of plain topic strings. No numbering, no commentary.`;
    const raw = await ai.generateContent(
      prompt,
      `You are a ${niche} content strategist. Return ONLY a valid JSON array of topic strings.`,
      900,
    );
    const cleaned = raw.replace(/```json\n?/gi, "").replace(/```\n?/gi, "").trim();
    const match   = cleaned.match(/\[[\s\S]*\]/);
    const arr     = JSON.parse(match ? match[0] : cleaned) as unknown[];
    const baseSet = new Set(baseTopics.map(norm));
    const seen    = new Set<string>();
    const out: string[] = [];
    for (const item of arr) {
      const t = String(item ?? "").trim();
      const n = norm(t);
      if (!t || seen.has(n) || usedTopics.has(n) || baseSet.has(n)) continue;
      seen.add(n);
      out.push(t);
    }
    return out;
  } catch (err) {
    console.warn("[Topics] AI topic expansion failed:", String(err));
    return [];
  }
}

/**
 * Pick the next topic for a story/post run.
 * Order of preference:
 *   1. A configured topic that has NOT been used yet.
 *   2. If all configured topics are used â†’ AI-generate fresh similar topics
 *      (excluding everything used) and pick one.
 *   3. Absolute last resort (AI unavailable): least-recently used configured topic.
 * `extraUsed` lets a single multi-post run avoid picking the same topic twice.
 * The chosen topic is logged as used (unless dryLog=true) so it never repeats.
 */
async function pickNextTopic(
  kind: "story" | "post",
  configured: string[],
  extraUsed: Set<string> = new Set(),
  brand?: BrandConfig | null,
): Promise<string | null> {
  if (!configured.length) return null;

  const used = await getUsedTopics(kind);
  for (const e of extraUsed) used.add(norm(e));

  // 1. Unused configured topic
  let pool = configured.filter((t) => !used.has(norm(t)));

  // 2. All configured used â†’ generate fresh similar topics
  if (pool.length === 0) {
    console.log(`[Topics] All ${configured.length} configured ${kind} topics used â€” generating fresh similar topics`);
    const fresh = await generateSimilarTopics(configured, used, 12, brand);
    pool = fresh.filter((t) => !used.has(norm(t)));
    if (pool.length) {
      console.log(`[Topics] Generated ${pool.length} new ${kind} topics, e.g. "${pool[0]}"`);
    }
  }

  // 3. Last resort â€” AI unavailable and everything used: reuse configured
  //    (still avoid anything used this run) to never block content creation.
  if (pool.length === 0) {
    pool = configured.filter((t) => !extraUsed.has(norm(t)));
    if (pool.length === 0) pool = configured;
    console.warn(`[Topics] Falling back to configured ${kind} topic (could not generate new ones)`);
  }

  const topic = pool[Math.floor(Math.random() * pool.length)];
  await logTopicUsed(kind, topic);
  return topic;
}

// -- Persist a post/scheduled-post id with a short retry ------------------------
// After a SUCCESSFUL external publish, the id-persist write MUST survive a
// transient DB blip. If it were lost, the SP would stay PENDING and the next
// catchup tick would re-publish → duplicate upload. Retry a few times with a small
// backoff so a momentary connection hiccup doesn't cause a re-upload.
async function persistWithRetry(
  fn: () => Promise<unknown>,
  label: string,
  attempts = 3,
): Promise<void> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      await fn();
      return;
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    }
  }
  // Exhausted retries — surface loudly. The id is already known externally, so a
  // human/next reconciliation must record it; do NOT silently swallow.
  console.error(`[Catchup] id-persist FAILED after ${attempts} attempts (${label}):`, lastErr);
  throw lastErr;
}

// --- Summary returned to caller -----------------------------------------------
export interface CatchupResult {
  scheduledPublished: number;
  scheduledFailed:    number;
  newComments:        number;
  commentsReplied:    number;  // actual replies sent (new + retried)
  dmsReplied:         number;
  youtubeCommentsReplied?: number; // Grok replies sent on YouTube videos
  errors:             string[];
  ranAt:              string;
}

// Given a list of "HH:MM" times and a timezone, return the UTC Date of the NEXT
// upcoming occurrence (today if a slot is still ahead, otherwise tomorrow's earliest
// slot). Used to schedule deferred posts at their configured publish time(s).
function nextUpcomingTimeUTC(times: string[], tz: string): Date {
  const now = new Date();
  // Today's calendar date in the target tz.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const pp: Record<string, number> = {};
  for (const p of parts) if (p.type !== "literal") pp[p.type] = parseInt(p.value, 10);
  const y = pp["year"]!, mo = pp["month"]!, d = pp["day"]!;

  const sorted = [...times].sort();
  // Earliest slot today that is still in the future.
  for (const t of sorted) {
    const [hh, mm] = t.split(":").map(Number);
    const cand = wallTimeToUTC(y, mo, d, hh, mm, tz);
    if (cand.getTime() > now.getTime()) return cand;
  }
  // All of today's slots have passed â†’ earliest slot tomorrow.
  const tomorrow = new Date(now);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  // Re-derive tomorrow's tz-local calendar date.
  const tParts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(tomorrow);
  const tpp: Record<string, number> = {};
  for (const p of tParts) if (p.type !== "literal") tpp[p.type] = parseInt(p.value, 10);
  const [hh, mm] = sorted[0].split(":").map(Number);
  return wallTimeToUTC(tpp["year"]!, tpp["month"]!, tpp["day"]!, hh, mm, tz);
}

// Today's tz-local calendar info: the weekday (0=Sun..6=Sat) and the [start,end)
// UTC window bounding the tz-local day. Used to (a) pick the right dailySchedule
// entry for today and (b) count how many deferred Reels were already scheduled for
// today's tz-day so each Short maps to a distinct reel slot.
function tzDayInfo(tz: string): { weekday: number; startUTC: Date; endUTC: Date } {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short",
  }).formatToParts(now);
  const pp: Record<string, string> = {};
  for (const p of parts) if (p.type !== "literal") pp[p.type] = p.value;
  const y = parseInt(pp["year"], 10), mo = parseInt(pp["month"], 10), d = parseInt(pp["day"], 10);
  const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const weekday = WD[pp["weekday"]] ?? now.getUTCDay();
  // 00:00 today (tz) and 00:00 tomorrow (tz), both as UTC instants.
  const startUTC = wallTimeToUTC(y, mo, d, 0, 0, tz);
  const endUTC   = new Date(startUTC.getTime() + 24 * 60 * 60 * 1000);
  return { weekday, startUTC, endUTC };
}

// Robust tz-local weekday (0=Sun..6=Sat) for an arbitrary instant, using the same
// Intl short-name â†’ index mapping as tzDayInfo. Replaces the locale/engine-fragile
// `new Date(d.toLocaleString("en-US",{timeZone})).getDay()` pattern (which depends on
// the runtime being able to re-parse a localized date string).
function tzWeekday(date: Date, tz: string): number {
  const wd = new Intl.DateTimeFormat(undefined, { timeZone: tz, weekday: "short" })
    .formatToParts(date)
    .find((p) => p.type === "weekday")?.value ?? "";
  const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return WD[wd] ?? date.getUTCDay();
}

// Resolve the UTC Date for a SPECIFIC "HH:MM" slot on today's tz-day. If that slot
// has already passed today, fall back to nextUpcomingTimeUTC over the full slot list
// (so the Reel still lands on a real upcoming time rather than in the past).
function slotTimeUTC(slot: string, allSlots: string[], tz: string): Date {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const pp: Record<string, number> = {};
  for (const p of parts) if (p.type !== "literal") pp[p.type] = parseInt(p.value, 10);
  const [hh, mm] = slot.split(":").map(Number);
  const cand = wallTimeToUTC(pp["year"]!, pp["month"]!, pp["day"]!, hh, mm, tz);
  if (cand.getTime() > now.getTime()) return cand;
  return nextUpcomingTimeUTC(allSlots.length ? allSlots : [slot], tz);
}

// --- 1. Publish overdue scheduled posts ---------------------------------------
// YouTube-only: publishes overdue PENDING scheduled Shorts. Overloads: the
// multi-brand engine calls (ctx, errors); legacy API-route callers still call
// (errors, _b, _c) and operate as the primary brand (the trailing args are unused
// and retained only for call-site compatibility). The legacy form builds the
// primary context from ENV internally.
export async function publishOverdueScheduled(ctx: BrandContext, errors: string[]): Promise<{ published: number; failed: number }>;
export async function publishOverdueScheduled(errors: string[], _b?: string, _c?: string): Promise<{ published: number; failed: number }>;
export async function publishOverdueScheduled(
  a: BrandContext | string[],
  b?: string[] | string,
  _c?: string,
): Promise<{ published: number; failed: number }> {
  const { ctx, errors } = await normalizeBrandArgs(a, b);
  let published = 0, failed = 0;

  // -- Self-heal: reap stuck "__CLAIMING__" locks ---------------------------------
  // The claim guard below flips PENDINGâ†’FAILED("__CLAIMING__:<ts>") to lock an entry
  // while it publishes. If the process restarts mid-publish, the row stays locked
  // forever and is never retried. Reset any such lock whose CLAIM is older than
  // CLAIM_MAX_AGE back to PENDING. CRITICAL: we measure the CLAIM age (the <ts>
  // embedded in the sentinel), NOT the row's createdAt â€” keying on createdAt instantly
  // reaped the active claim of any post older than the cutoff mid-publish, which
  // re-queued it for a concurrent sweep and produced DUPLICATE posts.
  //
  // Why 45 min (was 10): the age must exceed the WORST-CASE legitimate publish, not
  // the typical one. A claimed Short first QUEUES behind the process-wide serialized
  // render lock (every other in-flight video render finishes first), then runs its own
  // ffmpeg render + TTS + upload â€” back-to-back builds can legitimately hold a claim
  // well past 10 min. The old 10-min cutoff reaped such ACTIVE claims, letting a second
  // sweep re-claim the row and DOUBLE-PUBLISH. 45 min covers a realistic worst-case
  // queue while still self-healing genuinely dead claims (crashed process) within the hour.
  const CLAIM_MAX_AGE_MS = 45 * 60 * 1000;
  const claimCutoffMs = Date.now() - CLAIM_MAX_AGE_MS;
  const stuckClaims = await prisma.scheduledPost.findMany({
    where:  { status: "FAILED", error: { startsWith: "__CLAIMING__" }, ...brandFilter(ctx) },
    select: { id: true, error: true },
  }).catch((e: any) => {
    // Don't silently swallow â€” if this read fails, stuck claims go un-reaped and
    // those posts never publish, with no signal otherwise.
    console.warn("[Catchup] Claim-lock self-heal: stuck-claim read failed (stuck posts may not be reaped):", e?.message ?? e);
    return [] as { id: string; error: string | null }[];
  });
  const reapIds = stuckClaims
    .filter((s) => {
      const ts = Number(String(s.error ?? "").split(":")[1] ?? 0);
      // No embedded timestamp (legacy "__CLAIMING__") OR claimed >45 min ago â†’ reap.
      return !ts || ts < claimCutoffMs;
    })
    .map((s) => s.id);
  if (reapIds.length > 0) {
    const reaped = await prisma.scheduledPost.updateMany({
      where: { id: { in: reapIds }, status: "FAILED", error: { startsWith: "__CLAIMING__" } },
      data:  { status: "PENDING", error: null },
    }).catch(() => ({ count: 0 }));
    if (reaped.count > 0) {
      console.log(`[Catchup] Claim-lock self-heal: reset ${reaped.count} stuck claim(s) (claimed >${CLAIM_MAX_AGE_MS / 60_000}min ago) to PENDING`);
    }
  }

  const overdue = await prisma.scheduledPost.findMany({
    where: {
      status:       "PENDING",
      scheduledFor: { lte: new Date() },
      ...brandFilter(ctx),
    },
    orderBy: { scheduledFor: "asc" },
  });

  for (const sp of overdue) {
    try {
      // â”€â”€ Guard 1: skip if the linked Post was already (or is being) published â”€â”€
      // When a user clicks "Publish Now" on a post, both the Post record and the
      // ScheduledPost record exist. The manual publish route marks Post as PUBLISHED.
      // The scheduler must not publish the same content again.
      //
      // BUG FIX (double-publish): the old guard only skipped when Post.status was
      // exactly "PUBLISHED". But the manual publish is SLOW (image render + IG/YT API
      // = 30-60s+), and it sets youtubeVideoId/instagramPostId on the Post as it goes.
      // If this scheduler run hit the window AFTER the manual route stamped a media id
      // but BEFORE it flipped status to PUBLISHED, the guard missed it and the
      // scheduler published a duplicate. We now ALSO skip when the linked Post already
      // carries an instagramPostId or youtubeVideoId â€” i.e. it has been (or is being)
      // published â€” and finalize this SP to that id instead of re-publishing.
      if (sp.postId) {
        const linkedPost = await prisma.post.findUnique({
          where:  { id: sp.postId },
          select: { status: true, instagramPostId: true, youtubeVideoId: true },
        });
        const alreadyPublished =
          linkedPost?.status === "PUBLISHED" ||
          !!linkedPost?.instagramPostId ||
          !!linkedPost?.youtubeVideoId;
        if (alreadyPublished) {
          await prisma.scheduledPost.update({
            where: { id: sp.id },
            data:  {
              status:          "PUBLISHED",
              instagramPostId: linkedPost?.instagramPostId ?? undefined,
              youtubeVideoId:  linkedPost?.youtubeVideoId ?? undefined,
              publishedAt:     new Date(),
            },
          }).catch(() => {});
          published++;
          console.log(`[Catchup] Skipping SP ${sp.id} â€” linked post already published/in-flight (ig:${linkedPost?.instagramPostId ?? "â€”"} yt:${linkedPost?.youtubeVideoId ?? "â€”"})`);
          continue;
        }
      }

      // â”€â”€ Guard 2: atomic claim â€” prevents two concurrent scheduler calls â”€â”€â”€â”€
      // Both /api/scheduler/check (every 30 s) and runCatchup (every 5 min) call
      // publishOverdueScheduled. If they overlap, both could pick up the same
      // PENDING ScheduledPost and publish twice. We atomically flip the status to
      // FAILED with a sentinel error to "lock" this entry. Only the call that
      // gets count=1 proceeds; the other sees count=0 and skips.
      // On success the entry is reset to PUBLISHED; on real failure the catch
      // block overwrites the sentinel with the real error message.
      // The sentinel embeds the CLAIM time so the self-heal reaper above can tell an
      // ACTIVE claim from a genuinely stuck one (reap by claim age, NOT row createdAt).
      const claimed = await prisma.scheduledPost.updateMany({
        where: { id: sp.id, status: "PENDING" },
        data:  { status: "FAILED", error: `__CLAIMING__:${Date.now()}` },
      }).catch(() => ({ count: 0 }));
      if (claimed.count === 0) {
        console.log(`[Catchup] Skipping SP ${sp.id} â€” already claimed by a concurrent scheduler call`);
        continue;
      }

      // â”€â”€ Platform routing (YouTube-only build) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      // This build publishes ONLY YouTube Shorts. Determine the entry's platform;
      // legacy "both" is treated as YouTube (the IG side no longer exists), and any
      // legacy "instagram"-only entry is skipped (see below). Default to "youtube".
      let platform = (sp as any).platform || "youtube";
      let routedPost: any = null;
      if (sp.postId) {
        routedPost = await prisma.post.findUnique({ where: { id: sp.postId } }).catch(() => null);
      }
      // Normalise: "both" (legacy IG+YT) â†’ YouTube-only.
      if (platform === "both") platform = "youtube";

      // â”€â”€ Skip legacy Instagram-only entries â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      // Instagram publishing has been removed. A ScheduledPost/Post whose platform is
      // "instagram" (and not a YouTube post) can never publish here â€” mark it FAILED
      // with a clear reason and move on rather than re-claiming it every tick.
      if (platform === "instagram") {
        await prisma.scheduledPost.update({
          where: { id: sp.id },
          data:  { status: "FAILED", error: "Instagram publishing is not supported (YouTube-only build)", retryCount: { increment: 1 } },
        }).catch(() => {});
        console.log(`[Catchup] Skipping SP ${sp.id} â€” Instagram-only entry (YouTube-only build)`);
        continue;
      }

      // â”€â”€ YOUTUBE branch â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      // Publish a Short directly from the post content.
      if (platform === "youtube") {
        if (!isYouTubeConfigured(ctx.ytCreds)) {
          console.warn(`[Catchup] SP ${sp.id} is youtube-only but YouTube is not configured â€” marking FAILED`);
          await prisma.scheduledPost.update({
            where: { id: sp.id },
            data:  { status: "FAILED", error: "YouTube not configured", retryCount: { increment: 1 } },
          }).catch(() => {});
          failed++;
          continue;
        }
        // Idempotency: re-read the freshest youtubeVideoId from the DB (not the
        // stale in-memory sp). If a video already exists (uploaded by a concurrent
        // run / earlier retry), just finalise instead of uploading a duplicate.
        const freshYt = await prisma.scheduledPost.findUnique({
          where: { id: sp.id }, select: { youtubeVideoId: true },
        }).catch(() => null);
        const existingVideoId = freshYt?.youtubeVideoId ?? sp.youtubeVideoId;
        if (existingVideoId) {
          await prisma.scheduledPost.update({
            where: { id: sp.id },
            data:  { status: "PUBLISHED", publishedAt: new Date(), youtubeVideoId: existingVideoId, error: null },
          }).catch(() => {});
          if (sp.postId) {
            await prisma.post.updateMany({
              where: { id: sp.postId },
              data:  { status: "PUBLISHED", youtubeVideoId: existingVideoId, publishedAt: new Date() },
            }).catch(() => {});
          }
          published++;
          continue;
        }
        try {
          const yt = ctx.prefs.youtube;
          const ytPost = routedPost ?? {
            type:       sp.postType || "EDUCATIONAL",
            title:      sp.title,
            content:    sp.content,
            hashtags:   sp.hashtags ?? [],
          };
          const { videoId } = await publishPostToYouTubeShort(ytPost as any, {
            privacy:           yt?.privacy ?? "public",
            secondsPerImage:   yt?.secondsPerImage ?? 5,
            targetShortSeconds: yt?.targetShortSeconds ?? DEFAULT_SHORT_SECONDS,
            descriptionSuffix: yt?.descriptionSuffix ?? "",
          }, ctx.ytCreds);
          // Publish succeeded externally — persist the id with retry so a transient
          // DB blip can't drop it and cause a re-upload next tick (duplicate Short).
          await persistWithRetry(() => prisma.scheduledPost.update({
            where: { id: sp.id },
            data:  { status: "PUBLISHED", publishedAt: new Date(), youtubeVideoId: videoId, error: null },
          }), `YT sp ${sp.id}`);
          if (sp.postId) {
            await persistWithRetry(() => prisma.post.updateMany({
              where: { id: sp.postId! },
              data:  { status: "PUBLISHED", youtubeVideoId: videoId, publishedAt: new Date() },
            }), `YT post ${sp.postId}`);
          }
          await safeLog({ action: "YOUTUBE_PUBLISHED", entity: "ScheduledPost", entityId: sp.id,
            metadata: { youtubeVideoId: videoId, platform: "youtube", catchup: true,
                        title: sp.title, url: `https://youtube.com/shorts/${videoId}` } });
          published++;
          console.log(`[Catchup] Published YouTube Short: ${sp.id} â†’ https://youtube.com/shorts/${videoId}`);
          notifyYouTubePublished({ spId: sp.id, videoId, title: sp.title })
            .catch((e: any) => console.warn("[Catchup] youtube-only publish notify failed:", e?.message));
        } catch (ytErr: any) {
          const msg = `YouTube publish failed: ${ytErr?.message ?? ytErr}`;
          errors.push(`Schedule ${sp.id}: ${msg}`);
          failed++;
          await prisma.scheduledPost.update({
            where: { id: sp.id },
            data:  { status: "FAILED", error: msg, retryCount: { increment: 1 } },
          }).catch(() => {});
          console.error(`[Catchup] ${msg}`);
          logSystemErrorEvent(`YouTube Publish Failed: ${sp.title}`, msg);
          notifyYouTubeFailed({ spId: sp.id, title: sp.title, error: msg, context: "YouTube" })
            .catch((e: any) => console.warn("[Catchup] youtube-only failure notify failed:", e?.message));
        }
        continue;
      }
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      errors.push(`Schedule ${sp.id}: ${msg}`);
      failed++;
      await prisma.scheduledPost.update({
        where: { id: sp.id },
        data: { status: "FAILED", error: msg, retryCount: { increment: 1 } },
      }).catch(() => {});
      console.error(`[Catchup] Failed to publish ${sp.id}:`, msg);
      // Log for daily digest
      logSystemErrorEvent(`Publish Failed: ${sp.title}`, msg);
      // Real-time alert
      notifyPostFailed({
        postId:   sp.id,
        postType: sp.postType ?? undefined,
        title:    sp.title,
        error:    msg,
        isStory:  sp.postType === "STORY",
      }).catch((emailErr: any) => {
        // Log â€” never silently swallow email errors (helps diagnose SMTP/Resend issues)
        console.warn("[Catchup] Publish failure email could not be sent:", emailErr?.message);
      });
    }
  }

  return { published, failed };
}

// In-memory set to avoid duplicate YouTube comment replies within the same server
// session. Resets on server restart -- the first run after restart re-checks and
// replies if needed. The EXPORTED singleton is the PRIMARY brand's set; per-brand
// variants live in the Map below (see repliedYouTubeCommentSet).
export const _repliedYouTubeCommentIds = new Set<string>(); // YouTube comment IDs

// Per-brand dedupe set. One brand's replies must never suppress another's. The
// primary brand reuses the exported singleton above for full backward compat.
const _repliedYouTubeCommentIdsByBrand = new Map<string, Set<string>>();

function repliedYouTubeCommentSet(ctx: BrandContext): Set<string> {
  if (ctx.isPrimary) return _repliedYouTubeCommentIds;
  let s = _repliedYouTubeCommentIdsByBrand.get(ctx.brandId);
  if (!s) { s = new Set<string>(); _repliedYouTubeCommentIdsByBrand.set(ctx.brandId, s); }
  return s;
}

// Bounded add â€” caps each in-memory dedupe Set so it can't grow unbounded over a
// long-lived server session (slow memory creep). When the cap is exceeded we drop
// the oldest entries (Set preserves insertion order) to make room. ~5000 ids is
// far more than any realistic catch-up window needs.
const _REPLIED_SET_CAP = 5000;
function boundedAdd(set: Set<string>, id: string): void {
  if (!id) return;
  set.add(id);
  if (set.size > _REPLIED_SET_CAP) {
    const dropCount = set.size - _REPLIED_SET_CAP;
    const it = set.values();
    for (let i = 0; i < dropCount; i++) {
      const oldest = it.next().value;
      if (oldest === undefined) break;
      set.delete(oldest);
    }
  }
}

// Map twin of boundedAdd â€” caps a module-level Map so it can't grow unbounded over
// a long-lived server session. Delete-then-set keeps insertion order tracking
// recency, so eviction past the cap drops the LEAST-recently-touched entries.
function boundedMapSet<V>(map: Map<string, V>, key: string, value: V, cap: number): void {
  if (!key) return;
  if (map.has(key)) map.delete(key); // re-insert so insertion order = recency
  map.set(key, value);
  if (map.size > cap) {
    const dropCount = map.size - cap;
    const it = map.keys();
    for (let i = 0; i < dropCount; i++) {
      const oldest = it.next().value;
      if (oldest === undefined) break;
      map.delete(oldest);
    }
  }
}

// --- Grok auto-reply to YouTube comments --------------------------------------
// Mirrors fetchMissedComments() but for the channel's recent Shorts/videos.
// Best-effort: never throws. Returns the number of replies sent.
// Lightweight throttle so YouTube comments are checked at most ~every 2 min, even
// when runCatchup() is invoked more often (30s/2-min dashboard polls). This is a
// SEPARATE gate from the 5-min catchup comment debounce so YT replies aren't late.
// Per-brand throttle so one brand's YT comment check can't suppress another's.
const _lastYouTubeCommentCheckByBrand = new Map<string, number>();
const YT_COMMENT_CHECK_MS = 2 * 60 * 1000; // throttle floor; actually driven by the 5-min catchup loop

// Per-brand cache of the recent-videos list so we don't re-fetch it (and spend extra
// quota) on back-to-back checks. Refreshed every few minutes, keyed by brandId.
const _ytVideosCacheByBrand = new Map<string, Awaited<ReturnType<typeof getRecentVideos>>>();
const _ytVideosCacheAtByBrand = new Map<string, number>();
const YT_VIDEOS_CACHE_MS = 4 * 60 * 1000; // refresh the video list ~every 4 min

// Quota guard for nested-reply fetches. Fetching replies for EVERY thread on EVERY
// 5-min run (up to 20 threads Ã— 5 videos = 100 comments.list calls/run) burned
// ~30k units/day â€” 3Ã— the 10k default daily quota â€” and killed uploads too.
// We (a) cap reply fetches per run and (b) remember when each thread's replies were
// last fetched (bounded Map, oldest-touched evicted) and re-fetch a thread at most
// every 30 min. Worst case is now ~5 threads.list + 10 replies.list per run â‰ˆ ~4.3k
// units/day. Trade-off: a reply-to-a-reply may be picked up ~30 min late â€” fine for a bot.
const _ytThreadReplyFetchAt = new Map<string, number>(); // threadId â†’ last reply-fetch ms
const YT_THREAD_REPLY_CACHE_CAP = 2000;
const YT_THREAD_REPLY_TTL_MS = 30 * 60 * 1000;   // re-check a thread's replies ~every 30 min
const YT_MAX_REPLY_FETCHES_PER_RUN = 10;         // hard per-run replies.list budget

/**
 * Reply to new YouTube comments (and replies-to-replies) for ONE brand. Runs from
 * the 5-min catchup loop (YouTube has no comment webhook, so this is poll-based).
 * `maxVideos` caps how many recent videos are scanned per run. Uses the brand's
 * YouTube creds for every youtube.ts call and the brand's own-channel identity.
 */
export async function replyToYouTubeComments(ctx: BrandContext, maxVideos = 5): Promise<number> {
  if (!isYouTubeConfigured(ctx.ytCreds)) return 0;

  // Throttle: skip if we checked very recently (guards against overlapping calls).
  const lastCheck = _lastYouTubeCommentCheckByBrand.get(ctx.brandId) ?? 0;
  const sinceLast = Date.now() - lastCheck;
  if (lastCheck && sinceLast < YT_COMMENT_CHECK_MS) {
    return 0;
  }
  _lastYouTubeCommentCheckByBrand.set(ctx.brandId, Date.now());

  const yt = ctx.prefs?.youtube as any;
  if (!yt?.enabled) return 0;
  // Default ON when undefined â€” only skip when explicitly disabled.
  if (yt.replyToComments === false) return 0;

  const repliedSet = repliedYouTubeCommentSet(ctx);

  // Our own channel identity â€” used to skip replying to our own comments/replies
  // (prevents reply loops). Primary signal is the channel id; the channel TITLE and
  // @handle (fetched live from the API for THIS brand's creds) are robust fallbacks
  // for the case where the channel-id lookup transiently fails.
  const ownInfo = await getOwnChannelInfo(ctx.ytCreds).catch(() => ({ id: "", title: "", handle: "" }));
  const ownChannelId = ownInfo.id || "";
  // Normalise an author/handle for identity comparison: lowercase, drop leading
  // "@", remove spaces. This makes the channel TITLE (e.g. "My Channel") match the
  // comment author display name ("@MyChannel") and the @handle ("@mychannel").
  const norm = (s: string) => (s ?? "").toLowerCase().replace(/^@+/, "").replace(/\s+/g, "").trim();
  const ownAuthors = new Set(
    [ownInfo.title, ownInfo.handle,
      ctx.isPrimary ? process.env.YOUTUBE_CHANNEL_TITLE : "",
      ctx.ownHandle]
      .filter(Boolean)
      .map((s) => norm(String(s))),
  );
  const isOwn = (authorChannelId: string, author: string): boolean => {
    if (ownChannelId && authorChannelId && authorChannelId === ownChannelId) return true;
    return ownAuthors.has(norm(author));
  };

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  let replied = 0;
  // Per-RUN budget for nested-reply fetches across ALL videos (see the quota-guard
  // comment on _ytThreadReplyFetchAt above).
  let replyFetchesThisRun = 0;

  let videos: Awaited<ReturnType<typeof getRecentVideos>> = [];
  try {
    // Use the per-brand cached video list; refresh only every ~4 min to save quota.
    const cache   = _ytVideosCacheByBrand.get(ctx.brandId) ?? [];
    const cacheAt = _ytVideosCacheAtByBrand.get(ctx.brandId) ?? 0;
    if (cache.length === 0 || Date.now() - cacheAt > YT_VIDEOS_CACHE_MS) {
      const fresh = await getRecentVideos(5, ctx.ytCreds);
      _ytVideosCacheByBrand.set(ctx.brandId, fresh);
      _ytVideosCacheAtByBrand.set(ctx.brandId, Date.now());
      videos = fresh.slice(0, Math.max(1, maxVideos));
    } else {
      videos = cache.slice(0, Math.max(1, maxVideos));
    }
  } catch (err) {
    console.warn("[YouTube] Could not fetch recent videos:", String(err));
    return 0;
  }

  for (const video of videos) {
    try {
      const threads = await listCommentThreads(video.videoId, 20, ctx.ytCreds);
      await sleep(800);

      // Build a flat list of comments to consider: top-level comments AND all of
      // their replies (incl. users replying to the bot's own replies). Each entry
      // carries the TOP-LEVEL comment id of its thread â€” YouTube only supports one
      // level of nesting, so every reply is posted under the top-level comment.
      type FlatComment = {
        commentId:       string; // the comment we dedup on (top-level OR reply id)
        parentId:        string; // top-level comment id to reply under
        text:            string;
        author:          string;
        authorChannelId: string;
        publishedAt:     string;
        isReply:         boolean;
      };
      const flat: FlatComment[] = [];
      for (const t of threads) {
        if (!t.commentId) continue;
        flat.push({
          commentId:       t.commentId,
          parentId:        t.commentId,
          text:            t.text,
          author:          t.author,
          authorChannelId: t.authorChannelId,
          publishedAt:     t.publishedAt,
          isReply:         false,
        });
        // Fetch nested replies for this thread â€” but ONLY within the per-run budget
        // and only if this thread's replies weren't fetched recently (quota guard â€”
        // see _ytThreadReplyFetchAt). Skipping just means we still process the
        // top-level comment now and pick up its nested replies on a later run.
        if (replyFetchesThisRun >= YT_MAX_REPLY_FETCHES_PER_RUN) continue;
        const lastFetchedAt = _ytThreadReplyFetchAt.get(t.commentId) ?? 0;
        if (Date.now() - lastFetchedAt < YT_THREAD_REPLY_TTL_MS) continue;
        replyFetchesThisRun++;
        boundedMapSet(_ytThreadReplyFetchAt, t.commentId, Date.now(), YT_THREAD_REPLY_CACHE_CAP);
        const replies = await listCommentReplies(t.commentId, 50, ctx.ytCreds);
        await sleep(400);
        for (const r of replies) {
          if (!r.commentId) continue;
          flat.push({
            commentId:       r.commentId,
            parentId:        t.commentId,
            text:            r.text,
            author:          r.author,
            authorChannelId: r.authorChannelId,
            publishedAt:     r.publishedAt,
            isReply:         true,
          });
        }
      }

      // Cap replies sent per video to keep quota sane.
      let repliesThisVideo = 0;
      const MAX_REPLIES_PER_VIDEO = 20;

      for (const c of flat) {
        if (repliesThisVideo >= MAX_REPLIES_PER_VIDEO) break;
        const commentId = c.commentId;
        if (!commentId) continue;

        // NEVER reply to the channel's OWN comments/replies (prevents loops).
        if (isOwn(c.authorChannelId, c.author)) continue;
        if (repliedSet.has(commentId)) continue;

        // Atomic claim keyed by the YT comment id â€” same engine as IG. Ensures each
        // comment (top-level or reply) is answered exactly once across paths/restarts.
        const claimed = await claimCommentForReply(commentId, {
          mediaId:   video.videoId,
          username:  c.author ?? "unknown",
          text:      c.text   ?? "",
          timestamp: c.publishedAt ? new Date(c.publishedAt) : new Date(),
        });
        if (!claimed) {
          boundedAdd(repliedSet, commentId);
          continue;
        }

        // Normalize the author handle to EXACTLY one leading "@" (fixes the @@ bug).
        const handle = "@" + (c.author ?? "friend").replace(/^@+/, "");

        const reply = await generateAICommentReply(
          c.text ?? "",
          c.author ?? "friend",
          { postType: "YOUTUBE", postTitle: video.title },
          ctx.prefs.brand,
          ctx.brandId,
        );
        await sleep(800);
        if (!reply) {
          // No reply generated â€” release the claim so a later run can retry.
          await releaseCommentClaim(commentId);
          continue;
        }

        // For replies-to-replies, optionally prefix the user's handle, then post the
        // reply under the TOP-LEVEL comment id (YouTube supports one nesting level).
        const replyText = c.isReply ? `${handle} ${reply}` : reply;
        const sent = await replyToYouTubeComment(c.parentId, replyText, ctx.ytCreds);
        await sleep(800);
        if (sent) {
          replied++;
          repliesThisVideo++;
          boundedAdd(repliedSet, commentId);
          await markCommentReplied(commentId, replyText);
          await safeLog({
            action:   "YOUTUBE_COMMENT_REPLIED",
            entity:   "Comment",
            entityId: commentId,
            metadata: { commentId, videoId: video.videoId, title: video.title,
                        username: c.author, isReply: c.isReply, replyText },
          }).catch(() => {});
          notifyYouTubeCommentReplied({
            commentId, videoTitle: video.title, author: c.author ?? "viewer", replyText,
          });
          console.log(`[YouTube] Replied to ${handle} on "${video.title.slice(0, 40)}": "${reply.slice(0, 60)}"`);
        } else {
          // Send failed â€” release so a later run can retry.
          await releaseCommentClaim(commentId);
        }
      }
    } catch (err) {
      // One video failing must not abort the rest.
      console.warn(`[YouTube] Comment reply loop failed for video ${video.videoId}:`, String(err));
    }
  }

  if (replied > 0) console.log(`[YouTube] Sent ${replied} comment ${replied === 1 ? "reply" : "replies"}`);
  return replied;
}

// --- Rate-limit tracker -------------------------------------------------------
// Back-off window; set when an upstream API signals a rate limit. isRateLimited()
// gates the catch-up loop while the back-off is active.
let rateLimitedUntil: Date | null = null;

export function isRateLimited(): boolean {
  if (!rateLimitedUntil) return false;
  if (Date.now() > rateLimitedUntil.getTime()) { rateLimitedUntil = null; return false; }
  return true;
}

// --- 5. Background auto-generate (no browser session needed) ------------------
// Reads autoPost preferences and generates+schedules posts for today.
// Gated to run once per calendar day (IST). Called from the 9 AM daily trigger.

// Per-brand once-per-IST-day guards and in-flight locks, keyed by brandId, so one
// brand's daily generation can never suppress or race another brand's.
const _lastAutoGenerateDateByBrand   = new Map<string, string>();
const _lastYouTubeGenerateDateByBrand = new Map<string, string>();
const _autoGenInFlightByBrand   = new Map<string, boolean>();
const _ytAutoGenInFlightByBrand = new Map<string, boolean>();
// brandId → IST date we already sent a "no post generated" alert for (dedupe to 1/day).
const _genFailAlertedByBrand = new Map<string, string>();

// Per-type IMAGE-CARD spec â€” defines what the on-image text must contain for each
// post type. Without this, every type got the generic "6 facts" card (wrong for
// quizzes, myth/fact, case studies, etc.). Niche-agnostic: the wording is neutral
// so it applies to ANY brand, and the CTA resolves to the active brand's handle.
function cardSpecFor(brand: BrandConfig): Record<string, string> {
  return {
  EDUCATIONAL:
    "7 numbered points (1.â€“7.), each on its own line. Each point is a COMPLETE, self-contained factual statement: a SPECIFIC number/stat/detail/percentage, PLUS why it matters (what it means AND why it's significant) â€” write the FULL, detailed informative line with no length limit (the card auto-fits; do NOT abbreviate or truncate). No vague steps.",
  PRO_TIP:
    "ONE high-value key insight as a bold 1-2 line takeaway, then 5 numbered supporting points (1.â€“5.). Each supporting point is a COMPLETE, self-contained factual statement with a specific number/detail/criterion PLUS why it matters â€” write the FULL, detailed informative line with no length limit (the card auto-fits; do NOT abbreviate or truncate).",
  PREVENTIVE:
    "7 numbered points (1.â€“7.), each on its own line. Each is a COMPLETE, self-contained actionable statement with a real number, target value, or concrete detail PLUS brief context explaining the action AND its benefit â€” write the FULL, detailed informative line with no length limit (the card auto-fits; do NOT abbreviate or truncate).",
  QUIZ:
    "Format the card content EXACTLY with these labelled sections (each on its own line):\nSCENARIO: <the relevant setup/context>\nQUESTION: <the question>\nA) <option>\nB) <option>\nC) <option>\nD) <option>\nDo NOT reveal or mark the correct answer anywhere. No asterisks.",
  KNOWLEDGE_QUIZ:
    "Format the card content EXACTLY with these labelled sections (each on its own line):\nSCENARIO: <the relevant setup/context>\nKEY DETAILS:\n- <detail 1>\n- <detail 2>\n- <detail 3>\nQUESTION: <the question>\nA) <option>\nB) <option>\nC) <option>\nD) <option>\nDo NOT reveal or mark the correct answer anywhere. No asterisks.",
  IMAGE_QUIZ:
    "Format the card content EXACTLY with these labelled sections (each on its own line):\nSCENARIO: <the relevant setup/context>\nKEY DETAILS:\n- <detail 1>\n- <detail 2 if relevant>\nQUESTION: <the specific decision>\nA) <option>\nB) <option>\nC) <option>\nD) <option>\nDo NOT reveal or mark the correct answer anywhere. No asterisks.",
  MYTH_FACT:
    "Line 1: 'MYTH: <common misconception>'. Line 2: 'FACT: <the evidence-based truth>'. Then 4 numbered supporting facts (1.â€“4.), each a full, detailed informative line with real data AND why it matters â€” no length limit (the card auto-fits).",
  CASE_STUDY:
    "A real-world example or scenario (4-5 lines setting up the context and key details), then 3 lines giving the outcome, the key takeaway, and the take-home lesson. Concise lines, no prose.",
  CAROUSEL:
    "6 numbered key points (1.â€“6.) for a single summary card. Each is a COMPLETE, self-contained factual statement with a specific number/stat/detail PLUS why it matters â€” write the FULL, detailed informative line with no length limit (the card auto-fits; do NOT abbreviate or truncate).",
  CTA:
    `3-4 short punchy lines: why to follow ${atHandle(brand)} and what content they'll get. Warm but authoritative.`,
  };
}

// Quiz-family types keep their question + A/B/C/D options on the card.
const QUIZ_TYPES = ["QUIZ", "KNOWLEDGE_QUIZ", "IMAGE_QUIZ"];

// Is this line quiz/option/answer/CTA noise that must NOT appear on a
// non-quiz (educational/preventive/pearl/carousel) card or its caption?
function isQuizOrCtaLine(l: string): boolean {
  return (
    /^[A-D][).:]\s/.test(l) ||                                   // A)/B)/C)/D) options
    /^(quiz|question)\s*[:\-]/i.test(l) ||                       // "Quiz:"/"Question:"
    /answer\s+(in\s+(the\s+)?comments?|tomorrow|below|later)/i.test(l) || // answer-reveal
    /^[(\[]?\s*answer\b/i.test(l)                                // "(Answer â€¦)"
  );
}

/**
 * Ensure the image-card `content` is consistent with the `caption` and free of
 * quiz/CTA noise for NON-quiz post types.
 *   1. Strip any quiz/option/answer/CTA lines the AI leaked into an educational card.
 *   2. If that leaves too few real facts (the AI mislabeled a quiz as educational),
 *      rebuild the card facts from the caption's â‘ â‘¡â‘¢ key-point lines so the card
 *      MATCHES the caption instead of rendering empty.
 * Quiz-family types are returned unchanged (their cards need the Q + options).
 */
function deriveCardContent(type: string, content: string, caption: string): string {
  if (QUIZ_TYPES.includes(type)) return content;

  const clean = (s: string) =>
    s.split("\n").map((l) => l.trim()).filter(Boolean).filter((l) => !isQuizOrCtaLine(l));

  let lines = clean(content);

  if (lines.length < 2 && caption) {
    // Caption key points are emitted as "â‘  â€¦", "â‘¡ â€¦" etc. Pull those as the facts.
    const keyPts = caption
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => /^[â‘ -â‘¨]/.test(l)) // â‘ ..â‘¨
      .map((l) => l.replace(/^[â‘ -â‘¨]\s*/, "").replace(/\*\*/g, "").trim())
      .filter(Boolean);
    if (keyPts.length >= 2) lines = keyPts.slice(0, 7);
  }

  // Never return empty â€” fall back to the original (filtered) content.
  return (lines.length ? lines : clean(content)).join("\n");
}

interface GeneratedPostSummary { type: string; title: string; scheduledFor: Date }


// --- 4b. Independent YouTube auto-poster --------------------------------------
// Mirrors runAutoGeneratePosts() but driven entirely by prefs.youtube. Generates
// YouTube-platform Posts + ScheduledPosts (one per configured postTime) so the
// scheduler's youtube branch publishes them as Shorts. Runs once per IST day.
// â”€â”€ YouTube title de-dup (#2) + hook-quality gate (#3) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Generic/structural words that don't define a video's THEME â€” ignored when
// comparing two titles for topic overlap (so two videos on different subjects
// don't falsely collide on a shared generic word). Two titles "collide" when
// they still share a DISTINCTIVE keyword (the actual subject noun).
const YT_THEME_STOP = new Set([
  "the","a","an","and","or","to","of","for","that","this","with","into","from","at","by","as",
  "it","its","on","in","your","you","my","our","is","are","was","be","being","how","why","what",
  "which","when","who","does","do","can","will","could","should","would","may","might","most",
  "people","ignore","really","actually","silently","quietly","secretly","hidden","reveal","reveals",
  "reverse","hiding","saves","saving","save","truth","real","reason","difference","matters","need",
  "know","about","more","every","everyday","daily","things","ways","stop","keep","make","makes",
  // generic ACTION verbs / adjectives â€” describe what happens, not the SUBJECT, so they
  // must not trigger a false collision.
  "hurt","harm","harmful","protect","raise","raising","spike","spiking","cause","causing","predict",
  "predicting","lower","lowering","boost","boosting","improve","improving","increase","reduce","reducing",
  "prevent","preventing","affect","affecting","trigger","triggering","damage","damaging","kill","killing",
  "harden","hardening","age","aging","ageing","worse","better","good","bad","best","worst","common","simple",
  "easy","quick","fast","slow","new","old","big","small","warning","warn","hour","year","help","helps",
  "life","body","sign","signs","tip","tips","secret","secrets","mistake","mistakes","fact","facts",
]);
function ytThemeKeywords(title: string): Set<string> {
  return new Set(
    (title || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/[\s-]+/)
      .map((w) => w.replace(/(es|s|ing|ed)$/, "")) // light stemming so plurals match
      .filter((w) => w.length >= 3 && !YT_THEME_STOP.has(w)),
  );
}
/** Reject malformed / too-thin / vague-abstract titles that flop. */
function ytIsWeakTitle(title: string): boolean {
  const t = (title || "").trim();
  if (!t) return true;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length < 3) return true;                    // e.g. "Eye Strain"
  if (/_/.test(t)) return true;                         // raw filename leaked as title
  if (/^\d{1,2}\s+\w+\s+\d{4}$/.test(t)) return true;   // "23 June 2026" date fallback
  if (/^(auto|untitled|test)\b/i.test(t)) return true;
  // Vague abstractions with no concrete picture (these flopped)
  return [
    /^stop\s+\w+\s+from\s+/i,
    /^why\s+\w+\s+is\s+(killing|ruining|destroying)\s+your\b/i,
    /^how\s+\w+\s+causes?\s+silent\b/i,
  ].some((re) => re.test(t));
}

export async function runAutoGenerateYouTube(ctxArg?: BrandContext): Promise<GeneratedPostSummary[]> {
  const generated: GeneratedPostSummary[] = [];
  const ctx = ctxArg ?? await getPrimaryBrandContext();
  if (_ytAutoGenInFlightByBrand.get(ctx.brandId)) {
    console.log("[YT-AutoGen] Already running â€” skipping concurrent invocation");
    return [];
  }
  _ytAutoGenInFlightByBrand.set(ctx.brandId, true);
  try {
    const prefs = ctx.prefs;
    const yt    = prefs.youtube;

    // â”€â”€ Gates â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // The independent YouTube auto-poster ALWAYS runs per its own prefs.youtube
    // settings. It no longer conflicts with IG auto-posts because IG feed posts are
    // never cross-posted to YouTube (YouTube has no API for image/community posts).
    if (!yt?.enabled) {
      console.log("[YT-AutoGen] YouTube disabled in settings â€” skipping");
      return [];
    }
    if (!isYouTubeConfigured(ctx.ytCreds)) {
      console.log("[YT-AutoGen] YouTube not configured â€” skipping");
      return [];
    }
    if (!yt.topics?.length) {
      console.log("[YT-AutoGen] No YouTube topics configured â€” skipping");
      return [];
    }
    if (!yt.postTimes?.length) {
      console.log("[YT-AutoGen] No YouTube postTimes configured â€” skipping");
      return [];
    }

    // Only run once per calendar day (IST)
    const IST_TZ   = "Asia/Kolkata";
    const nowInIST = new Date().toLocaleString("en-US", { timeZone: IST_TZ });
    const todayIST = new Date(nowInIST).toDateString();
    if (_lastYouTubeGenerateDateByBrand.get(ctx.brandId) === todayIST) {
      console.log("[YT-AutoGen] Already ran today â€” skipping");
      return [];
    }

    // Check if today is a scheduled day (0=Sun..6=Sat, IST).
    // PER-DAY (Feature 1): a `dailySchedule` entry for today's weekday supersedes the
    // global postsPerDay/postTimes/scheduleDays (same semantics as the IG auto-poster).
    const todayDow = new Date(nowInIST).getDay();
    const hasDayEntry = Array.isArray(yt.dailySchedule)
      && yt.dailySchedule.some((e) => e && Number(e.day) === todayDow);
    const daySched = resolveDaySchedule(
      todayDow, yt.dailySchedule, Number(yt.postsPerDay) || 1, yt.postTimes ?? [],
      ctx.prefs.youtube?.customScheduleOnly ?? false,
    );
    if (daySched === null) {
      console.log(`[YT-AutoGen] Day ${todayDow} disabled in dailySchedule (or no custom entry under customScheduleOnly) â€” skipping`);
      _lastYouTubeGenerateDateByBrand.set(ctx.brandId, todayIST);
      return [];
    }
    if (!hasDayEntry && yt.scheduleDays?.length && !yt.scheduleDays.includes(todayDow)) {
      console.log(`[YT-AutoGen] Day ${todayDow} not in scheduleDays â€” skipping`);
      return [];
    }
    const effectiveTimes = daySched.times.length ? daySched.times : (yt.postTimes ?? []);

    // Parse today's IST calendar date for time calculations
    const nowUtc = new Date();
    const istParts = new Intl.DateTimeFormat("en-US", {
      timeZone: IST_TZ, year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(nowUtc);
    const pp: Record<string, number> = {};
    for (const p of istParts) if (p.type !== "literal") pp[p.type] = parseInt(p.value, 10);
    const istYear = pp["year"]!, istMonth = pp["month"]!, istDay = pp["day"]!;

    const todayStart = wallTimeToUTC(istYear, istMonth, istDay,  0,  0, IST_TZ);
    // Exclusive next-midnight boundary (matches tzDayInfo); lte:23:59 left a 60-second
    // hole (23:59:01â€“23:59:59) where posts weren't counted by the daily cap.
    const todayEnd   = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);

    // How many youtube-platform posts are already scheduled for today?
    const existingCount = await prisma.scheduledPost.count({
      where: {
        platform:     "youtube",
        status:       { in: ["PENDING", "PUBLISHED"] },
        scheduledFor: { gte: todayStart, lt: todayEnd },
        ...brandFilter(ctx),
      } as any,
    }).catch(() => 0);

    // Target number of YouTube posts per day comes from today's effective schedule â€”
    // the per-day override (daySched.postsPerDay) when present, else the global
    // yt.postsPerDay (1â€“5). Posts are distributed across effectiveTimes below.
    const targetPerDay = daySched.postsPerDay;

    const toGenerate = Math.max(0, targetPerDay - existingCount);
    if (toGenerate === 0) {
      console.log(`[YT-AutoGen] ${existingCount}/${targetPerDay} YouTube posts already scheduled today â€” skipping`);
      _lastYouTubeGenerateDateByBrand.set(ctx.brandId, todayIST);
      return [];
    }

    const userId = await getSystemUserId();
    if (!userId) {
      console.warn("[YT-AutoGen] No userId found in DB â€” cannot create auto posts");
      return [];
    }

    const ai = await getAIClient("content", ctx.brandId);
    const brand = ctx.prefs.brand;
    console.log(`[YT-AutoGen] Generating ${toGenerate} YouTube Short post(s) for today (${todayIST})`);

    // â”€â”€ AI preference defaults (#7) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const aiPrefs        = (ctx.prefs.ai ?? {}) as any;
    const defaultTone    = (aiPrefs.defaultTone ?? "").trim();
    const aiLanguage     = (aiPrefs.language ?? "").trim();
    const toneDirective  = defaultTone
      ? `\n\nTONE: write in a ${defaultTone} tone.`
      : "";
    const languageDirective = (aiLanguage && !/^english$/i.test(aiLanguage))
      ? `\n\nWrite the content in ${aiLanguage}.`
      : "";

    // Anti-repetition: avoid recently used titles
    const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const recentPosts = await prisma.post.findMany({
      where:   { createdAt: { gte: since30d }, ...brandFilter(ctx) },
      orderBy: { createdAt: "desc" },
      take:    40,
      select:  { title: true },
    }).catch(() => [] as { title: string }[]);
    const recentAvoidList = recentPosts.map((p) => p.title).filter(Boolean).slice(0, 40);
    // #2: precompute the distinctive theme keywords of every recent title once.
    const recentThemeKw = recentAvoidList.map(ytThemeKeywords);

    const usedThisRun = new Set<string>();
    // #2: theme-keyword signatures generated THIS run, so two posts in one run can't
    // cover the same subject even before they hit the DB recent-list.
    const usedThemeKw: Set<string>[] = [];

    // Rotate among the configured YouTube post types (Settings â†’ YouTube).
    // Falls back to the proven content-friendly default set when none configured.
    // When no YouTube post types are configured, fall back to the user's AI
    // defaultType (#7, normalised to enum form) seeded into the proven default set,
    // else the default set alone.
    const ytDefaultType = (((ctx.prefs.ai as any)?.defaultType ?? "").trim())
      ? ((ctx.prefs.ai as any).defaultType as string).toUpperCase().replace(/\s+/g, "_")
      : "";
    const YT_TYPES = (Array.isArray(yt.postTypes) && yt.postTypes.length)
      ? yt.postTypes
      : (ytDefaultType
          ? [ytDefaultType, "EDUCATIONAL", "PRO_TIP", "PREVENTIVE"]
          : ["EDUCATIONAL", "PRO_TIP", "PREVENTIVE"]);
    const dayNumber = Math.floor(Date.now() / 86_400_000);

    const customExtra = (yt.customPromptExtra ?? "").trim();

    // â”€â”€ Target-length plan (Short duration sizing) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Derive the narration/word budget for the user's chosen Short length so the
    // AI writes a script that actually fits the target seconds. `targetShortSeconds`
    // is undefined-tolerant â†’ shortPlan falls back to DEFAULT_SHORT_SECONDS.
    const plan = shortPlan(yt.targetShortSeconds ?? DEFAULT_SHORT_SECONDS);

    for (let i = 0; i < toGenerate; i++) {
      const type  = YT_TYPES[(dayNumber + i) % YT_TYPES.length];
      const topic = (await pickNextTopic("post", yt.topics, usedThisRun, ctx.prefs.brand))
        ?? yt.topics[i % yt.topics.length];
      usedThisRun.add(topic);

      const avoidBlock = recentAvoidList.length
        ? `\n\nANTI-REPETITION (critical for reach â€” platforms suppress repetitive uploads): do NOT cover the same SUBJECT/THEME as any recent post below, not just the same wording. If a theme already appears here, pick a genuinely DIFFERENT ${brand.niche} subject â€” do not make another post on that same theme with fresh words. Use a fresh subject, fresh angle, and fresh facts:\n${recentAvoidList.map((t) => `- ${t}`).join("\n")}`
        : "";

      const ytExtra = customExtra
        ? `\n\nADDITIONAL CREATOR INSTRUCTIONS for this YouTube Short (follow these closely while keeping the JSON structure above):\n${customExtra}`
        : "";

      // â”€â”€ Accessible-angle 80/20 content bias â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      // Channel insight: accessible, everyday-language content earns far more views
      // than dense, expert-level content. Most viewers are the general public, not
      // specialists. So bias ~80-90% of YouTube posts toward a plain-language,
      // accessible angle, leaving ~10-20% for in-depth expert credibility.
      // Deterministic split reuses the same per-post counter (dayNumber + i) that
      // drives type rotation: 1 in every 10 posts is in-depth, the rest accessible.
      const isExpertAngle = (dayNumber + i) % 10 === 0;
      const angleBlock = isExpertAngle
        ? `\n\nCONTENT ANGLE â€” IN-DEPTH (this is one of the ~10% expert-level posts): you MAY use precise terminology and educational depth here. Name specific facts/criteria/details and write at a level that respects experts while still being understandable. Do not dumb it down â€” this slot exists to showcase credibility. TITLE RULE: even here, the "title" must still be a plain-language CURIOSITY hook a layperson would click (you may add the technical term AFTER a plain hook).`
        : `\n\nCONTENT ANGLE â€” ACCESSIBLE (this is one of the ~90% accessible posts, framed for the general public, NOT specialists): frame the topic in plain, relatable, everyday language. Focus entirely on what it means for the VIEWER's daily life â€” practical, actionable advice they can use today. Lead with the personal "what does this mean for me" angle. AVOID heavy jargon and insider terminology; if a technical term is unavoidable, explain it in one plain phrase. Keep it warm, accessible, and motivating for an everyday viewer.\nTITLE RULE: the "title" MUST be a plain-language CURIOSITY hook the average person would click â€” NEVER jargon. Follow the WINNING PATTERN: a concrete everyday noun + a specific curiosity or benefit (a number ONLY if it is truthful â€” NEVER invent a statistic). GOOD: a concrete object/moment the viewer recognises plus a specific payoff or surprise. BANNED (abstract, vague, no concrete picture): anything shaped like "How X causes silent Y", "Stop X from ruining your Z", "Why X is killing your Y", or generic "...your <thing>" with no specific noun or number. Make the viewer NEED to know the answer.`;

      const cardSpec = cardSpecFor(brand)[type] ?? cardSpecFor(brand).EDUCATIONAL;

      // â”€â”€ DURATION directive (sizes the NARRATED card content to the target) â”€â”€
      // The card `content` field is what gets read aloud in the Short, so its
      // length drives the runtime. Size it to `plan` so the finished Short lands
      // near the user's chosen target seconds. This OVERRIDES any "~5-7 points"
      // count baked into the IMAGE-CARD REQUIREMENT above. Soft target â€” a rich
      // point may run slightly long, but do not pad.
      const durationBlock =
        `\n\nDURATION â€” SIZE THE NARRATED CONTENT TO â‰ˆ${plan.target} SECONDS (critical):
This Short must run about ${plan.target} seconds when the "content" card text is read aloud.
- Write EXACTLY ${plan.points} content point(s) in the "content" field â€” no more, no fewer. This point count OVERRIDES any "~5-7 points" (or similar) count mentioned in the IMAGE-CARD REQUIREMENT above.
- Each point is ONE COMPLETE, beautifully-written sentence of about ${Math.max(9, plan.wordsPerPoint - 4)}â€“${plan.wordsPerPoint} words â€” smooth, vivid and high-impact, that flows when read aloud (NOT a terse fragment or a bare "42% of people…" stat). Weave the specific number/stat naturally INTO a real sentence with a subject and verb, and make it genuinely pleasant to read.
- The WHOLE narration (hook + the ${plan.points} points + CTA) should total â‰ˆ ${plan.totalWords} words.
- Fewer points is fine for a shorter target, but every point must be a full, polished sentence â€” concrete, elegant, and worth saying. This is a SOFT target: a genuinely rich point may run slightly over; do NOT pad with filler, but DO write in complete sentences rather than clipped fragments.
- This duration budget applies ONLY to the narrated card "content". The "caption" field can stay rich, long, and detailed as specified below â€” do NOT shorten the caption to fit the duration.`;

      try {
        const typeLabel = type.replace(/_/g, " ").toLowerCase();
        const basePrompt = `Generate a ${typeLabel} ${brand.niche} YouTube Short post about: "${topic}".

You are ${atHandle(brand)} â€” ${brand.persona.role}. This is for a YouTube channel. Create high-impact ${brand.niche} content that gets watched, saved, and shared.

AUDIENCE: ${brand.audience}.
- Be accurate, specific, and genuinely useful â€” back claims with real numbers, facts, or examples.
- Frame the topic around what your audience actually cares about and can act on.
- Stay credible and evidence-based at all times.

HOOK â€” the hook must stop the scroll in the first 1-2 seconds, speak to a real curiosity or concern your audience has, yet stay credible.

IMAGE-CARD REQUIREMENT for this ${typeLabel} (this is what goes in the "content" field â€” the text rendered ON the image):
${cardSpec}

Return ONLY a valid JSON object with EXACTLY these fields:
{
  "title": "SEO title under 60 chars, searchable YouTube phrasing. Obey the TITLE RULE below: concrete everyday noun + specific curiosity/benefit (a number only if truthful); NEVER abstract/jargon or the banned vague patterns.",
  "hook": "Card headline â€” bold 6-9 words, no asterisks, no punctuation at end.",
  "content": "The IMAGE-CARD text. Follow the IMAGE-CARD REQUIREMENT above EXACTLY. Each item on its OWN LINE separated by \\n. Plain lines only â€” NO prose paragraphs, NO markdown, NO asterisks.",
  "caption": "Caption (prose, DIFFERENT from and RICHER than the card). Make it detailed and substantial: a strong scroll-stopping hook, then 2-4 sentences of context with specifics, then 5 key points each starting with â‘  â‘¡ â‘¢ â‘£ â‘¤ and each EXPANDED to a full, complete sentence with a real number/stat/detail AND its significance (NOT a fragment), then a 'Why it matters:' line (one full sentence), then a short QUESTION that invites the viewer to comment their experience/opinion, then a SUBSCRIBE call-to-action (this is a YouTube Short â€” drive subscribes): 'Subscribe to ${atHandle(brand)} for more.'",
  "cta": "Short call to action fitting the post type",
  "hashtags": ["exactly 3 topic-specific hashtags, lowercase, no # prefix"]
}

RULES:
- "content" = ONLY the image-card text, following the IMAGE-CARD REQUIREMENT above. Plain lines, no prose.
- "caption" = ONLY prose with emojis. Must be DIFFERENT from the card content.
- hashtags: EXACTLY 3. Mix 1 high-volume (>500k) + 1 medium (50k-500k) + 1 niche (<50k).${durationBlock}${toneDirective}${angleBlock}${ytExtra}${avoidBlock}${languageDirective}`;

        const ytSystem =
          buildBrandSystemPrompt(brand) + " This is for a YouTube channel â€” optimize hooks to grab a broad audience. Return ONLY valid JSON â€” no markdown, no preamble. Every post you write must be distinct from previous ones â€” never repeat the same facts, angle, or wording." + languageDirective;

        // â”€â”€ #2 de-dup + #3 hook-quality gate â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        // Generate, then HARD-validate the title: reject if it's weak/malformed (#3)
        // or repeats the SUBJECT of a recent / same-run post (#2), and regenerate
        // with targeted feedback (up to 3 tries). The recentAvoidList prompt hint is
        // soft (models ignore it) â€” this is the enforcement.
        // generateJSONResilient walks the selected provider's JSON chain THEN falls back
        // to the OTHER provider when every model is empty/quota-exhausted.
        const collidesAny = (ttl: string): boolean => {
          const k = ytThemeKeywords(ttl);
          for (const rk of recentThemeKw) for (const w of k) if (rk.has(w)) return true;
          for (const rk of usedThemeKw)   for (const w of k) if (rk.has(w)) return true;
          return false;
        };
        let parsed: any = null;
        let banFeedback = "";
        for (let attempt = 1; attempt <= 3; attempt++) {
          const raw = await generateJSONResilient(basePrompt + banFeedback, ytSystem, 2500, ctx.brandId);
          let p: any;
          try {
            const cleaned = raw.replace(/```json\n?/gi, "").replace(/```\n?/gi, "").trim();
            p = JSON.parse(cleaned.match(/\{[\s\S]*\}/)?.[0] ?? cleaned);
          } catch {
            console.warn(`[YT-AutoGen] attempt ${attempt}: JSON parse failed for ${type}`);
            continue;
          }
          parsed = p; // keep the latest parse as a best-effort fallback
          const ttl  = String(p.title || "").trim();
          const weak = ytIsWeakTitle(ttl);
          const dup  = collidesAny(ttl);
          if (!weak && !dup) break; // accepted
          console.warn(`[YT-AutoGen] attempt ${attempt} rejected (weak=${weak} dup=${dup}): "${ttl}"`);
          const reasons: string[] = [];
          if (weak) reasons.push(`the title "${ttl}" is malformed, too short, or a vague/abstract pattern that flops â€” write a CONCRETE curiosity hook built on a specific everyday noun (use a number only if it is truthful)`);
          if (dup)  reasons.push(`the SUBJECT of "${ttl}" repeats a recent video â€” choose a COMPLETELY different ${brand.niche} subject that shares NO keywords with the recent list above`);
          banFeedback = `\n\nREGENERATE â€” the previous attempt was rejected because ${reasons.join("; and ")}. Return fresh JSON (all fields) with a distinct, strong, concrete title and matching content.`;
        }
        if (!parsed) {
          console.warn(`[YT-AutoGen] No parseable AI output for ${type} after retries â€” skipping this post`);
          continue;
        }
        // Record this post's theme so later posts in the same run avoid it (#2).
        usedThemeKw.push(ytThemeKeywords(String(parsed.title || "")));

        if (!parsed.caption && parsed.content) parsed.caption = parsed.content;
        parsed.content = deriveCardContent(type, parsed.content || "", parsed.caption || "");

        // Simple AI hashtags â€” no IG-live enrichment needed for YouTube.
        const hashtags = ((parsed.hashtags ?? []) as string[])
          .map((h: string) => h.startsWith("#") ? h.toLowerCase() : `#${h.toLowerCase()}`)
          .slice(0, 5);

        const post = await prisma.post.create({
          data: {
            userId,
            type:        type as any,
            title:       parsed.title   || `Auto: ${topic}`,
            content:     parsed.content || "",
            hook:        parsed.hook    || "",
            cta:         parsed.cta     || "Save this post!",
            reelScript:  parsed.caption ? `CAPTION:${parsed.caption}` : undefined,
            hashtags,
            imagePrompt: "",
            viralScore:  Math.round((0.75 + Math.random() * 0.15) * 100) / 100,
            status:      "DRAFT",
            platform:    "youtube",
            brandId:     brandIdForWrite(ctx),
          } as any,
        });

        // â”€â”€ Atomic claim (#9) + slot index: count posts already scheduled today
        // (PENDING/PUBLISHED) BEFORE assigning this post's slot. This both stops
        // double-generation (break when the cap is met) AND yields the post's TRUE
        // day-position, so an interrupted+resumed run (e.g. a deploy split one
        // generation into two) continues from the next free slot instead of
        // restarting the in-run counter `i` at 0 â€” which previously made both
        // Shorts of a split run reuse slot 0 (the same time).
        const liveCount = await prisma.scheduledPost.count({
          where: {
            platform:     "youtube",
            status:       { in: ["PENDING", "PUBLISHED"] },
            scheduledFor: { gte: todayStart, lt: todayEnd },
            ...brandFilter(ctx),
          } as any,
        }).catch(() => existingCount + i);
        if (liveCount >= targetPerDay) {
          console.log(`[YT-AutoGen] Daily cap reached mid-run (${liveCount}/${targetPerDay}) â€” another generator beat us; stopping`);
          break;
        }

        // Distribute the N posts across the configured postTimes by ABSOLUTE day
        // position (liveCount), NOT the in-run loop counter `i`:
        //   â€¢ fewer times than posts â†’ cycle through them (reuse), staggering
        //     each reuse by +N hours so duplicates don't collide on one minute;
        //   â€¢ more times than posts â†’ the first N times are used naturally.
        const slotIdx   = liveCount; // 0-based position among today's already-scheduled posts
        const slotTimes = effectiveTimes.length ? effectiveTimes : (yt.postTimes ?? ["19:00"]);
        const timeStr  = slotTimes[slotIdx % slotTimes.length] ?? "19:00";
        const [hh, mm] = timeStr.split(":").map(Number);
        // How many full cycles past the first pass this slot is on â†’ hour offset.
        const reuseCycle = Math.floor(slotIdx / slotTimes.length);
        const hhStaggered = ((hh || 0) + reuseCycle) % 24;

        let scheduledFor = wallTimeToUTC(istYear, istMonth, istDay, hhStaggered, mm, IST_TZ);
        // If the slot already passed today, publish promptly TODAY instead of pushing
        // to tomorrow â€” pushing dated the Short tomorrow, escaping today's generation
        // cap (counted by scheduledFor-today) â†’ over-generation + multiple Shorts all
        // landing on the same pushed slot (the "4 at 9:30 PM" pile-up). Keeping it on
        // today makes the cap count it and prevents the collision.
        if (scheduledFor.getTime() <= Date.now()) {
          scheduledFor = new Date();
        }

        await prisma.scheduledPost.create({
          data: {
            userId,
            postId:      post.id,
            title:       post.title,
            content:     post.content,
            hashtags,
            scheduledFor,
            timezone:    IST_TZ,
            isRecurring: false,
            status:      "PENDING",
            platform:    "youtube",
            brandId:     brandIdForWrite(ctx),
          } as any,
        });

        await prisma.post.update({
          where: { id: post.id },
          data:  { status: "SCHEDULED", scheduledFor },
        });

        generated.push({ type, title: post.title, scheduledFor });
        console.log(`[YT-AutoGen] Created: "${post.title}" (${type}) â†’ ${scheduledFor.toISOString()}`);
      } catch (err: any) {
        console.error(`[YT-AutoGen] Failed to generate ${type} post:`, err?.message);
      }
    }

    // Partial-failure (#6): only seal the in-memory "done today" marker when the
    // FULL target was generated; otherwise leave it so the next cycle retries the
    // remainder (the DB existingCount prevents over-generation).
    if (generated.length >= toGenerate) {
      _lastYouTubeGenerateDateByBrand.set(ctx.brandId, todayIST);
    } else {
      console.log(`[YT-AutoGen] Only ${generated.length}/${toGenerate} generated â€” NOT sealing today; next cycle will retry the remainder`);
      // Nothing generated at all (every AI provider failed, e.g. all rate-limited) →
      // this is otherwise SILENT (no ScheduledPost = no publish-failure email). Alert
      // ONCE per IST day so the user knows no post was made.
      if (generated.length === 0 && toGenerate > 0 && _genFailAlertedByBrand.get(ctx.brandId) !== todayIST) {
        _genFailAlertedByBrand.set(ctx.brandId, todayIST);
        void notifyGenerationFailed({
          kind:   "YouTube Short",
          detail: "AI content generation failed for every provider in the chain (most likely a rate limit / daily token cap). No post was created; the scheduler will keep retrying.",
          dayKey: todayIST,
        }).catch(() => {});
      }
    }
    await safeLog({
      action:   "YOUTUBE_AUTOGEN",
      entity:   "YouTube",
      entityId: todayIST,
      metadata: { generated: generated.length },
    }).catch(() => {});
    console.log(`[YT-AutoGen] Done â€” generated ${generated.length} YouTube post(s) today`);
  } catch (err: any) {
    console.warn("[YT-AutoGen] Unexpected error:", String(err));
  } finally {
    _ytAutoGenInFlightByBrand.set(ctx.brandId, false);
  }
  return generated;
}


// --- 6. Daily health report + auto-generate (fires once at ~9 AM IST) ---------
// Returns true if the daily report was sent (so caller can avoid duplicate sends).

let _lastHealthReportDate: string | null = null;

export async function runDailyHealthCheck(): Promise<boolean> {
  const IST_TZ   = "Asia/Kolkata";
  const nowInIST = new Date().toLocaleString("en-US", { timeZone: IST_TZ });
  const todayIST = new Date(nowInIST).toDateString();

  // Only send once per calendar day
  if (_lastHealthReportDate === todayIST) return false;

  // Check current IST hour: send between 09:00 and 09:59 IST
  const istHour = new Date(nowInIST).getHours();
  if (istHour < 9 || istHour >= 10) return false;

  _lastHealthReportDate = todayIST;
  console.log("[DailyHealth] Sending 9 AM health reportâ€¦");

  try {
    // â”€â”€ 1. Auto-generate today's YouTube Shorts â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const generatedPosts = await runAutoGenerateYouTube();

    // â”€â”€ 2. Collect health status â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const dbOk = await prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false);

    const prefs      = await readPreferences().catch(() => null);
    const aiProvider = (prefs?.ai as any)?.aiProvider ?? "grok";
    let aiOk = false;
    let aiError = "";
    try {
      if (aiProvider === "gemini") {
        const key = process.env.GEMINI_API_KEY?.trim() || ((prefs?.ai as any)?.geminiApiKey?.trim() ?? "");
        if (key) {
          const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`, { signal: AbortSignal.timeout(8000) });
          aiOk = r.ok;
          if (!r.ok) {
            const body = await r.json().catch(() => ({}));
            aiError = body?.error?.message ?? `HTTP ${r.status}`;
          }
        } else {
          aiError = "GEMINI_API_KEY not configured";
        }
      } else {
        const key = process.env.GROK_API_KEY;
        if (key) {
          const baseUrl = process.env.GROK_API_URL || "https://api.groq.com/openai/v1";
          const r = await fetch(`${baseUrl}/models`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8000) });
          aiOk = r.ok;
          if (!r.ok) aiError = `HTTP ${r.status}`;
        } else {
          aiError = "GROK_API_KEY not configured";
        }
      }
    } catch (e: any) {
      aiOk = false;
      aiError = e?.message ?? "Unknown error";
    }

    // Grok health â€” always used for comment replies, independent of content provider
    const grokHealth = await checkGrokHealth();

    // â”€â”€ 3. Real-time health alerts if something is down â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (!dbOk) {
      notifyApiHealthDegraded({ service: "PostgreSQL Database", detail: "Cannot reach database â€” DB queries are failing" }).catch(() => {});
    }
    if (!aiOk) {
      notifyApiHealthDegraded({ service: `${aiProvider === "gemini" ? "Gemini" : "Grok"} AI API`, detail: aiError || "AI API not responding", action: "Check API key and quota in Railway environment variables." }).catch(() => {});
    }
    if (!grokHealth.ok) {
      notifyApiHealthDegraded({ service: "Grok AI API (comment replies)", detail: grokHealth.detail || "Grok API not responding", action: "Check GROK_API_KEY and quota in your environment variables." }).catch(() => {});
    }

    // â”€â”€ 4. Collect 24-hour activity stats from DB â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const publishedCount24h = await prisma.scheduledPost.count({
      where: { status: "PUBLISHED", publishedAt: { gte: since24h } },
    }).catch(() => 0);

    const failedRaw24h = await prisma.scheduledPost.findMany({
      where: {
        status: "FAILED",
        createdAt: { gte: since24h },
        error: { not: null },
      },
      select: { title: true, error: true, createdAt: true, postType: true },
      orderBy: { createdAt: "desc" },
      take: 20,
    }).catch(() => []);

    const failedPosts24h = failedRaw24h
      .filter((p) => p.error && !p.error.startsWith("__CLAIMING__"))
      .map((p) => ({
        title:    p.title,
        error:    p.error!,
        failedAt: p.createdAt,
        postType: p.postType ?? undefined,
      }));

    // 24h comment + DM stats from ActivityLog
    const commentsReplied24h = await prisma.activityLog.count({
      where: { action: "COMMENT_REPLIED", createdAt: { gte: since24h } },
    }).catch(() => 0);

    // â”€â”€ 5. Collect upcoming scheduled posts â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const upcomingPosts = await prisma.scheduledPost.findMany({
      where:   { status: "PENDING", scheduledFor: { gte: new Date() } },
      orderBy: { scheduledFor: "asc" },
      take:    8,
      select:  { title: true, scheduledFor: true, status: true, postType: true },
    }).catch(() => []);

    // â”€â”€ 6. Pull in-memory event logs accumulated since last restart â”€â”€â”€â”€â”€â”€â”€
    const rateLimitEvents = getRecentRateLimitEvents();
    const systemErrors    = getRecentSystemErrors();
    const healthChanges   = getRecentHealthChanges();

    // â”€â”€ 6d. Today's YouTube posts â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Shorts published today (IST) â€” query published ScheduledPosts that carry a
    // youtubeVideoId, mirroring the story/auto-generated sections.
    const ytTodayStart = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const youtubePostsRaw = await prisma.scheduledPost.findMany({
      where:   { youtubeVideoId: { not: null }, status: "PUBLISHED", publishedAt: { gte: ytTodayStart } },
      orderBy: { publishedAt: "desc" },
      take:    15,
      select:  { title: true, youtubeVideoId: true, publishedAt: true },
    }).catch(() => [] as { title: string; youtubeVideoId: string | null; publishedAt: Date | null }[]);
    const youtubePosts24h = youtubePostsRaw
      .filter((p) => p.youtubeVideoId)
      .map((p) => ({
        title:       p.title,
        videoId:     p.youtubeVideoId!,
        url:         `https://youtube.com/shorts/${p.youtubeVideoId}`,
        publishedAt: p.publishedAt ?? null,
      }));

    // â”€â”€ 7. (Daily health-report email removed â€” a651ff9) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // The Morning Digest is now the single once-a-day summary email. The health
    // checks above still run so a real-time "service down" alert fires if something
    // actually breaks; we just no longer send a second, duplicate summary email.
    void publishedCount24h; void failedPosts24h; void commentsReplied24h;
    void upcomingPosts; void rateLimitEvents; void systemErrors; void healthChanges;
    void youtubePosts24h; void generatedPosts;
    console.log(`[DailyJob] Done â€” db:${dbOk ? "ok" : "DOWN"} ai:${aiOk ? "ok" : "DOWN"} grok:${grokHealth.ok ? "ok" : "DOWN"}. Morning summary delivered by the Morning Digest.`);
    return true;
  } catch (err: any) {
    console.error("[DailyHealth] Failed:", err?.message);
    return false;
  }
}

// --- Main export --------------------------------------------------------------
let lastRanAt: Date | null = null;
// Re-entrancy guard: a run that takes longer than MIN_INTERVAL_MS could overlap
// the next timer tick and double-publish. Only one runCatchup may be in flight at
// a time; a second concurrent call returns immediately.
let _catchupInFlight = false;
// Full loop (publishing + DMs) always runs every 5 min so DMs are never delayed.
// Comments have their own gate â€” see COMMENT_POLL_*_MS below.
// Exported so instrumentation.ts can drive its catch-up setInterval at the SAME
// cadence â€” otherwise the timer fires far more often than this debounce allows and
// most ticks are wasted no-ops.
export const MIN_INTERVAL_MS = 300_000; // always 5 min â€” keeps DM polling responsive

// Comment-specific rate gate for runCatchup. We throttle the API poll to hourly ONLY
// when the webhook is GENUINELY delivering (a real comment event arrived in the last
// 10 min, per isWebhookActive()); otherwise we poll every 5 min so comments are never
// missed. Gating on real events â€” NOT merely "is WEBHOOK_VERIFY_TOKEN set" â€” means a
// configured-but-silent webhook can no longer mask an outage by suppressing the poll.
// Per-brand so one brand's comment poll can't suppress another's.
const _lastCatchupCommentAtByBrand = new Map<string, number>();
const COMMENT_POLL_WEBHOOK_MS  = 60 * 60 * 1000; // webhook live  â†’ hourly fallback poll
const COMMENT_POLL_FALLBACK_MS = 300_000;        // webhook silent â†’ poll every 5 min

export async function runCatchup(): Promise<CatchupResult> {
  // Re-entrancy guard — if a previous run is still going, skip this tick entirely.
  if (_catchupInFlight) {
    console.log("[Catchup] Skipped -- a previous run is still in flight (re-entrancy guard)");
    return {
      scheduledPublished: 0,
      scheduledFailed:    0,
      newComments:        0,
      commentsReplied:    0,
      dmsReplied:         0,
      errors:             [],
      ranAt:              (lastRanAt ?? new Date()).toISOString(),
    };
  }
  _catchupInFlight = true;
  try {
    return await _runCatchupInner();
  } finally {
    _catchupInFlight = false;
  }
}

async function _runCatchupInner(): Promise<CatchupResult> {
  const now = new Date();

  // If an upstream API rate-limited us, skip entirely until the backoff expires
  if (isRateLimited()) {
    const remaining = Math.ceil((rateLimitedUntil!.getTime() - Date.now()) / 60_000);
    console.log(`[Catchup] Skipped -- rate limit active, ${remaining} min remaining`);
    return {
      scheduledPublished: 0,
      scheduledFailed:    0,
      newComments:        0,
      commentsReplied:    0,
      dmsReplied:         0,
      errors:             [`API rate limited -- resuming in ~${remaining} min`],
      ranAt:              now.toISOString(),
    };
  }

  // Debounce -- avoid running too frequently
  if (lastRanAt && now.getTime() - lastRanAt.getTime() < MIN_INTERVAL_MS) {
    const waited = Math.round((now.getTime() - lastRanAt.getTime()) / 1000);
    console.log(`[Catchup] Skipped -- ran ${waited}s ago (min interval: ${MIN_INTERVAL_MS / 1000}s)`);
    return {
      scheduledPublished: 0,
      scheduledFailed:    0,
      newComments:        0,
      commentsReplied:    0,
      dmsReplied:         0,
      errors:             [],
      ranAt:              lastRanAt.toISOString(),
    };
  }
  lastRanAt = now;

  // YouTube-only build. Each brand's YouTube work below self-gates on its own YT
  // credentials (ctx.hasYouTube), so the loop simply does nothing for brands
  // without a configured channel.
  const errors: string[] = [];

  // â”€â”€ Resolve all active brands and run the pipeline INDEPENDENTLY for each â”€â”€â”€â”€â”€â”€
  // listBrands() returns primary first; with only the primary brand present this is a
  // single iteration whose creds resolve from ENV â†’ behaviour identical to today.
  let brands: BrandRecord[] = [];
  let primaryId = "";
  try {
    [brands, primaryId] = await Promise.all([listBrands(), getPrimaryBrandId()]);
  } catch (e: any) {
    console.warn("[Catchup] Could not list brands â€” falling back to primary only:", e?.message ?? String(e));
    primaryId = await getPrimaryBrandId().catch(() => "");
    brands = [];
  }
  // Safety net: never run zero brands when the primary is configured.
  if (brands.length === 0 && primaryId) {
    brands = [{ id: primaryId, label: "Primary", isPrimary: true, active: true,
                ytChannelTitle: "", hasYouTube: isYouTubeConfigured() }];
  }

  // Aggregate counters across all brands.
  let published = 0, failed = 0, newComments = 0, repliedCount = 0, dms = 0, youtubeCommentsReplied = 0;

  for (const brand of brands) {
    if (!brand.active) continue;
    let ctx: BrandContext;
    try {
      ctx = await buildBrandContext(brand, primaryId);
    } catch (e: any) {
      console.warn(`[Catchup] Could not build context for brand ${brand.id} (${brand.label}):`, e?.message ?? String(e));
      errors.push(`Brand ${brand.label}: context build failed`);
      continue;
    }

    console.log(`[Catchup] Brand "${brand.label}" (${ctx.isPrimary ? "primary" : ctx.brandId})` +
      ` -- yt:${ctx.hasYouTube ? "on" : "â€”"}`);

    // 1. Auto-generate today's YouTube Shorts for this brand. Self-gates per brand
    //    (date guard + DB de-dupe + in-flight guard), so calling every cycle never
    //    double-generates. Fire-and-forget.
    void runAutoGenerateYouTube(ctx).catch((e: any) =>
      console.warn("[YT-AutoGen] background run failed:", e?.message ?? String(e)));

    // 2. Publish overdue scheduled YouTube posts. The YouTube branch self-gates on
    //    YT creds; brands without a configured channel publish nothing.
    try {
      const pr = await publishOverdueScheduled(ctx, errors);
      published += pr.published;
      failed    += pr.failed;
    } catch (e: any) {
      console.warn(`[Catchup] publishOverdueScheduled failed for ${brand.label}:`, e?.message ?? String(e));
      errors.push(`Brand ${brand.label}: publish failed`);
    }

    // 3. Grok auto-reply to comments on this brand's YouTube videos. YT-only.
    if (ctx.hasYouTube) {
      try {
        const ytReplies = await replyToYouTubeComments(ctx);
        youtubeCommentsReplied += ytReplies;
        if (ytReplies > 0) {
          await safeLog({
            action:   "YOUTUBE_COMMENTS_REPLIED",
            entity:   "YouTube",
            entityId: "comments",
            metadata: { count: ytReplies, brandId: ctx.brandId },
          });
        }
      } catch (err) {
        console.warn("[YouTube] replyToYouTubeComments failed:", String(err));
      }
    }
  }

  const result: CatchupResult = {
    scheduledPublished: published,
    scheduledFailed:    failed,
    newComments,
    commentsReplied:    repliedCount, // actual replies sent (new + retried unreplied comments)
    dmsReplied:         dms,
    youtubeCommentsReplied,
    errors,
    ranAt:              now.toISOString(),
  };

  console.log("[Catchup] Done:", result);
  return result;
}
