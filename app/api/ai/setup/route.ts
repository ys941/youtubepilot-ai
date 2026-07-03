/**
 * POST /api/ai/setup — AI channel setup wizard (Settings → AI Setup).
 *
 * Groq-preferred (uses the "content" AI lane) three-stage flow:
 *   stage:"questions" → the AI reads the user's channel description and returns
 *                       ~6-10 tailored questions to fill the whole config.
 *   stage:"generate"  → given description + answers, the AI returns a CONSTRAINED
 *                       config which this route validates/coerces onto the REAL
 *                       preferences + brand shape and returns as a PREVIEW (no write).
 *   stage:"apply"     → writes the reviewed config via writePreferencesForBrand.
 *
 * YouTube-only edition: there is a channel (@handle + channel name), NO Instagram
 * fields, handles, or schedule anywhere.
 *
 * Session-gated (same pattern as /api/ai/generate) and brand-aware
 * (?brand=<id> query or body.brand → resolveBrandId; empty → primary).
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession, authOptions } from "@/lib/auth";
import { generateJSONResilient } from "@/lib/ai-factory";
import { readPreferencesForBrand, writePreferencesForBrand } from "@/lib/preferences";
import { brandFromQuery, brandFromBody, isAllBrands } from "@/lib/brandRequest";
import {
  DEFAULT_CONTENT_TYPES,
  type ContentTypeId,
  type BrandConfig,
} from "@/lib/brandConfig";
import { normalizeShortSeconds } from "@/lib/shortLength";

export const dynamic = "force-dynamic";

// ─── Content-type enum (the REAL brand slots) ────────────────────────────────
const CONTENT_TYPE_IDS = Object.keys(DEFAULT_CONTENT_TYPES) as ContentTypeId[];
const CONTENT_TYPE_SET = new Set<string>(CONTENT_TYPE_IDS);

/**
 * Which slots the YouTube auto-poster may publish. STORY is a separate lane and
 * REEL maps 1:1 to a Short, so the poster's postTypes set excludes STORY (mirrors
 * the /api/settings/youtube KNOWN_POST_TYPES list).
 */
const YT_POST_TYPES = CONTENT_TYPE_IDS.filter((id) => id !== "STORY");
const YT_POST_TYPE_SET = new Set<string>(YT_POST_TYPES);
const DEFAULT_YT_POST_TYPES = ["EDUCATIONAL", "CLINICAL_PEARL", "PREVENTIVE"];

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// ─── Helpers to coerce/clamp AI output ───────────────────────────────────────
function str(v: unknown, max: number, fallback = ""): string {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : fallback;
}
function handle(v: unknown, max = 60): string {
  return str(v, max).replace(/^@+/, "").trim();
}
function clampInt(v: unknown, lo: number, hi: number, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : fallback;
}
function strArray(v: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(v)) return [];
  return Array.from(
    new Set(
      v
        .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
        .map((x) => x.trim().slice(0, maxLen)),
    ),
  ).slice(0, maxItems);
}

/** Parse the first {...}/[...] block from a raw AI JSON string. */
function parseJSON(raw: string): any {
  if (!raw) return null;
  const cleaned = raw.replace(/```json\n?/gi, "").replace(/```\n?/gi, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/) ?? cleaned.match(/\[[\s\S]*\]/);
  try {
    return JSON.parse(match ? match[0] : cleaned);
  } catch {
    return null;
  }
}

// ─── Question set (fallback + shape) ─────────────────────────────────────────
type SetupQuestion = {
  id: string;
  label: string;
  hint: string;
  type: "text" | "select" | "chips";
  options?: string[];
};

