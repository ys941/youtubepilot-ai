<div align="center">

# 🚀 YouTubePilot AI

### Autonomous, white-label AI content engine for **YouTube Shorts** — for *any* niche

<p>
  <img alt="Next.js 16" src="https://img.shields.io/badge/Next.js-16-000000?style=for-the-badge&logo=nextdotjs&logoColor=white" />
  <img alt="React 18" src="https://img.shields.io/badge/React-18-20232A?style=for-the-badge&logo=react&logoColor=61DAFB" />
  <img alt="TypeScript 5" src="https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=white" />
  <img alt="PostgreSQL + Prisma" src="https://img.shields.io/badge/Postgres-Prisma-2D3748?style=for-the-badge&logo=prisma&logoColor=white" />
  <img alt="Grok + Gemini" src="https://img.shields.io/badge/AI-Grok%20%2B%20Gemini-7C3AED?style=for-the-badge&logo=google&logoColor=white" />
  <img alt="YouTube Data API v3" src="https://img.shields.io/badge/YouTube-Data%20API%20v3-FF0000?style=for-the-badge&logo=youtube&logoColor=white" />
</p>

<p>
  <a href="#-deployment"><img alt="Deploy on Railway" src="https://img.shields.io/badge/Deploy%20on-Railway-0B0D0E?style=for-the-badge&logo=railway&logoColor=white" /></a>
  <a href="#-deployment"><img alt="Docker ready" src="https://img.shields.io/badge/Docker-ready-2496ED?style=for-the-badge&logo=docker&logoColor=white" /></a>
  <img alt="License" src="https://img.shields.io/badge/license-Proprietary-lightgrey?style=for-the-badge" />
</p>

<a href="https://railway.com/new"><img src="https://railway.com/button.svg" alt="Deploy on Railway" height="44" /></a>

<sub>Invent ideas → write the script → render multi-slide video cards → stitch a vertical Short with music → write title/tags → schedule & upload → seed comment → auto-reply to viewers — <b>all unattended.</b></sub>

</div>

---

**YouTubePilot AI** is a production-grade SaaS that **fully automates a YouTube Shorts channel** end to end: it invents on-topic ideas, writes the script with AI, renders branded multi-slide video cards, stitches them into a vertical Short with music, writes the title/description/tags, uploads on a schedule you set, posts an engagement seed comment, replies to viewer comments, and emails you a daily health report — all unattended. It is **white-label and niche-agnostic**: cooking, fitness, finance, travel, education, tech, beauty, history, anything. You configure the app name, niche, voice, channel handle, and content-type labels **entirely from the Settings UI — no code changes** — and you bring your own API keys.

```bash
# 60-second start (Docker)
cp .env.example .env          # fill in your keys (see "Getting your API keys")
docker compose up -d --build  # app + PostgreSQL
# open http://localhost:3000 → log in with APP_ACCESS_KEY → Settings → Brand
```

```bash
# 60-second start (local Node)
npm install
cp .env.example .env.local
npm run db:generate && npm run db:push
npm run dev                   # http://localhost:3000
```

---

## 📑 Table of Contents

