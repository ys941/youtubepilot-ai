/**
 * lib/ai-factory.ts
 *
 * Central AI dispatch. The user configures, in Settings → AI Config, a
 * provider + model + ordered FALLBACK CHAIN PER TASK LANE:
 *   • content  — post/caption/hook/script generation   (ai.contentChain)
 *   • reply    — YouTube comment auto-replies           (ai.replyChain)
 *   • vision   — image/video analysis                   (ai.visionChain)
 *
 * Providers: "groq" | "cerebras" (both OpenAI-compatible → GrokClient) | "gemini".
 * Every generation path flows through here, so the user's model + chain choices
 * apply to EVERYTHING.
 *
 * Usage:
 *   import { getAIClient } from "@/lib/ai-factory";
 *   const ai = await getAIClient("reply");
 *   const reply = await ai.generateCommentReply(...);
 */

import { GrokClient, getGrokClient } from "@/lib/grok";
import { GeminiClient } from "@/lib/gemini";
import { readPreferences, readPreferencesForBrand, getBrand } from "@/lib/preferences";
import {
  providerSupportsVideo, coerceChain, chainSteps,
  type AIProvider, type ChainStep, type AITask, type Chain,
} from "@/lib/aiModels";

export type AIClient = GrokClient | GeminiClient;

const CEREBRAS_BASE = "https://api.cerebras.ai/v1";

async function readAi(brandId?: string | null): Promise<any> {
  try {
    if (brandId) return (await readPreferencesForBrand(brandId)).ai ?? {};
    return (await readPreferences()).ai ?? {};
  } catch {
    return {};
  }
}

/** Resolve the API key for a provider: env var first, then the DB-stored key. */
function keyFor(provider: AIProvider, ai: any): string {
  if (provider === "gemini")   return (process.env.GEMINI_API_KEY?.trim())   || (ai?.geminiApiKey?.trim()   ?? "");
  if (provider === "cerebras") return (process.env.CEREBRAS_API_KEY?.trim()) || (ai?.cerebrasApiKey?.trim() ?? "");
  return (process.env.GROK_API_KEY || process.env.GROQ_API_KEY || "").trim(); // groq (env-only, both spellings)
}

/** Concrete client for a provider+model, or null when its key is missing. */
function clientInstance(provider: AIProvider, model: string, ai: any): AIClient | null {
  const key = keyFor(provider, ai);
  if (!key) return null;
  if (provider === "gemini") return new GeminiClient(key);
  const baseURL = provider === "cerebras" ? CEREBRAS_BASE : (process.env.GROK_API_URL || undefined);
  return new GrokClient(key, { baseURL, model });
}

/** text/json runner bound to one provider+model, or null when the key is missing. */
function makeRunner(provider: AIProvider, model: string, ai: any):
  | { text: (p: string, s: string, m: number) => Promise<string>; json: (p: string, s: string, m: number) => Promise<string> }
  | null {
  const c = clientInstance(provider, model, ai);
  if (!c) return null;
  if (c instanceof GeminiClient) {
    // Run EXACTLY the chosen Gemini model (not Gemini's internal chain) so the
    // user's model selection is honoured; the outer chain provides fallback.
    return {
      text: (p, s, m) => c.generateContentInModels([model], p, s, m),
      // jsonOutput=true → Gemini structured-output mode (responseMimeType application/json)
      json: (p, s, m) => c.generateContentInModels([model], p, s, m, true),
    };
  }
  const g = c as GrokClient;
  return {
    text: (p, s, m) => g.generateContent(p, s, m),
    json: (p, s, m) => g.generateContentJSON(p, s, m),
  };
}

/**
 * Build the ordered execution chain for a TASK lane (content/reply/vision) from the
 * stored per-task chain, migrating from legacy single-chain fields when present,
 * else the task default. Returns [primary, ...fallbacks], de-duplicated.
 */
function chainForTask(ai: any, task: AITask): ChainStep[] {
  let raw: any = null;
  if (task === "content") raw = ai?.contentChain;
  else if (task === "reply") raw = ai?.replyChain;
  else if (task === "vision") raw = ai?.visionChain;

  // Legacy migration: derive a chain from the old flat fields if no per-task chain.
  if (!raw) {
    if (task === "vision" && ai?.aiVisionProvider) {
      raw = { provider: ai.aiVisionProvider, model: ai.aiVisionModel, fallbacks: ai.aiVisionFallbacks ?? [] };
    } else if (task !== "vision" && ai?.aiProvider) {
      raw = { provider: ai.aiProvider, model: ai.aiModel, fallbacks: ai.aiFallbacks ?? [] };
    }
  }
  const chain: Chain = coerceChain(task, raw ?? undefined);
  return chainSteps(chain);
}

/**
 * Returns the active AI client (PRIMARY provider+model) for a TASK lane. Used by the
 * provider-level methods (comment replies = "reply", topic gen = "content", etc.).
 * Falls back down the lane's chain if the primary's key is missing, then to Groq env.
 */