function fallbackQuestions(): SetupQuestion[] {
  return [
    { id: "channelFocus", label: "What exactly is your channel about?", hint: "The specific angle within your niche.", type: "text" },
    { id: "audience", label: "Who is your audience?", hint: "Who are you making Shorts for?", type: "text" },
    { id: "personaVoice", label: "What voice/tone should the channel have?", hint: "e.g. warm and playful, punchy and bold, calm and expert.", type: "chips", options: ["Friendly", "Bold", "Playful", "Expert", "Calm", "Energetic"] },
    { id: "tone", label: "Default writing tone", hint: "Pick the closest default tone.", type: "select", options: ["Friendly", "Professional", "Engaging", "Casual", "Bold", "Educational"] },
    { id: "language", label: "Content language", hint: "The language your Shorts are written in.", type: "select", options: ["English", "Hindi", "Spanish", "French", "German", "Arabic"] },
    { id: "ytHandle", label: "YouTube @handle", hint: "Without the @, e.g. yourchannel.", type: "text" },
    { id: "ytChannelName", label: "YouTube channel name", hint: "The public display name of your channel.", type: "text" },
    { id: "postsPerDay", label: "How many Shorts per day?", hint: "1 to 5.", type: "select", options: ["1", "2", "3", "4", "5"] },
    { id: "publishingDays", label: "Which days do you want to publish?", hint: "Choose the days.", type: "chips", options: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] },
    { id: "topicSeeds", label: "A few topic ideas to start with", hint: "Comma-separated seed topics (the AI expands these).", type: "text" },
  ];
}

function coerceQuestions(raw: any): SetupQuestion[] {
  const arr = Array.isArray(raw?.questions) ? raw.questions : Array.isArray(raw) ? raw : null;
  if (!arr) return fallbackQuestions();
  const out: SetupQuestion[] = [];
  const seen = new Set<string>();
  for (const q of arr) {
    if (!q || typeof q !== "object") continue;
    const label = str(q.label, 160);
    if (!label) continue;
    let id = str(q.id, 40).replace(/[^a-zA-Z0-9_]/g, "") || `q${out.length + 1}`;
    if (seen.has(id)) id = `${id}_${out.length + 1}`;
    seen.add(id);
    const type: SetupQuestion["type"] =
      q.type === "select" || q.type === "chips" ? q.type : "text";
    const options =
      (type === "select" || type === "chips") && Array.isArray(q.options)
        ? strArray(q.options, 12, 60)
        : undefined;
    out.push({
      id,
      label,
      hint: str(q.hint, 200),
      type,
      options: options && options.length ? options : type === "text" ? undefined : undefined,
    });
    if (out.length >= 10) break;
  }
  return out.length >= 4 ? out : fallbackQuestions();
}

// ─── Prompt builders ─────────────────────────────────────────────────────────
function questionsPrompt(description: string): string {
  return `A creator wants to set up an automated YouTube Shorts channel. Their description:

"""
${description}
"""

Generate 6-10 setup questions whose answers let you fill this channel's whole config:
the niche specifics, the audience, the persona/voice, the default writing tone, the
content language, the YouTube @handle and channel name, how many Shorts per day (1-5),
which days of the week to publish, which content-type formats to enable, and a few
topic seeds. Tailor the questions to THIS creator's description — be specific to their
niche, don't ask generic filler.

Return ONLY valid JSON of this exact shape:
{
  "questions": [
    { "id": "shortCamelCaseId", "label": "The question", "hint": "one short helper line",
      "type": "text" | "select" | "chips", "options": ["only", "for", "select/chips"] }
  ]
}
Rules: 6-10 questions. Every question has id, label, hint, type. "select" = pick one,
"chips" = pick many, "text" = free typing. Only include "options" for select/chips.
This is a YouTube channel — never ask about Instagram, other platforms, or DMs.`;
}

function generatePrompt(description: string, answers: Record<string, string>, typeList: string): string {
  const answerLines = Object.entries(answers)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n");
  return `Build a complete YouTube Shorts channel configuration from the creator's
description and their answers. Fill EVERY field thoughtfully and specifically to their niche.

DESCRIPTION:
"""
${description}
"""

ANSWERS:
${answerLines || "(none — infer sensible values from the description)"}

Return ONLY valid JSON of this EXACT shape (do NOT invent extra keys):
{
  "brand": {
    "appName": "short product/channel app name",
    "niche": "the niche, e.g. home cooking",
    "tagline": "one short tagline",
    "purpose": "1-2 sentences on what the channel is about and what every Short should achieve",
    "persona": { "role": "who the creator persona is", "voice": "voice/tone notes", "purpose": "what the persona aims to do" },
    "audience": "who the content is for",
    "language": "content language, e.g. English",
    "defaultTone": "one of Friendly/Professional/Engaging/Casual/Bold/Educational",
    "ytHandle": "YouTube handle WITHOUT @",
    "ytChannelName": "public channel display name",
    "followCTA": "a short 'subscribe for more' style line"
  },
  "contentTypeLabels": { "TYPE_ID": "Renamed label" },
  "enabledTypes": ["TYPE_ID", "..."],
  "topics": ["8-15 concrete topic seeds specific to the niche"],
  "schedule": { "scheduleDays": [0,1,2,3,4,5,6], "postTimes": ["HH:MM"], "postsPerDay": 1 },
  "defaultPrompt": "a default content instruction for how this channel's Shorts should be written"
}

Valid TYPE_ID values (use ONLY these — ignore any others):
${typeList}
scheduleDays are integers 0=Sunday..6=Saturday. postTimes are 24h "HH:MM". postsPerDay is 1-5.
This is YouTube-only — never output Instagram handles, Reels, stories-schedules, or any non-YouTube field.`;
}