1. [What It Does (a day in the life)](#-what-it-does-a-day-in-the-life)
2. [White-Label / Any-Niche](#-white-label--any-niche)
3. [Content Types](#-content-types)
4. [Key Features](#-key-features)
5. [How a Short Is Built (pipeline)](#-how-a-short-is-built-pipeline)
6. [Multi-Account (Brands)](#-multi-account-brands)
7. [Tech Stack](#-tech-stack)
8. [Architecture](#-architecture)
9. [Settings Reference](#-settings-reference)
10. [Setup / Installation](#-setup--installation)
11. [Getting Your API Keys](#-getting-your-api-keys)
12. [First-Run Checklist](#-first-run-checklist)
13. [Deployment](#-deployment)
14. [Cost & Quota Planning](#-cost--quota-planning)
15. [Project Structure](#-project-structure)
16. [Troubleshooting / FAQ](#-troubleshooting--faq)
17. [Security](#-security)
18. [License](#-license)

---

## 🎬 What It Does (a day in the life)

Once configured and left running, here is what happens automatically for **each channel ("brand")** you've added:

1. **It wakes up on schedule.** An in-process loop ticks every ~5 minutes; a daily timer also fires once a day. No external cron needed.
2. **It picks fresh topics.** It pulls the next topics from your rotating list. When the list runs dry, the AI invents new same-style topics so content never repeats. **Anti-repetition is theme-level**: the generator is shown your recent titles (up to 40) and told to pick a genuinely **different subject/theme**, not just reword a recent one — so the channel doesn't keep circling the same idea.
3. **It writes the content.** Using your chosen AI provider (Grok or Gemini) and your brand's niche + persona, it writes a hook, the body points, and a CTA in valid structured JSON. **Titles are audit-driven** — a concrete everyday noun plus a specific curiosity or benefit (a number only when truthful), with vague/abstract patterns banned; a **title-quality gate** re-generates a weak title before publish, and topic **de-duplication is enforced** so the same subject isn't produced twice.
4. **It designs the cards.** Each Short becomes a vertical 9:16 **carousel**: a curiosity **hook cover** → several **large-text content slides** (each a **complete, beautifully-written sentence** that weaves its stat into real prose, not a terse fragment) → a **SUBSCRIBE outro**. A different color theme is chosen per Short.
5. **It renders the video.** Cards are rasterized (Satori → SVG → Sharp) and stitched into a 720×1280 MP4 with **ffmpeg**. Gemini "looks at" the cover to pick a mood, and a matching royalty-free **Jamendo** track is mixed under it.
6. **It writes the metadata.** One rich caption (hook → intro → key points → "why it matters" → follow CTA) is reused as the description; AI generates **YouTube search tags** + `#Shorts`; the hook line becomes the custom thumbnail.
7. **It publishes** at your configured per-weekday times via the YouTube Data API v3, then **posts a seed comment** to kick-start engagement.
8. **It engages.** It reads new comments on recent videos and **replies with Grok** — mirroring the **viewer's own language and script** (English, Hindi, Hinglish, or a mix), and careful never to reply to itself (matches channel id, title, and @handle, including the seed comment).
9. **It reports.** Channel + per-video analytics sync to the dashboard, every action is logged to an activity feed with live SSE alerts, and a **daily health email** summarizes publishes, failures, 24h stats, and system health.

You mostly just watch the dashboard.

---

## 🎨 White-Label / Any-Niche

YouTubePilot ships **niche-neutral** and is re-skinnable for any brand **entirely from the UI — no code edits**.

- **Brand skin (per account)** — in **Settings → Brand** set your **app name**, **niche/topic**, **persona/voice**, **YouTube handle + channel name**, and the **follow CTA**. The skin is stored *per account* (`BrandConfig`), so every channel you add can carry its own identity. A neutral default ("YouTubePilot AI") ships out of the box.
- **AI generators & prompts** — choose your content provider (**Grok**/Groq or **Gemini**) and override the **system prompt / persona** and **per-content-type prompts** in **Settings → AI** and **Settings → Prompts**. The brand's niche and persona are injected into every generation, so the AI writes about *your* topic in *your* voice.
- **Rename content types** — the content slots keep stable internal IDs (so your data never breaks), but their **user-facing labels** are fully renameable in **Settings → Content Types** (e.g. "Knowledge Quiz" → "Trivia Time", "Pro Tip" → "Chef's Secret"). Captions, cards, and the generator all read the label.
- **Bring your own keys** — **no API keys are bundled.** You supply your own Groq / Gemini / Cloudinary / Resend / YouTube (and optional Jamendo) credentials via env or the Settings UI. See [Getting Your API Keys](#-getting-your-api-keys).
- **Handles resolve at render time** — captions use a neutral handle placeholder resolved to the active brand's handle when published, so switching brands never leaks another channel's handle.

### Worked example — re-skinning to a cooking channel
1. **Settings → Brand:** App name `Tasty Bites AI`, niche `quick weeknight recipes`, persona `a friendly home cook who keeps it simple`, YouTube handle `@tastybites`, channel name `Tasty Bites`.
2. **Settings → AI:** Provider `Grok`, default tone `warm & encouraging`, language `English`.
3. **Settings → Content Types:** rename `Pro Tip → Kitchen Hack`, `How-To / Tips → 5-Step Recipe`, disable `Image Quiz`.
4. **Settings → YouTube:** topics = `15-min pastas, sheet-pan dinners, 5-ingredient desserts, …`; 2 Shorts/day at `08:00` and `18:00`; enable comment replies.
5. **Save.** Every future Short is now a cooking Short in your voice — without touching a line of code.

> **TL;DR for a new owner:** clone → set env keys → log in → **Settings → Brand** (name, niche, handle) → **Settings → AI/Prompts** (provider, voice) → **Settings → Content Types** (labels) → add your channels → set the schedule. You're live in your own niche.

---

## 🧩 Content Types

Content slots have **stable internal IDs** (kept for data/schema compatibility — some carry legacy names) and **neutral, renameable display labels**. The generator and auto-poster pick from the **enabled** types. Rename or toggle any of them in **Settings → Content Types**.

| Internal ID | Default label | What it produces | Enabled by default |
|-------------|---------------|------------------|:---:|
| `EDUCATIONAL` | **Educational** | Teach one concept clearly with real value | ✅ |
| `MYTH_FACT` | **Myth vs Fact** | Debunk a common misconception in your niche | ✅ |
| `CLINICAL_PEARL` | **Pro Tip** | One high-value, save-worthy tip or insight | ✅ |
| `CASE_STUDY` | **Story / Example** | A real-world example or story with a takeaway | ✅ |
| `PREVENTIVE` | **How-To / Tips** | Actionable steps or a checklist to apply | ✅ |
| `ANGIOGRAPHY_QUIZ` | **Image Quiz** | An image-based "can you spot it / what is this?" challenge | ⬜ |
| `ECG_QUIZ` | **Knowledge Quiz** | A deeper interpretation/knowledge challenge with options | ⬜ |
| `CAROUSEL` | **Carousel** | A multi-slide deck (renders its own authored slides) | ✅ |

> Quiz types are rendered as setup/question/option slides and **never reveal the answer in the Short** — the answer is invited in the comments to drive engagement.

---

## ✨ Key Features

### 🪄 AI Setup (describe your channel, the AI configures it)
- **One-shot channel setup from a description.** In **Settings → AI Setup**, describe the channel you want in plain English. Groq (the content AI lane) then asks **6-10 tailored questions** (niche specifics, audience, persona/voice, tone, language, YouTube @handle + channel name, Shorts/day, publishing days, which content-type formats to enable, topic seeds) and fills your **entire config**: brand skin, content-type labels/enabled slots, 8-15 topic seeds, the publishing schedule, persona/tone/language, channel handle + name, and a default content prompt.
- **Review before it writes.** The generated config is shown as readable **Brand / Channel / Persona / Content-types / Topics / Schedule** cards; **Apply** persists it via the normal preferences store (brand-scoped), and you can **Regenerate** or refine anytime in the other tabs. A **Manual** toggle keeps the fully hand-driven path (Brand / Content Types / YouTube) unchanged. Everything the AI returns is validated/clamped server-side (known content-type ids only, `postsPerDay` 1-5, valid `HH:MM`, days 0-6). Powered by `POST /api/ai/setup` (stages `questions` / `generate` / `apply`).

### 🧠 AI content generation
- **Per-task AI Config — provider + model + fallback chain (per brand).** **Settings → AI** configures **three independent task lanes**, each an ordered fallback **chain** of `provider · model` steps tried top-to-bottom until one succeeds:
  - **Content** (`contentChain`) — scripts, captions, hooks.
  - **Reply** (`replyChain`) — YouTube comment auto-replies.
  - **Vision** (`visionChain`) — cover-card analysis for music mood (**Gemini/Groq only** — text-only providers excluded).
  Providers are **Grok** (Groq Llama-3.3-70B), **Cerebras** (`gpt-oss-120b`, OpenAI-compatible), and **Google Gemini**. `resolveModel`/`analyzeMediaResilient` walk the configured chain (`lib/aiModels.ts` + `lib/ai-factory.ts`), so a single provider outage or quota exhaustion transparently falls through to the next step. Defaults seed a Groq-first content/reply chain and a Gemini-first vision chain, so existing setups keep working. The auto-poster resolves each chain **per brand** via `getAIClient(task, brandId)`. **Known limitation:** vision analysis + YouTube tags call the factory with no brand id, so they use the **primary** brand's chain regardless of which brand is publishing.
- **Cerebras support.** Add a **Cerebras** key (`Settings → AI` `cerebrasApiKey`, or `CEREBRAS_API_KEY` env) and select it in any content/reply lane for very fast `gpt-oss-120b` inference; it has no vision model, so it's omitted from the vision lane.
- **Brand-aware persona.** The active brand's **niche** and **persona/voice** are injected into the system prompt (`buildBrandSystemPrompt` / `buildBrandPersona`), so generated content matches your topic and tone.
- **Topic rotation + auto-expansion.** Every used topic is logged; once your configured topics run out, the AI generates fresh same-style topics so content never repeats.

### ▶️ YouTube Shorts automation
- **Independent auto-poster** — `runAutoGenerateYouTube()` is driven entirely by each brand's **Settings → YouTube**: its own topics, post types, post times, days, and posts-per-day.
- **Every Short is a multi-slide carousel** — see [How a Short Is Built](#-how-a-short-is-built-pipeline).
- **A different theme per Short** — a rotating counter cycles through all `THEMES`, so consecutive Shorts get *guaranteed* distinct palettes; the chosen theme is shared by the hook cover, content slides, and outro (cohesive within a Short, varied across Shorts). Cached per `post.id` so re-rendering stays stable.
- **AI-written full, card-faithful caption (resilient fallback chain)** — `buildRichCaption()` writes one rich, **stat-backed** caption via a tiered chain — **Gemini flash → Grok → Gemini reasoning** (`generateTextResilient`, with a completeness validator that demands length **and** ≥3 numbered points) — so it never silently degrades to a thin/truncated result. **Fidelity rules** force the caption to expand *every* card point in order using the card's **exact** figures (never invented, rounded, or skipped), then add the mechanism + why-it-matters. Generated once and cached per `post.id`.
- **Engagement seed comment on every upload** — after upload, the channel auto-posts a friendly engagement-question comment (`buildSeedComment()`) to kick-start comment velocity (a strong Shorts reach signal).
- **Mood-matched music** — Gemini **vision** reads the cover card → picks a mood → **Jamendo** returns a CC-licensed instrumental, mixed under the video (faded) and credited in the description. Best-effort: any failure or missing `JAMENDO_CLIENT_ID` → silent Short.
- **🎙️ AI voiceover + word-by-word captions (opt-in, default OFF)** — turn each Short into a narrated video:
  - **Voiceover + per-card-synced timing** (`voiceover`, default OFF) — an AI voice narrates the Short, mixed at full volume over the **auto-ducked** background music (it becomes the dominant track). **Each card is narrated as its own segment** (hook → each content slide's text → CTA, in card order) and **each card shows exactly while ITS text is spoken**, so the voice never drifts from the card on screen. The per-segment clips are stitched into one track with per-card silence padding (`assembleVoiceTrack`, `lib/videoGenerator.ts`). **Length adapts to the content** — a card with **long text automatically holds longer** (and the Short grows), capped at YouTube's ~3-min Shorts ceiling (**≤180s**). The **`secondsPerImage`** ("Seconds per card") setting is the **minimum** hold per content card: a card always stays at least that long; if its narration is longer it shows for the full narration; any extra time becomes a short **silence inserted into the audio** to keep the voice in sync. Best-effort by design: per-card segments → single narration + even split → silent, music-only Short.
  - **Selectable voice** (`voiceoverVoice`) — pick an **Orpheus** voice: male `daniel` (default), `austin`, `troy`; female `autumn`, `diana`, `hannah`.
  - **Burned captions** (`burnCaptions`, default OFF) — **OFF** → no hardcoded captions, so YouTube **auto-generates and auto-translates** captions into each viewer's language (the upload declares `defaultLanguage`/`defaultAudioLanguage = "en"`), reaching a global audience for free. **ON** → burns **TikTok-style word-by-word captions** into the video (bundled Geist font `public/fonts/CFSans.ttf` via libass; the active word pops gold and scales, in a lower-middle safe zone), timed from **Groq Whisper** word-level timestamps (`whisper-large-v3`) → ASS subtitles → a re-encode pass.
  - **TTS providers** (`lib/tts.ts`, `TTS_PROVIDER` default `groq`, auto-falling-back to the other then Gemini): **Groq Orpheus** (`canopylabs/orpheus-v1-english`; needs a one-time org-admin terms acceptance in the Groq console; tune via `GROQ_TTS_MODEL`/`GROQ_TTS_VOICE`), **Canopy self-hosted** (`CANOPY_TTS_URL`/`CANOPY_TTS_KEY`/`CANOPY_TTS_VOICE`, set `TTS_PROVIDER=canopy`), and **Gemini TTS** (last-resort).
  - **Performance note:** voiceover adds a TTS call per Short (plus a Whisper call and one extra re-encode **only when `burnCaptions` is ON**) — heavier on memory, which is why it ships opt-in and OFF by default.
- **AI YouTube search tags** — `buildYouTubeTagsAI()` generates search-optimized keyword tags (deterministic `buildYouTubeTags()` fallback); `uploadShort()` adds `#` prefixes, appends `#Shorts`, and uploads via Data API v3.
- **YouTube comment auto-replies** — `replyToYouTubeComments()` reads recent-video comment threads (and nested replies) and replies with **Grok**, deduped via the `Comment` table and an atomic claim. **Robust own-comment skipping**: it compares the channel id, channel title, and `@handle` so it never replies to itself (including the seed comment). Toggle in **Settings → YouTube**.
- **Transparent AI-assistant reply persona** — the reply bot identifies as the **channel's AI assistant** (driven by `buildBrandPersona`, niche-neutral from your `BrandConfig`). It never impersonates a specific named human; if a viewer asks whether it's a bot/AI, it answers honestly and warmly, and points anything personal to a qualified professional.

### 📅 Scheduling (per-weekday)
All scheduling runs in a configurable timezone (per brand; neutral default **UTC**). The auto-poster uses a **per-weekday** model: each weekday can be **"Use global"** (inherit the global schedule) or **"Custom"** (override it).

- **Per-day scheduling** — configure, **per weekday**, whether to post, how many Shorts, and at what times. Mondays can be 3 Shorts at `08:00 / 13:00 / 19:00` while weekends are off.
- **Per-day ON/OFF toggle** — each custom weekday row can be enabled/disabled independent of how many posts/times it carries.
- **`customScheduleOnly`** — when **ON**, days **without** a Custom entry generate **nothing** (the global fallback is disabled). Default **OFF**.
- **Global vs. per-day fallback** — the top-level **Publishing Days/Times** (`postTimes` + `postsPerDay`) are the **GLOBAL** fallback for any weekday on "Use global"; per-day entries override them.

### 📊 Analytics & notifications
- **Real-time analytics** — YouTube channel + per-video stats from the Data API (synced to the DB), surfaced on Overview + Analytics.
- **Daily health email** — digest via Resend/Nodemailer: system health (DB / AI / YouTube), today's YouTube posts, today's auto-generated posts, upcoming scheduled posts, 24h stats, failures, and rate-limit events.
- **Morning Digest** — an optional once-a-day summary email of the **last 24 hours** of your YouTube channel, sent at a time you choose (IST). In **Settings → Morning Digest** you flip a master switch and pick exactly what to include: 24h insights, new comments, published videos, subscribers, top performer, auto-engagement, today's schedule, failures, growth vs. prior day, system health, and AI usage. **System Health surfaces AI rate-limits / 429s**: if any provider was rate-limited in the last 24h, the AI-provider line is marked **degraded** (rate-limits are the usual cause of missed posts) and the actual rate-limit + error events from the window are listed under System Health. Built by `lib/morningDigest.ts` (each section best-effort), rendered by `sendMorningDigestEmail`, and polled from `instrumentation.ts` once per day at the configured hour.
- **Activity + live alerts** — every publish/reply/topic-use logged to `ActivityLog`; real-time alerts stream over SSE (`/api/notifications/stream`) and email (publish, fail, YouTube published/failed, comment replied).

### 🎨 Appearance (10 app-wide themes)
- **Selectable dashboard theme** — **Settings → Appearance** offers **10 brand-neutral palettes** — Crimson (default), Amethyst, Sapphire, Emerald, Sunset, Rosé, Cyber Teal, Gold, Indigo Night, Slate Mono. Themes are applied entirely through **CSS variables** (`lib/themes.ts` + `[data-theme="…"]` token blocks in `app/globals.css`, wired through Tailwind), swapped instantly by **next-themes** (`attribute="data-theme"`) and **persisted per device** — no rebuild, no code edit. A live accent preview shows each palette before you pick it.

### 📲 Installable PWA
- **Install the dashboard as an app** — the dashboard ships as an installable **Progressive Web App** (a brand-driven `app/manifest.ts` served at `/manifest.webmanifest` + a `public/sw.js` service worker), so it can be added to a desktop/home screen and launched **standalone** (own window, no browser chrome). The manifest **name / short name / icons** are brand-driven (from `NEXT_PUBLIC_APP_NAME` / `BRAND_NAME`) and niche-neutral, and the **"Powered by <app name>"** footer (`components/dashboard/Footer.tsx`) carries the same brand-driven identity.

---

## 🛠 How a Short Is Built (pipeline)

`publishPostToYouTubeShort()` → `buildShortForPost()` (`lib/youtubePublish.ts`) assembles every Short:

1. **Hook cover (~2s).** An AI-written curiosity-gap line on a bold themed card. Hooks are **audit-driven**: they win the first second (a surprising/concrete word up front, lead with a question or concrete everyday specific), are forced **concrete and specific**, and are held to a strict **anti-fabrication** rule — never invent or exaggerate a number or magnitude claim. Front-loaded fast because ~70–90% of viewers swipe in the first ~2 seconds. This image is also set as the **custom YouTube thumbnail**.
2. **Content slides.** `buildContentSlideSpecs()` splits the post's full content into one point per large-text slide. `CAROUSEL` posts render their authored slides; quiz types render setup/question/option slides and **never** reveal the answer.
3. **SUBSCRIBE outro** (`lib/hookCard.ts`).
4. **Render.** Cards are designed full-frame 9:16 (**1080×1920**) and rendered at **720×1280** H.264. They are rasterized with **Satori → SVG → Sharp** (NOT raw SVG) because the production container's librsvg rejects hand-written SVG; Satori output rasterizes reliably. The 720p render avoids ffmpeg stalling at `frame=0` on memory/CPU-constrained hosts.
5. **Stitch.** Cards → vertical MP4 via **ffmpeg-static** (`lib/videoGenerator.ts`), paced to a **selectable target length** — **Settings → YouTube → Short length** (`targetShortSeconds`): **15 / 20 / 30 / 45 / 60s** (default **30s**). `shortPlan()` (`lib/shortLength.ts`) distributes time toward the target while still adapting to the content (longer card text → longer hold), hard-capped at YouTube's ~3-min ceiling (180s); `secondsPerImage` is the per-content-slide minimum (hook ≈2s, outro ≈3s).
6. **Music.** Gemini vision reads the cover → mood → Jamendo CC instrumental mixed under the audio (faded) and credited in the description.
7. **Caption + tags.** `buildRichCaption()` (cached) + `buildYouTubeTagsAI()`.
8. **Upload** via `uploadShort()` (Data API v3) → **seed comment**.

> All steps degrade gracefully: no music key → silent Short; AI failure → fallback chain; render wedged → 120s watchdog SIGKILLs it and a single-flight queue prevents OOM.

---

## 👥 Multi-Account (Brands)

YouTubePilot controls **multiple YouTube "brand" channels**. A *brand* = one YouTube channel, **each with its own brand skin** (name, niche, persona, handle).

- **Primary brand** — seeded from environment variables. It always exists, resolves credentials from **ENV** (env wins; brand-row columns are only a fallback), and **cannot be deleted**. Its brand skin lives in the `Preferences` singleton.
- **Add more brands** — in **Settings → Accounts**, click **Add Account** and paste that channel's **YouTube** client ID · client secret · refresh token. Non-primary brands store their credentials **and brand skin** in their own `Brand` row (`lib/brands.ts`).
- **Per-brand everything** — each brand has its own brand skin, settings, AI prompts, schedule, topics, and post types (stored in `Brand.settings`; the primary uses the `Preferences` singleton). The engine runs the **full pipeline independently for every active brand** every cycle.
- **Brand switcher** — a header switcher (plus an **"All accounts"** aggregate) scopes every page to the selected brand.
- **Data isolation** — `Post` / `ScheduledPost` / `Comment` / `Analytics` rows carry a `brandId`. A `null` brandId = "the primary brand"; non-primary brands match by exact id, so content and analytics stay isolated.

---

## 🧱 Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | **Next.js 16** (App Router) + React 18, request gate in **`proxy.ts`** |
| Language | TypeScript 5 |
| Styling | Tailwind CSS + glassmorphism, Framer Motion, Radix UI, Recharts |
| Content AI | Per-task fallback **chains** across **Grok** (Groq Llama-3.3-70B), **Cerebras** (`gpt-oss-120b`) & **Google Gemini** (configured in Settings → AI) |
| Reply AI | **Groq** — Llama-3.3-70B (YouTube comment replies), Llama-3.1-8B (fast fallback) |
| Vision | Gemini multimodal (captions + music-mood selection) |
| Image rendering | **Satori + Sharp** (server-side cards) |
| Video / Shorts | **ffmpeg-static** (cards → 720×1280 MP4) |
| Music | **Jamendo** API (Creative-Commons instrumentals) |
| YouTube | YouTube Data API v3 via **googleapis** (OAuth2 refresh token) |
| Media hosting | Cloudinary (images + audio) |
| Database | **PostgreSQL + Prisma ORM** |
| Data fetching | TanStack Query v5 |
| Email | **Resend** / Nodemailer |
| Deployment | **Railway** (Nixpacks) or **Docker** (Compose) |
| Automation engine | In-process catch-up loop (`lib/catchup.ts`, per-brand) + daily timer |
| PWA | Installable app — brand-driven `app/manifest.ts` (`/manifest.webmanifest`) + `public/sw.js` service worker (standalone display) |

---

## 🏗 Architecture

A single in-process loop (`lib/catchup.ts`) drives everything. It is started by `instrumentation.ts` on server boot (after a ~15s delay) and re-fired on an interval (`MIN_INTERVAL_MS`, 5 min), plus a separate daily timer. Dashboard polling (`/api/scheduler/check`) can also nudge it.

Each cycle, `runCatchup()` lists all brands and runs the **full pipeline independently for every *active* brand** (primary first). With only the primary brand present this is a single iteration whose credentials resolve from ENV.

```
runCatchup()  (every MIN_INTERVAL_MS ≈ 5 min)
 └─ for each ACTIVE brand (own YouTube credentials + own preferences + own brand skin):
     ├─ runAutoGenerateYouTube()    → generate today's Shorts (own per-day count/times/days/types/topics)
     ├─ publishOverdueScheduled()   → publish due Shorts via publishPostToYouTubeShort()
     └─ replyToYouTubeComments()    → Grok replies on the channel's recent Shorts/videos
                                      (skips the channel's OWN comments — never replies to itself)

Daily timer  (runDailyHealthCheck):
 ├─ runAutoGenerateYouTube()        → also kicked here
 └─ sendDailyHealthReport()         → morning digest (DB / AI / YouTube health,
                                      today's YouTube posts + auto-posts, 24h stats, failures)
```

> The auto-generators self-gate per brand (date guard + DB de-dupe + in-flight guard + `postsPerDay` cap), so being called every cycle never double-generates.

### Publishing path
Both `Post` and `ScheduledPost` carry a `platform` column (default `"youtube"`).

| Path | Entry point | Behavior |
|------|-------------|----------|
| **Manual** | `POST /api/posts/[id]/publish` | render → Short → upload via Data API v3. |
| **Scheduler / catchup** | `publishOverdueScheduled()` | reads each overdue post and publishes via `publishPostToYouTubeShort()`. |
| **Media folder** | `POST /api/media/[id]/publish-youtube` | publishes the **actual uploaded file** (video → direct upload; image → rendered Short). |

**Large-media direct upload.** In the Media library, large files (100 MB+ videos) upload **straight to Cloudinary from the browser** — the page fetches an unsigned upload config from `GET /api/upload`, uploads the file directly, then `POST`s only the resulting URL + metadata as small JSON. This bypasses the server's multipart body limit, so big videos no longer fail with *"Failed to parse body as FormData."* Small files (or setups without Cloudinary configured) automatically fall back to the legacy multipart server path.

### Idempotency & self-healing
- **`youtubeVideoId`** is stored on both `ScheduledPost` and `Post`; every YouTube path re-reads the freshest value before uploading, so retries never double-post. **The id-persist write after a successful upload is itself retried** (`persistWithRetry`, 3 attempts w/ backoff) — a transient DB blip right after a Short uploads can no longer lose the id and trigger a re-upload on the next tick.
- **Claim lock** — `publishOverdueScheduled` and the manual route atomically flip a `PENDING` `ScheduledPost` to `FAILED("__CLAIMING__")`; only the caller that gets `count===1` proceeds. A **reaper** resets `__CLAIMING__` rows back to `PENDING`. The claim string **embeds a timestamp**, and the reaper resets stale claims by that **embedded claim time** (older than **45 min** — sized to exceed the worst-case legitimate render+upload so an *active* claim is never reaped mid-publish), not the row's `createdAt` — which stops duplicate uploads.
- **Single-run catch-up** — a module-level in-flight guard makes `runCatchup()` **non-re-entrant**: if a cycle runs longer than the 5-min interval, the next tick early-returns instead of overlapping it, so publishing and story creation can't double-fire.
- **Render lock (OOM guard)** — a process-wide **single-flight queue wraps the ENTIRE memory-heavy Short build** (card render + music + ffmpeg), so only one render is ever in memory at a time, even across concurrent brands/cycles. Every remote media fetch inside the lock carries a **60 s `AbortSignal` timeout** so a hung media URL can't deadlock the whole publish queue.
- **ffmpeg safety** — a 120s watchdog SIGKILLs wedged renders; the render lock above ensures only one pipeline runs at a time.
- **Black-frame render guard** — before stitching, every card frame is variance-checked (`isBlankFrame`, `lib/videoGenerator.ts`); if a transient Satori→Sharp rasterization glitch made **every** frame blank/all-black, the render **aborts (returns `null`)** rather than shipping a dead black Short — the publish path treats that as a failure and **retries** with a proper render on the next tick.
- **Generation-failure alert email** — when a whole generation cycle produces **no Short** because every provider in the AI chain failed (typically a 429 / daily token cap), `notifyGenerationFailed` (`lib/notifier.ts`) sends an alert email so a silently unproductive day is visible; the scheduler keeps retrying.
- **JSON-resilient AI** — content-JSON generation tries the selected provider then **falls through to the other on empty output or quota exhaustion** (429 / `limit:0`), so Shorts never silently degrade to canned filler when a provider's free quota runs out.
- **Passed slots publish today** — when the auto-generator runs and a Short's slot time has **already passed for today**, it's scheduled for **now (today)** rather than pushed to tomorrow — fixing over-generation and the "N Shorts at one time" same-time collision.
- **AI fallback chains** everywhere; graceful degradation (silent Shorts, default mood, branded fallback replies, and the silent music-only fallback when voiceover TTS fails).

---

## ⚙️ Settings Reference

Settings persist per brand (`lib/preferences.ts`): the **Primary** brand uses the `Preferences` singleton row (id `"singleton"`); every other brand stores the same shape in its `Brand.settings`. They survive restarts. Every field below is wired into the automation, **per brand**.

### AI Setup (`Settings → AI Setup`)
Describe your channel and let Groq configure it end to end — it asks tailored questions, then generates and previews the whole config (brand, content types, topics, schedule, persona, channel handle + name, default prompt) for you to **Apply** (brand-scoped) or **Regenerate**. A **Manual** toggle links straight to the hand-driven Brand / Content Types / YouTube tabs. Backed by `POST /api/ai/setup`.

### Brand (`Settings → Brand`)
| Field | Controls |
|-------|----------|
| `appName` | The product/app name shown in the UI |
| `niche` | Your topic/niche — injected into every AI generation |
| `persona` / voice | The AI's persona/voice for content + replies |
| `ytHandle` / `ytChannelName` | YouTube `@handle` + channel name used in CTAs/outros |
| `followCTA` | The "follow us" CTA text/links |

### Content Types (`Settings → Content Types`)
Rename the **user-facing label** of each content slot (the internal ID is preserved so data never breaks), toggle them on/off, and set a per-type prompt. Labels flow into the generator, cards, and captions. See [Content Types](#-content-types).

### AI (`Settings → AI`)
| Field | Controls |
|-------|----------|
| `contentChain` | **Content lane** — ordered `provider · model` fallback chain for scripts/captions/hooks (providers: `grok` \| `cerebras` \| `gemini`) |
| `replyChain` | **Reply lane** — ordered fallback chain for YouTube comment auto-replies |
| `visionChain` | **Vision lane** — ordered fallback chain for cover-card analysis (**`gemini`/`groq` only**) |
| `cerebrasApiKey` | Cerebras key stored in DB (env `CEREBRAS_API_KEY` takes priority) |
| `geminiApiKey` | Gemini key stored in DB (env `GEMINI_API_KEY` takes priority) |
| `defaultTone` | Default content tone |
| `defaultType` | Default post type in the generator |
| `language` | Output language |
| `aiProvider` | *(legacy)* single content provider — retained for back-compat; superseded by `contentChain` |

### YouTube (`Settings → YouTube`)
| Setting | What it does |
|---------|--------------|
| `enabled` | Master switch for the **YouTube auto-poster + Grok comment replies** |
| `privacy` | Uploaded Short privacy: `public` \| `unlisted` \| `private` |
| `postsPerDay` | YouTube auto-posts/day (1–5) — **GLOBAL** fallback for any day on "Use global" |
| `postTimes[]` | **GLOBAL** Short publish times (`HH:MM`); fallback for any day on "Use global" |
| `scheduleDays[]` | **GLOBAL** days the poster runs (0=Sun … 6=Sat); fallback for any day on "Use global" |
| `dailySchedule[]` | **Per-day overrides** — per weekday → ON/OFF · how many posts · at what times. Overrides the global `postsPerDay`/`postTimes`; days on "Use global" fall back to them. |
| `customScheduleOnly` | When **ON**, only weekdays with a Custom entry post — others generate **nothing**. Default **OFF**. |
| `targetShortSeconds` | **Short length** — target Short duration: `15` \| `20` \| `30` \| `45` \| `60`s (default **30**). Paces the cards toward this target while still adapting to the content; hard-capped at 180s. |
| `secondsPerImage` | Seconds each content slide shows (2–15, default 5; hook ≈2s, outro ≈3s) — the per-card **minimum**; `targetShortSeconds` sets the overall target |
| `voiceover` | **Opt-in (default OFF).** Narrate each Short with an AI voice, mixed over auto-ducked music; cards re-time to span the narration. Any TTS failure falls back to the silent music-only Short. |
| `voiceoverVoice` | Orpheus voice for the narration — male `daniel` (default), `austin`, `troy`; female `autumn`, `diana`, `hannah` |
| `burnCaptions` | **Opt-in (default OFF).** **OFF** → no hardcoded captions, so YouTube auto-generates + auto-translates captions per viewer. **ON** → burns TikTok-style word-by-word captions (Groq Whisper timestamps → ASS → re-encode). |
| `descriptionSuffix` | Appended to every YouTube description (e.g. channel CTA) |
| `replyToComments` | Grok auto-replies to comments on the channel's videos, skipping its own (default on) |
| `topics[]` | Topics the YouTube poster writes about |
| `postTypes[]` | Post types the YouTube poster may publish |
| `customPromptExtra` | Extra prompt instructions appended for YouTube generation |

Live connection status (Connected / channel name) is returned by `GET /api/settings/youtube` via `checkYouTubeHealth()`.

### Notifications (`Settings → Notifications`)
| Field | Controls |
|-------|----------|
| `notificationEmail` | Recipient for digests/alerts (falls back to `NOTIFICATION_EMAIL` env) |
| `emailPublish` / `emailFails` / `emailAnalytics` | Email on publish / failure / daily digest |
| `pushPublish` / `pushComments` / `pushWeeklyReport` | In-app/push notification toggles |

Other tabs: **Accounts** (add/edit/enable/delete brands), **Appearance** (pick one of 10 app-wide themes; per-device), **Prompts** (per-post-type system-prompt overrides + per-account default content prompts), **Account / Danger** (login key, destructive actions). The Brand, Content Types, AI, YouTube, and Prompts tabs are scoped to the brand selected in the header switcher.

---

## 🚀 Setup / Installation

### Prerequisites
- **Node.js 20+** and **PostgreSQL** (or just Docker, which bundles Postgres).
- Accounts/keys for **Groq, Gemini, Cloudinary, Resend, YouTube** (and optional **Jamendo**). **All keys are your own — none are bundled.**

### Local development
```bash
npm install
cp .env.example .env.local        # fill in the variables below
npm run db:generate && npm run db:push
npm run dev                        # http://localhost:3000
```
Then log in with your `APP_ACCESS_KEY` and open **Settings → Brand** (or **Settings → AI Setup** to have the AI configure the channel for you).

> **Windows one-click:** run **`start-all.bat`** — it checks Docker, brings up the Postgres container, generates the Prisma client, syncs the schema (no destructive `--accept-data-loss`), starts the dev server, and opens the dashboard.

### NPM scripts
```bash
npm run dev           # dev server (Turbo, port 3000)
npm run build         # prisma generate && next build (standalone output)
npm run start         # production server
npm run lint          # ESLint
npm run db:push       # push Prisma schema to the database
npm run db:generate   # regenerate Prisma client
npm run db:studio     # Prisma Studio GUI
npm run youtube:auth  # one-command YouTube OAuth → prints YOUTUBE_REFRESH_TOKEN
```

### Environment variables
✅ = required, – = optional.

| Variable | Req | Description |
|----------|-----|-------------|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `APP_ACCESS_KEY` | ✅ | Access key gating the dashboard login |
| `SESSION_SECRET` | ✅ | HMAC secret for the auth session cookie (verified in `proxy.ts`) |
| `BRAND_NAME` | – | Default app/brand name fallback (also overridable in Settings → Brand) |
| `NEXT_PUBLIC_APP_NAME` | – | Public app name shown in the browser/title |
| `NEXT_PUBLIC_APP_URL` | – | Public app URL |
| `GROK_API_KEY` | ✅ | Groq key — content (tried first) + comment replies |
| `GROK_API_URL` | – | Default `https://api.groq.com/openai/v1` |
| `AI_MODEL_MAIN` | – | Main Groq model (`llama-3.3-70b-versatile`) |
| `AI_MODEL_FAST` | – | Fast Groq fallback (`llama-3.1-8b-instant`) |
| `GEMINI_API_KEY` | ✅ | Gemini key — content fallback, vision, music mood |
| `GEMINI_MODEL` | – | Optional override pinning the start of the Gemini chain |
| `CEREBRAS_API_KEY` | – | Cerebras key for the per-task AI Config chains (can also be set in Settings → AI) |
| `TTS_PROVIDER` | – | Voiceover TTS provider: `groq` (default) \| `canopy`. Auto-falls back to the other, then Gemini TTS |
| `GROQ_TTS_MODEL` | – | Override the Groq Orpheus TTS model (default `canopylabs/orpheus-v1-english`) |
| `GROQ_TTS_VOICE` | – | Default Groq Orpheus voice when none is selected in Settings |
| `CANOPY_TTS_URL` | – | Self-hosted Canopy TTS endpoint URL (used when `TTS_PROVIDER=canopy`) |
| `CANOPY_TTS_KEY` | – | API key for the self-hosted Canopy TTS endpoint |
| `CANOPY_TTS_VOICE` | – | Default voice for the self-hosted Canopy TTS endpoint |
| `CLOUDINARY_CLOUD_NAME` | ✅ | Media hosting (images + audio) |
| `CLOUDINARY_UPLOAD_PRESET` | ✅ | Unsigned upload preset |
| `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` | – | For deleting media after publish |
| `RESEND_API_KEY` | ✅ | Daily report + alert emails |
| `RESEND_FROM` | – | From address for Resend |
| `NOTIFICATION_EMAIL` | ✅ | Default report recipient |
| `YOUTUBE_CLIENT_ID` | ✅ | OAuth client ID |
| `YOUTUBE_CLIENT_SECRET` | ✅ | OAuth client secret |
| `YOUTUBE_REFRESH_TOKEN` | ✅ | Long-lived channel refresh token (upload + readonly + force-ssl + yt-analytics) |
| `YOUTUBE_CHANNEL_ID` | – | Channel ID — display only |
| `JAMENDO_CLIENT_ID` | – | Free Jamendo client ID — enables vision-selected background music |
| `FFMPEG_PATH` | – | Override path to an ffmpeg binary (fallback if `ffmpeg-static` is missing) |

> `isYouTubeConfigured()` is true only when `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, and `YOUTUBE_REFRESH_TOKEN` are all set. Without all three, every YouTube path silently no-ops. Without `JAMENDO_CLIENT_ID`, Shorts render silently (no music).

---

## 🔑 Getting Your API Keys

| Service | Where | Notes |
|---------|-------|-------|
| **Groq** (`GROK_API_KEY`) | [console.groq.com](https://console.groq.com) → API Keys | Free tier is generous; powers content + replies. |
| **Gemini** (`GEMINI_API_KEY`) | [aistudio.google.com](https://aistudio.google.com/app/apikey) → Get API key | Used for vision (music mood) + content fallback. |
| **Cerebras** (`CEREBRAS_API_KEY`) | [cloud.cerebras.ai](https://cloud.cerebras.ai) → API Keys | Optional; fast `gpt-oss-120b` for content/reply lanes. |
| **Cloudinary** (`CLOUDINARY_*`) | [cloudinary.com](https://cloudinary.com) → Dashboard | Create an **unsigned upload preset** for `CLOUDINARY_UPLOAD_PRESET`. |
| **Resend** (`RESEND_API_KEY`) | [resend.com/api-keys](https://resend.com/api-keys) | For the daily report + alert emails. `RESEND_FROM` defaults to `onboarding@resend.dev`. |
| **YouTube** (`YOUTUBE_*`) | Google Cloud Console + the helper script below | One-time OAuth — see below. |
| **Jamendo** (`JAMENDO_CLIENT_ID`) | [devportal.jamendo.com](https://devportal.jamendo.com) | Optional; enables background music. Omit → silent Shorts. |
| **Postgres** (`DATABASE_URL`) | Local, Docker Compose, Railway, Neon, Supabase, … | Any standard PostgreSQL connection string. |

### Enabling YouTube (one-time OAuth)
YouTubePilot authenticates with a long-lived **refresh token** (no interactive login at runtime).

1. **Enable the API** — Google Cloud Console → APIs & Services → Library → "YouTube Data API v3" → **Enable**.
2. **OAuth consent screen** → User type **External** → publishing status **In production** (NOT Testing — Testing-status refresh tokens expire in 7 days).
3. **Credentials → Create OAuth client ID → Desktop app** → copy the Client ID + Secret.
4. **Mint the refresh token** from the project root:
   ```bash
   YOUTUBE_CLIENT_ID=xxx YOUTUBE_CLIENT_SECRET=yyy npm run youtube:auth
   # or: node scripts/youtube-auth.mjs --id xxx --secret yyy
   ```
   It opens the consent screen, catches the localhost redirect automatically, and prints `YOUTUBE_REFRESH_TOKEN`. Authorize with the Google account that **owns the channel**. Scopes: `youtube.upload`, `youtube.readonly`, `youtube.force-ssl`, `yt-analytics.readonly`.
5. Set `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REFRESH_TOKEN` (and optionally `YOUTUBE_CHANNEL_ID`).
6. Open **Settings → YouTube**, confirm **"Connected"**, configure topics/times/days, and **Save**.

---

## ✅ First-Run Checklist

1. [ ] `cp .env.example .env` (Docker) or `.env.local` (Node) and fill **required** keys.
2. [ ] Bring up a database (`docker compose up -d postgres` or your own) and run `npm run db:push`.
3. [ ] Start the app (`docker compose up -d --build` or `npm run dev`).
4. [ ] Open `http://localhost:3000`, log in with `APP_ACCESS_KEY`.
5. [ ] **Settings → Brand** — set app name, niche, persona, YouTube handle + channel name.
6. [ ] **Settings → AI** — pick provider, tone, language.
7. [ ] **Settings → Content Types** — rename/toggle the slots for your niche.
8. [ ] **Settings → YouTube** — confirm "Connected", add topics, set schedule, enable comment replies.
9. [ ] **Settings → Notifications** — set your report email.
10. [ ] Use the **Generator** to create one Short manually and publish it to confirm the full pipeline works end-to-end.
11. [ ] Leave it running — the auto-poster takes over on your schedule.

---

## ☁️ Deployment

### Option A — Railway (Nixpacks)
```bash
railway up --detach          # build + deploy
railway logs --tail 40       # live logs
railway status               # confirm "Online", not "Deploy failed"
railway variables --kv       # list env vars
```
- **Build:** `prisma generate && next build`. Push schema changes with `npm run db:push`.
- **Fonts + ffmpeg:** `nixpacks.toml` installs the fonts the Satori renderer needs and ensures ffmpeg is available (also bundled via `ffmpeg-static`). If the bundled binary doesn't survive a build, install a system ffmpeg (`NIXPACKS_PKGS=ffmpeg`) and/or set `FFMPEG_PATH`.
- **Database URL note:** use Railway's **`DATABASE_PUBLIC_URL`** when migrating from outside Railway's private network (e.g. local `db:push` against the hosted DB); the in-cluster app uses the private `DATABASE_URL`.
- **Healthcheck:** `/api/health` (public for uptime probes) reports DB / AI / YouTube status.
- **Typecheck before every deploy** (Railway keeps the old build running if the new one fails to compile):
  ```bash
  node_modules/.bin/tsc --noEmit
  ```

### Option B — Docker / Docker Compose (self-host anywhere)
```bash
cp .env.example .env
docker compose up -d --build     # app + PostgreSQL (+ optional Redis)
docker compose logs -f app
```
The bundled `Dockerfile` builds a **standalone** Next.js image (`output: 'standalone'`); `docker-compose.yml` provisions PostgreSQL and wires `DATABASE_URL` automatically. Set your keys in `.env` first. `docker-entrypoint.sh` runs `prisma db push` then `node server.js` on boot.

### Packaging a shippable zip
```powershell
powershell -ExecutionPolicy Bypass -File .\package-zip.ps1
```
Produces `youtubepilot-ai.zip` excluding `node_modules`, `.next`, caches, and **all `.env*` files** — with a safety abort if any env file would slip in. The recipient unzips, adds their own keys, and runs.

---

## 💰 Cost & Quota Planning

- **YouTube Data API** — free quota is **10,000 units/day**. `videos.insert` ≈ **1,600 units** each, so the practical ceiling is **~6 uploads/day** before you must request a quota increase. Reads (analytics, comments) are cheap by comparison. Plan `postsPerDay` accordingly across all brands.
- **Groq / Gemini** — content generation + replies are a few calls per Short; both have usable free tiers. The Grok-first/Gemini-fallback design keeps a single provider outage from stopping production.
- **Cloudinary** — stores rendered cards/audio; free tier is ample for moderate volume. `CLOUDINARY_API_KEY/SECRET` let the app delete media after publish to stay under limits.
- **Jamendo / Resend** — free tiers cover typical use; both are optional-to-light.

> Rule of thumb: with one channel at 2–3 Shorts/day you stay comfortably inside every free tier. Scale brands × posts-per-day against the **10k/day YouTube quota** first — it's the binding constraint.

---

## 📂 Project Structure

```
youtubepilot-ai/
├── app/
│   ├── (dashboard)/
│   │   ├── overview/          # Home: health, YouTube stats, AI chat
│   │   ├── generator/         # Manual AI generator
│   │   ├── scheduler/         # Calendar / schedule posts
│   │   ├── analytics/         # YouTube analytics + comments
│   │   ├── content-library/   # All posts: preview, schedule, publish, delete
│   │   ├── media/             # Upload media → AI caption → publish as a Short
│   │   ├── activity/          # Activity feed
│   │   └── settings/          # Accounts · Brand · Content Types · AI · YouTube · Prompts · Notifications · Account · Danger
│   ├── login/                 # Access-key login
│   └── api/
│       ├── brands/{,[id]}/                 # Multi-account: list/add brand, edit/enable/delete
│       ├── youtube/{overview,videos,comments}/   # YouTube stats + per-video + comments
│       ├── ai/{generate,chat,hashtags}/    # generator + chat + tag/hashtag endpoint
│       ├── posts/{,[id],[id]/publish}/     # post CRUD + publish a post as a Short
│       ├── media/[id]/publish-youtube/     # publish real uploaded media as a Short
│       ├── scheduler/{,[id],check,failed}/
│       ├── analytics/{overview,sync}/      # YouTube analytics overview + ingestion
│       ├── settings/{account,brand,ai,prompts,notifications,youtube,danger}/
│       ├── catchup/ , auto-generate/ , upload/ , content-library/ , startup/ , test-email/
│       └── health/ , notifications/{count,stream}/ , auth/{login,logout}/
│
├── lib/
│   ├── brandConfig.ts         # ★ White-label brand skin: BrandConfig, getBrand, persona/handle/typeLabel builders
│   ├── catchup.ts             # ★ Automation engine: runCatchup (per-brand loop),
│   │                          #   publishOverdueScheduled, runAutoGenerateYouTube,
│   │                          #   replyToYouTubeComments, claim lock + reaper
│   ├── brands.ts              # Multi-account: brand CRUD + per-brand credential resolution (ENV-first for primary)
│   ├── youtube.ts             # YouTube Data API v3 client (upload/stats/comments/health, per-brand creds)
│   ├── youtubePublish.ts      # Post → carousel Short MP4 (hook cover + content slides + outro, themes,
│   │                          #   music, AI tags, seed comment); buildRichCaption + YT search-tag builders
│   ├── hookCard.ts            # Hook cover + SUBSCRIBE outro cards + THEMES (satori → SVG → sharp, container-safe)
│   ├── videoGenerator.ts      # Cards → 720×1280 MP4 (ffmpeg-static, watchdog, serialized single-flight)
│   ├── music.ts               # Vision mood → Jamendo CC instrumental + attribution
│   ├── richCaption.ts         # Unified rich caption (cached) + follow links
│   ├── grok.ts / gemini.ts / ai-factory.ts        # AI clients + per-task chain resolution (content/reply/vision)
│   ├── aiModels.ts            # ★ Provider/model catalogs + per-task fallback chains (Grok/Cerebras/Gemini)
│   ├── shortLength.ts         # Selectable Short length (15/20/30/45/60s) → shortPlan pacing
│   ├── themes.ts              # ★ 10 app-wide themes (Settings → Appearance, CSS-variable driven)
│   ├── postTypeImageGenerator.ts / slideImageGenerator.ts  # Satori card renderers
│   ├── imageGenerator.ts      # Cloudinary upload + carousel image pipeline
│   ├── captionBuilder.ts      # Structured captions + applyBrand (handle resolution)
│   ├── notifier.ts            # Emails + SSE: daily report, publish/fail, YouTube events
│   ├── preferences.ts         # Per-brand settings + brand skin (primary→Preferences singleton, others→Brand.settings)
│   └── prisma.ts / auth.ts / session.ts / utils.ts
│
├── prisma/schema.prisma       # Brand, Post, ScheduledPost (platform + youtubeVideoId + brandId),
│                              #   Analytics, AccountAnalytics, Comment, ActivityLog, Preferences (+ brand skin), User, …
├── scripts/youtube-auth.mjs   # One-command OAuth loopback → prints YOUTUBE_REFRESH_TOKEN
├── proxy.ts                   # Auth gate (session cookie) for pages AND /api routes (Next 16 middleware)
├── instrumentation.ts         # Starts the catch-up loop + daily timer on boot
├── Dockerfile / docker-compose.yml / docker-entrypoint.sh   # Container build + Postgres
├── nixpacks.toml              # Railway build: fonts + ffmpeg
├── package-zip.ps1            # Build a clean, secret-free distributable zip
├── components/                # Dashboard UI (cards, charts, dialogs, forms; incl. BrandSwitcher + useSelectedBrand)
└── README.md
```

> **Note (Next.js 16):** the request gate lives in **`proxy.ts`** (Next 16's renamed middleware). If a deploy fails on the gate, confirm this file's name/export matches what your Next version expects.

---

## 🩺 Troubleshooting / FAQ

**"Settings → YouTube shows Not Connected."**
Your `YOUTUBE_CLIENT_ID/SECRET/REFRESH_TOKEN` aren't all set or the token was minted under a **Testing** consent screen (those expire in 7 days). Re-run `npm run youtube:auth` with the consent screen **In production**.

**Nothing publishes automatically.**
Check: (1) **Settings → YouTube → `enabled`** is ON; (2) today is a publishing day and the time has passed; (3) `customScheduleOnly` isn't ON for a day with no Custom entry; (4) you haven't hit the **10k/day** YouTube quota (~6 uploads). The engine ticks every ~5 min — give it a cycle. Watch server logs for `[Catchup]` lines.

**Shorts render without sound.**
`JAMENDO_CLIENT_ID` is unset or the track fetch failed — by design the Short still ships **silently**. Set the key to enable music.

**Render stalls / blank cards on a server.**
Ensure fonts + ffmpeg are present (Railway: `nixpacks.toml`; Docker: handled in the image). Cards rasterize via Satori→SVG→Sharp specifically because bare containers' librsvg rejects hand-written SVG. Set `FFMPEG_PATH` if `ffmpeg-static` didn't survive the build.

**The AI writes off-topic or off-voice content.**
Tighten **Settings → Brand** (niche + persona) and **Settings → Prompts** (per-type prompts). Both are injected into every generation.

**Comment replies aren't appearing.**
**Settings → YouTube → `replyToComments`** must be ON, and the OAuth scope must include `youtube.force-ssl`. The bot deliberately skips its own channel's comments.

**Can I run more than one channel?**
Yes — **Settings → Accounts → Add Account** with that channel's YouTube credentials. Each brand runs independently with its own skin, schedule, and topics.

**Where did Instagram go?**
This is the **YouTube-only** edition — all Instagram/Meta functionality has been removed. (A separate dual-platform build exists elsewhere.)

---

## 🔒 Security

- **Access-key login.** The dashboard is gated by `APP_ACCESS_KEY`. `POST /api/auth/login` validates the key and sets a signed session cookie (signed/verified with `SESSION_SECRET`).
- **Session gate on everything** (`proxy.ts`). Every page **and every `/api` route** is checked against the session cookie. Unauthenticated page requests redirect to `/login`; unauthenticated API requests get `401 JSON`.
- **Login brute-force protection.** The access-key login uses a constant-time compare **plus** a per-IP rate limiter (≈8 failed attempts / 10 min → `429`), so the shared `APP_ACCESS_KEY` can't be guessed at speed.
- **Same-site guard on side-effecting GETs.** `/api/scheduler/check` (which can trigger a publish) requires a same-origin `Sec-Fetch-Site`/`Origin`, so a cross-site request with a live cookie can't nudge publishing.
- **SSRF guard on media URLs.** User-supplied `mediaUrl`s the server later fetches at publish time are validated against a host allowlist (Cloudinary / catbox / the app's own host) and reject non-http(s) schemes plus private, link-local, and loopback addresses (`lib/urlSafety.ts`) — a rejected URL returns `400` at the upload ingress.
- **YouTube-only, no Meta surface.** No Instagram/Facebook webhook, cross-post, or token path is reachable — nothing to spoof or leak from that side.
- **Public allowlist only:** `/login`, `/api/auth/login`, `/api/health` (uptime probes), plus static asset paths (`/_next`, `/favicon`, `/fonts`, `/images`).
- **Security headers** (`X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`) on every response.
- **No bundled secrets.** Ship the zip safely — every credential is supplied by the operator via env/Settings; nothing is hard-coded.

---

## 📄 License

Provided for use by the licensed operator. Configure your own brand in **Settings → Brand** and supply your own API keys. All third-party API usage (Groq, Google/YouTube, Cloudinary, Jamendo, Resend) is subject to those providers' terms.