export async function getAIClient(task: AITask = "content", brandId?: string | null): Promise<AIClient> {
  const ai = await readAi(brandId);
  for (const step of chainForTask(ai, task)) {
    const c = clientInstance(step.provider, step.model, ai);
    if (c) return c;
  }
  console.warn(`[AIFactory] No provider key for task "${task}" — using Groq env client`);
  return getGrokClient();
}

/** Record a provider 429 / quota exhaustion as a rate-limit event so it surfaces in
 *  the morning digest's System Health. Best-effort; dynamic import avoids any cycle. */
function noteAiRateLimit(provider: string, model: string, err: any): void {
  const msg = String(err?.message ?? err ?? "");
  if (!/\b429\b|rate limit|tokens per day|\bTPD\b|quota|resource_exhausted/i.test(msg)) return;
  import("@/lib/notifier")
    .then((n) => n.logRateLimitEvent(`AI: ${provider}/${model}`, msg.slice(0, 220)))
    .catch(() => {});
}

/**
 * Resilient plain-text generation across the user's configured chain
 * (primary → fallbacks). Returns the first non-empty result that passes `validate`;
 * if none passes, the best non-empty result; throws only if EVERY tier fails.
 */
export async function generateTextResilient(
  prompt: string,
  system: string,
  maxTokens = 2000,
  validate?: (text: string) => boolean,
  brandId?: string | null,
  task: AITask = "content",
): Promise<string> {
  const ai    = await readAi(brandId);
  const chain = chainForTask(ai, task);

  let lastErr: unknown;
  let bestNonEmpty = "";
  for (let i = 0; i < chain.length; i++) {
    const step   = chain[i];
    const runner = makeRunner(step.provider, step.model, ai);
    if (!runner) { console.warn(`[AIFactory] skip ${step.provider}/${step.model} — no API key`); continue; }
    try {
      const out = await runner.text(prompt, system, maxTokens);
      if (out && out.trim().length > 0) {
        if (!validate || validate(out)) {
          if (i > 0) console.log(`[AIFactory] text served by fallback: ${step.provider}/${step.model}`);
          return out;
        }
        if (!bestNonEmpty) bestNonEmpty = out;
        console.warn(`[AIFactory] ${step.provider}/${step.model} failed quality gate — trying next`);
      }
    } catch (err: any) {
      lastErr = err;
      console.warn(`[AIFactory] ${step.provider}/${step.model} failed:`, err?.message ?? err);
      noteAiRateLimit(step.provider, step.model, err);
    }
  }
  if (bestNonEmpty) return bestNonEmpty;
  throw lastErr ?? new Error("[AIFactory] all text tiers failed");
}

/**
 * Resilient JSON generation across the configured chain. A tier's result is accepted
 * only if, after stripping ```json fences, its first {...} or [...] block actually
 * JSON.parses — merely "looking like" JSON (truncated/degraded output) is a tier
 * failure. Returns a RAW JSON string (caller parses), the best non-empty raw string
 * if no tier parses, or "".
 */
export async function generateJSONResilient(
  prompt: string,
  system: string,
  maxTokens = 2000,
  brandId?: string | null,
  task: AITask = "content",
): Promise<string> {
  const ai    = await readAi(brandId);
  const chain = chainForTask(ai, task);

  /** Extract the first {...} or [...] block and verify it actually JSON.parses. */
  const parsesAsJSON = (raw: string): boolean => {
    const cleaned = raw.replace(/```json\n?/gi, "").replace(/```\n?/gi, "").trim();
    const match = cleaned.match(/\{[\s\S]*\}/) ?? cleaned.match(/\[[\s\S]*\]/);
    try { JSON.parse(match ? match[0] : cleaned); return true; } catch { return false; }
  };

  let bestNonEmpty = "";
  for (let i = 0; i < chain.length; i++) {
    const step   = chain[i];
    const runner = makeRunner(step.provider, step.model, ai);
    if (!runner) { console.warn(`[AIFactory] skip ${step.provider}/${step.model} — no API key`); continue; }
    try {
      const out = await runner.json(prompt, system, maxTokens);
      if (out && out.trim().length > 0) {
        if (parsesAsJSON(out)) {
          if (i > 0) console.log(`[AIFactory] JSON served by fallback: ${step.provider}/${step.model}`);
          return out;
        }
        if (!bestNonEmpty) bestNonEmpty = out;
        console.warn(`[AIFactory] ${step.provider}/${step.model} returned unparseable JSON — trying next`);
      }
    } catch (err: any) {
      console.warn(`[AIFactory] JSON tier ${step.provider}/${step.model} failed:`, err?.message ?? err);
      noteAiRateLimit(step.provider, step.model, err);
    }
  }
  return bestNonEmpty;
}

// ─────────────────────────────────────────────────────────────────────────────
// VISION — configurable image/video analysis chain (Settings → AI Config → Vision)
// ─────────────────────────────────────────────────────────────────────────────