// ─── Map the AI config → real preferences/brand shape (PREVIEW; not written) ──
interface MappedConfig {
  brand: Partial<BrandConfig>;
  youtube: {
    postsPerDay: number;
    postTimes: string[];
    scheduleDays: number[];
    topics: string[];
    postTypes: string[];
  };
  ytDefaultPrompt: string;
  // A readable echo for the review UI.
  summary: {
    enabledTypes: Array<{ id: string; label: string }>;
    topics: string[];
  };
}

function mapConfig(raw: any, current: BrandConfig): MappedConfig {
  const b = (raw?.brand ?? {}) as any;

  // Content-type labels — keep only known slots, clamp label length.
  const labelsIn = (raw?.contentTypeLabels ?? {}) as Record<string, unknown>;
  const contentTypes: Partial<BrandConfig["contentTypes"]> = {};
  for (const [id, label] of Object.entries(labelsIn)) {
    if (!CONTENT_TYPE_SET.has(id)) continue;
    const lbl = str(label, 60);
    if (lbl) (contentTypes as any)[id] = { label: lbl };
  }

  // Enabled types — known slots only; drive contentTypes[].enabled for ALL slots
  // so the picker reflects exactly the AI's choice (unknown ids ignored).
  const enabledIn = Array.isArray(raw?.enabledTypes)
    ? raw.enabledTypes.filter((x: unknown): x is string => typeof x === "string" && CONTENT_TYPE_SET.has(x))
    : [];
  const enabledSet = new Set<string>(enabledIn.length ? enabledIn : ["EDUCATIONAL", "QUIZ", "PREVENTIVE", "CTA"]);
  for (const id of CONTENT_TYPE_IDS) {
    (contentTypes as any)[id] = { ...((contentTypes as any)[id] ?? {}), enabled: enabledSet.has(id) };
  }

  const topics = strArray(raw?.topics, 15, 200);

  // Schedule.
  const sched = (raw?.schedule ?? {}) as any;
  const scheduleDays = Array.isArray(sched.scheduleDays)
    ? Array.from(
        new Set(
          sched.scheduleDays.filter((d: unknown) => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6),
        ),
      ).sort((a, b) => (a as number) - (b as number)) as number[]
    : [0, 1, 2, 3, 4, 5, 6];
  const postTimes = Array.isArray(sched.postTimes)
    ? (Array.from(new Set(sched.postTimes.filter((t: unknown) => typeof t === "string" && HHMM_RE.test(t)))).sort() as string[])
    : ["19:00"];
  const postsPerDay = clampInt(sched.postsPerDay, 1, 5, 1);

  // YouTube postTypes = enabled slots the poster can publish (exclude STORY).
  const ytPostTypes = [...enabledSet].filter((id) => YT_POST_TYPE_SET.has(id));

  const persona = (b.persona ?? {}) as any;
  const mappedBrand: Partial<BrandConfig> = {
    appName: str(b.appName, 80, current.appName),
    tagline: str(b.tagline, 160, current.tagline),
    niche: str(b.niche, 120, current.niche),
    purpose: str(b.purpose, 600, current.purpose),
    audience: str(b.audience, 300, current.audience),
    language: str(b.language, 40, current.language || "English"),
    defaultTone: str(b.defaultTone, 40, current.defaultTone || "Friendly"),
    persona: {
      ...current.persona,
      role: str(persona.role, 200, current.persona.role),
      voice: str(persona.voice, 300, current.persona.voice),
      // Reuse the YouTube handle as the persona handle so replies/CTAs resolve.
      handle: handle(b.ytHandle, 60) || current.persona.handle,
      displayName: str(b.ytChannelName, 80, current.persona.displayName),
    },
    commentCtaLine: str(b.followCTA, 200, current.commentCtaLine || "Subscribe for more!"),
    youtube: {
      handle: handle(b.ytHandle, 60) || current.youtube.handle,
      channelName: str(b.ytChannelName, 100, current.youtube.channelName),
    },
    contentTypes: contentTypes as BrandConfig["contentTypes"],
    topics,
  };

  const enabledForSummary = CONTENT_TYPE_IDS.filter((id) => enabledSet.has(id)).map((id) => ({
    id,
    label: (contentTypes as any)[id]?.label || DEFAULT_CONTENT_TYPES[id].label,
  }));

  return {
    brand: mappedBrand,
    youtube: {
      postsPerDay,
      postTimes: postTimes.length ? postTimes : ["19:00"],
      scheduleDays,
      topics,
      postTypes: ytPostTypes.length ? ytPostTypes : DEFAULT_YT_POST_TYPES,
    },
    ytDefaultPrompt: str(raw?.defaultPrompt, 4000),
    summary: { enabledTypes: enabledForSummary, topics },
  };
}

// ─── Route ───────────────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  // Session gate (same shim/pattern as /api/ai/generate).
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ success: false, error: "Invalid request body" }, { status: 400 });
  }

  const stage = String((body as any).stage ?? "");
  const description = str((body as any).description, 4000);

  const sel = brandFromBody(body, brandFromQuery(request));
  const brandId = isAllBrands(sel) ? null : sel;

  try {
    // ── Stage 1: questions ──────────────────────────────────────────────────
    if (stage === "questions") {
      if (!description) {
        return NextResponse.json({ success: false, error: "Describe your channel first." }, { status: 400 });
      }
      const raw = await generateJSONResilient(
        questionsPrompt(description),
        "You are a helpful onboarding assistant for a YouTube Shorts automation tool. You reply with valid JSON only.",
        1800,
        brandId,
        "content",
      );
      const questions = coerceQuestions(parseJSON(raw));
      return NextResponse.json({ success: true, questions });
    }

    // ── Stage 2: generate (preview only) ────────────────────────────────────
    if (stage === "generate") {
      if (!description) {
        return NextResponse.json({ success: false, error: "Describe your channel first." }, { status: 400 });
      }
      const answersIn = (body as any).answers;
      const answers: Record<string, string> = {};
      if (answersIn && typeof answersIn === "object") {
        for (const [k, v] of Object.entries(answersIn)) {
          if (typeof v === "string" && v.trim()) answers[String(k).slice(0, 60)] = v.trim().slice(0, 600);
          else if (Array.isArray(v)) {
            const joined = v.filter((x) => typeof x === "string").join(", ").slice(0, 600);
            if (joined) answers[String(k).slice(0, 60)] = joined;
          }
        }
      }

      const typeList = CONTENT_TYPE_IDS.map((id) => `${id} (${DEFAULT_CONTENT_TYPES[id].label})`).join(", ");
      const raw = await generateJSONResilient(
        generatePrompt(description, answers, typeList),
        "You are an expert channel strategist. You output a complete config as valid JSON only, using ONLY the keys and content-type ids provided.",
        3000,
        brandId,
        "content",
      );
      const parsed = parseJSON(raw);
      if (!parsed) {
        return NextResponse.json(
          { success: false, error: "The AI could not produce a valid config. Try rephrasing your description." },
          { status: 502 },
        );
      }
      const current = (await readPreferencesForBrand(brandId)).brand;
      const config = mapConfig(parsed, current);
      return NextResponse.json({ success: true, config });
    }

    // ── Stage 3: apply (write) ──────────────────────────────────────────────
    if (stage === "apply") {
      const cfg = (body as any).config;
      if (!cfg || typeof cfg !== "object") {
        return NextResponse.json({ success: false, error: "No config to apply." }, { status: 400 });
      }
      // Re-run the mapper over the (reviewed) config so we never trust the client
      // blindly — everything is coerced/clamped again before it touches the DB.
      const prefs = await readPreferencesForBrand(brandId);
      // The apply payload IS the mapped preview; re-validate its brand/youtube/prompt.
      const mapped: MappedConfig =
        cfg.brand && cfg.youtube ? sanitizeMapped(cfg, prefs.brand) : mapConfig(cfg, prefs.brand);

      const updated = await writePreferencesForBrand(brandId, {
        brand: { ...mapped.brand, configured: true } as any,
        youtube: {
          ...prefs.youtube,
          postsPerDay: mapped.youtube.postsPerDay,
          postTimes: mapped.youtube.postTimes,
          scheduleDays: mapped.youtube.scheduleDays,
          topics: mapped.youtube.topics,
          postTypes: mapped.youtube.postTypes,
        },
        ytDefaultPrompt: mapped.ytDefaultPrompt,
      });
      return NextResponse.json({ success: true, brand: updated.brand });
    }

    return NextResponse.json({ success: false, error: `Unknown stage "${stage}"` }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message ?? "AI setup failed" }, { status: 500 });
  }
}