/** Per-post-type caption instruction for vision analysis (niche-neutral). */
const VISION_TYPE_INSTRUCTIONS: Record<string, string> = {
  QUIZ:           "Write a quiz caption — pose a question about what you see and prompt 'Drop your answer below!' (80-120 words, no answer).",
  EDUCATIONAL:    "Write an educational caption with a bold hook, 3-4 bullet insights from this image, and a save/share CTA (150-220 words).",
  CLINICAL_PEARL: "Write a pro-tip caption — one high-value insight from this image, then context (100-150 words).",
  CASE_STUDY:     "Write a story/example caption — a brief scenario based on this image, key takeaways, an engaging CTA (150-200 words).",
  CAROUSEL:       "Write a carousel caption with a powerful hook about this image that makes viewers keep going. End with 'Save this for later' (100-150 words).",
  PREVENTIVE:     "Write a how-to/tips caption using insights from this image, a shocking statistic hook, actionable tips, share CTA (150-200 words).",
  REEL:           "Write a short-video caption with a punchy hook about what's shown, key takeaway, and 'Watch till end!' (80-100 words).",
  MYTH_FACT:      "Write a myth vs fact caption based on this image. Open with 'MYTH:' then 'FACT:' rebuttal with evidence. CTA to share (120-180 words).",
  CTA:            "Write a warm CTA caption inspired by this image, explaining why following this channel is valuable (80-120 words).",
};

function buildVisionPrompt(postType: string, niche: string, audience: string): string {
  const instruction = VISION_TYPE_INSTRUCTIONS[postType] ?? VISION_TYPE_INSTRUCTIONS.EDUCATIONAL;
  return `You are a world-class ${niche} content creator analysing this image/video.

Post type: ${postType}
Niche: ${niche}. Audience: ${audience}.
Instructions: ${instruction}

Rules:
- Write specifically about what you actually SEE — real, concrete details from the image/video.
- If it's a short-video/clip: describe what is being demonstrated.
- Start with a HOOK line that stops the scroll. Use line breaks between sections.
- NO hashtags in the caption text. No asterisks/markdown. End with a strong CTA.

After the caption, output exactly 4 relevant hashtags starting with #.
Return ONLY valid JSON: { "caption": "...", "hashtags": ["#tag1","#tag2","#tag3","#tag4"] }`;
}

/**
 * Analyse an image/video (base64) into a caption + hashtags, walking the user's
 * configured VISION chain (primary → fallbacks). Returns null if all tiers fail.
 * Video is routed only to providers that support it (Gemini).
 */
export async function analyzeMediaResilient(
  data: string,
  mimeType: string,
  postType: string,
  brandId?: string | null,
): Promise<{ caption: string; hashtags: string[] } | null> {
  const ai    = await readAi(brandId);
  const chain = chainForTask(ai, "vision");
  const norm  = mimeType === "image/jpg" ? "image/jpeg" : mimeType;
  const isVideo = norm.startsWith("video/");
  const brand   = await getBrand(brandId);
  const prompt  = buildVisionPrompt(postType, brand.niche, brand.audience);

  const parse = (raw: string): { caption: string; hashtags: string[] } | null => {
    try {
      const cleaned = raw.replace(/```json\n?/gi, "").replace(/```\n?/gi, "").trim();
      const match = cleaned.match(/\{[\s\S]*\}/);
      const obj = JSON.parse(match ? match[0] : cleaned);
      if (!obj?.caption) return null;
      return {
        caption:  String(obj.caption).trim(),
        hashtags: (Array.isArray(obj.hashtags) ? obj.hashtags : []).map((h: string) => (String(h).startsWith("#") ? h : `#${h}`)).slice(0, 4),
      };
    } catch { return null; }
  };

  for (let i = 0; i < chain.length; i++) {
    const step = chain[i];
    if (isVideo && !providerSupportsVideo(step.provider)) {
      console.warn(`[AIFactory/vision] skip ${step.provider} — no video support`);
      continue;
    }
    const key = keyFor(step.provider, ai);
    if (!key) { console.warn(`[AIFactory/vision] skip ${step.provider}/${step.model} — no API key`); continue; }
    try {
      let raw = "";
      if (step.provider === "gemini") {
        raw = await new GeminiClient(key).visionRaw(step.model, data, norm, prompt);
      } else {
        const baseURL = step.provider === "cerebras" ? CEREBRAS_BASE : (process.env.GROK_API_URL || undefined);
        raw = await new GrokClient(key, { baseURL, model: step.model }).visionRaw(step.model, data, norm, prompt);
      }
      const parsed = parse(raw);
      if (parsed) {
        if (i > 0) console.log(`[AIFactory/vision] served by fallback: ${step.provider}/${step.model}`);
        return parsed;
      }
      console.warn(`[AIFactory/vision] ${step.provider}/${step.model} returned no usable caption — trying next`);
    } catch (err: any) {
      console.warn(`[AIFactory/vision] ${step.provider}/${step.model} failed:`, err?.message ?? err);
    }
  }
  return null;
}