/**
 * Re-validate an already-mapped preview config (the apply payload) so the write
 * path never trusts the client. Clamps/whitelists the same fields mapConfig does.
 */
function sanitizeMapped(cfg: any, current: BrandConfig): MappedConfig {
  const b = (cfg.brand ?? {}) as any;
  const persona = (b.persona ?? {}) as any;

  const contentTypesIn = (b.contentTypes ?? {}) as Record<string, any>;
  const contentTypes: Partial<BrandConfig["contentTypes"]> = {};
  for (const id of CONTENT_TYPE_IDS) {
    const src = contentTypesIn[id] ?? {};
    const patch: any = { enabled: src.enabled === true };
    if (typeof src.label === "string" && src.label.trim()) patch.label = src.label.trim().slice(0, 60);
    contentTypes[id] = patch;
  }
  const enabledSet = new Set<string>(CONTENT_TYPE_IDS.filter((id) => (contentTypes as any)[id]?.enabled));

  const yt = (cfg.youtube ?? {}) as any;
  const scheduleDays = Array.isArray(yt.scheduleDays)
    ? (Array.from(new Set(yt.scheduleDays.filter((d: unknown) => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6))).sort((a, b) => (a as number) - (b as number)) as number[])
    : [0, 1, 2, 3, 4, 5, 6];
  const postTimes = Array.isArray(yt.postTimes)
    ? (Array.from(new Set(yt.postTimes.filter((t: unknown) => typeof t === "string" && HHMM_RE.test(t)))).sort() as string[])
    : ["19:00"];
  const postTypes = Array.isArray(yt.postTypes)
    ? yt.postTypes.filter((t: unknown): t is string => typeof t === "string" && YT_POST_TYPE_SET.has(t) && enabledSet.has(t))
    : [];
  const topics = strArray(b.topics ?? yt.topics, 15, 200);

  const mappedBrand: Partial<BrandConfig> = {
    appName: str(b.appName, 80, current.appName),
    tagline: str(b.tagline, 160, current.tagline),
    niche: str(b.niche, 120, current.niche),
    purpose: str(b.purpose, 600, current.purpose),
    audience: str(b.audience, 300, current.audience),
    language: str(b.language, 40, current.language || "English"),
    defaultTone: str(b.defaultTone, 40, current.defaultTone || "Friendly"),
    persona: {
      ...current.persona,
      role: str(persona.role, 200, current.persona.role),
      voice: str(persona.voice, 300, current.persona.voice),
      handle: handle(b.youtube?.handle ?? persona.handle, 60) || current.persona.handle,
      displayName: str(persona.displayName ?? b.youtube?.channelName, 80, current.persona.displayName),
    },
    commentCtaLine: str(b.commentCtaLine, 200, current.commentCtaLine || "Subscribe for more!"),
    youtube: {
      handle: handle(b.youtube?.handle, 60) || current.youtube.handle,
      channelName: str(b.youtube?.channelName, 100, current.youtube.channelName),
    },
    contentTypes: contentTypes as BrandConfig["contentTypes"],
    topics,
  };

  return {
    brand: mappedBrand,
    youtube: {
      postsPerDay: clampInt(yt.postsPerDay, 1, 5, 1),
      postTimes: postTimes.length ? postTimes : ["19:00"],
      scheduleDays,
      topics,
      postTypes: postTypes.length ? postTypes : DEFAULT_YT_POST_TYPES,
    },
    ytDefaultPrompt: str(cfg.ytDefaultPrompt, 4000),
    summary: {
      enabledTypes: CONTENT_TYPE_IDS.filter((id) => enabledSet.has(id)).map((id) => ({
        id,
        label: (contentTypes as any)[id]?.label || DEFAULT_CONTENT_TYPES[id].label,
      })),
      topics,
    },
  };
}
