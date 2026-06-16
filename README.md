<div align="center">

# 🚀 YouTubePilot AI

### Put your YouTube Shorts channel on **autopilot** — for *any* niche

<p>
  <img alt="Next.js 16" src="https://img.shields.io/badge/Next.js-16-000000?style=for-the-badge&logo=nextdotjs&logoColor=white" />
  <img alt="React 18" src="https://img.shields.io/badge/React-18-20232A?style=for-the-badge&logo=react&logoColor=61DAFB" />
  <img alt="TypeScript 5" src="https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=white" />
  <img alt="PostgreSQL + Prisma" src="https://img.shields.io/badge/Postgres-Prisma-2D3748?style=for-the-badge&logo=prisma&logoColor=white" />
  <img alt="Grok + Gemini" src="https://img.shields.io/badge/AI-Grok%20%2B%20Gemini-7C3AED?style=for-the-badge&logo=google&logoColor=white" />
  <img alt="YouTube Data API v3" src="https://img.shields.io/badge/YouTube-Data%20API%20v3-FF0000?style=for-the-badge&logo=youtube&logoColor=white" />
</p>

<a href="https://railway.com/new"><img src="https://railway.com/button.svg" alt="Deploy on Railway" height="44" /></a>

**Idea → script → video → upload → engage — fully unattended.**
One AI worker that runs a faceless YouTube Shorts channel while you sleep.

</div>

---

## 💡 The idea

Growing a YouTube Shorts channel is a daily grind: come up with an idea, write a script, design the visuals, render a vertical video, pick music, write a title and tags, upload at the right time, then reply to every comment. Every single day. Forever.

**YouTubePilot AI does all of it for you** — on a schedule you set, in a niche and voice you choose, on a channel that's 100% yours. No editor, no designer, no social media manager. Just a dashboard and a channel that keeps growing.

> Think of it as hiring a tireless content team — writer, designer, video editor, and community manager — and compressing them into one app you fully control.

---

## ✨ Why it's different

- **🎨 Truly white-label, zero code.** App name, niche, persona, channel handle, content-type labels — all set from the **Settings UI**. Re-skin the entire product for cooking, fitness, finance, history, anything, in minutes.
- **🧠 Two AI brains, never stalls.** Grok *and* Gemini with automatic fallback chains, so a single provider outage never stops your content.
- **🎬 Real videos, not slideshows.** Every Short is a themed multi-slide carousel — hook cover → punchy content slides → subscribe outro — stitched with **ffmpeg** and scored with mood-matched royalty-free music.
- **🤖 It engages, not just posts.** Auto-replies to viewer comments in your voice, and is smart enough to never reply to itself.
- **🏢 Run a whole network.** Manage many channels from one dashboard, each with its own brand, schedule, and topics — all running independently.
- **🔑 Your keys, your data, your channel.** Bring your own API keys. Self-host on Railway or Docker. Nothing is locked in.

---

## 🎬 What happens every day — automatically

For each channel you've connected, on the schedule you set:

1. **🧪 Invents the topic** — pulls from your rotating list, and when it runs dry, the AI generates fresh same-style ideas so you never repeat.
2. **✍️ Writes the script** — a scroll-stopping hook, the body points, and a CTA, in your niche and your voice.
3. **🎨 Designs the cards** — a curiosity **hook cover** → large-text **content slides** → a **SUBSCRIBE outro**, each Short in its own color theme.
4. **🎞️ Renders the video** — vertical 9:16 MP4 via ffmpeg, with a mood-matched **Jamendo** track mixed underneath.
5. **🏷️ Writes the metadata** — a rich description, AI-generated **YouTube search tags**, and a custom thumbnail from the hook.
6. **📤 Publishes & seeds** — uploads via the YouTube Data API at your chosen time, then posts an engagement-bait first comment to kick-start velocity.
7. **💬 Replies to viewers** — reads new comments and answers them with AI — never replying to its own channel.
8. **📊 Reports back** — syncs channel + per-video analytics and emails you a daily health digest.

You mostly just watch the dashboard.

---

## 🛠 How a Short is born

```
  IDEA ──▶ SCRIPT ──▶ CARDS ──▶ VIDEO ──▶ METADATA ──▶ UPLOAD ──▶ ENGAGE
  (AI)     (AI)       (Satori    (ffmpeg   (AI tags +    (Data      (AI
           topic +    + Sharp)   + music)  thumbnail)    API v3)    replies)
           hook
  ┌───────────────────────────────────────────────────────────────────────┐
  │  🎬 Hook cover (~2s)  →  📝 Content slides (one point each)  →  🔔 Outro │
  │  one cohesive color theme per Short · ≈ 45–58s · vertical 720×1280 H.264 │
  └───────────────────────────────────────────────────────────────────────┘
```

Cards are rendered server-side with **Satori → SVG → Sharp** (rock-solid in any container), stitched into a vertical MP4 by a hardened ffmpeg pipeline with a watchdog and single-flight queue so a wedged render can never hang the system. Every step degrades gracefully — no music key? silent Short. AI hiccup? fallback chain. The show always goes on.

---

## 🧠 Architecture at a glance

A single, self-healing automation loop drives everything — no external cron, no queue infra, no babysitting.

```
  ┌─────────────────────────── In-process engine (every ~5 min) ───────────────────────────┐
  │                                                                                          │
  │   runCatchup()  ──▶  for each ACTIVE channel (own credentials · own brand · own plan):   │
  │                        ├─ 🧪 generate today's Shorts   (self-gated, never double-posts)  │
  │                        ├─ 📤 publish anything due       (atomic claim-lock + reaper)      │
  │                        └─ 💬 reply to new comments      (dedup + never-reply-to-self)     │
  │                                                                                          │
  │   Daily timer  ──▶  generate + email a full health digest (DB · AI · YouTube · 24h stats) │
  └──────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Multi-tenant by design** — every channel runs the full pipeline independently, with isolated data (`brandId` on every row).
- **Idempotent & self-healing** — atomic claim-locks prevent double-posting, a reaper recovers stuck jobs, and AI fallback chains keep content flowing.
- **Bring-your-own-keys** — Grok, Gemini, Cloudinary, Resend, YouTube, and (optional) Jamendo — all yours.

---

## 🧰 Built with

| | |
|---|---|
| **Framework** | Next.js 16 (App Router) · React 18 · TypeScript |
| **AI** | Grok (Groq Llama-3.3-70B) + Google Gemini, with fallback chains |
| **Media** | Satori + Sharp (cards) · ffmpeg (video) · Jamendo (music) · Cloudinary (hosting) |
| **Platform** | YouTube Data API v3 (googleapis, OAuth2 refresh token) |
| **Data** | PostgreSQL + Prisma · TanStack Query |
| **Delivery** | Resend (email) · in-process automation engine |
| **Deploy** | Railway (Nixpacks) or Docker |

---

## ⚡ Get started

```bash
# Docker — app + Postgres in one command
cp .env.example .env          # add your own API keys
docker compose up -d --build  # → http://localhost:3000
```

Then log in, open **Settings → Brand**, set your app name / niche / channel handle, add your topics and schedule — and you're live in your own niche **without touching a line of code.**

<div align="center">

### 🚂 One-click deploy

<a href="https://railway.com/new"><img src="https://railway.com/button.svg" alt="Deploy on Railway" height="44" /></a>

*Railway-ready out of the box — Postgres plugin, auto-migrations, health checks, and ffmpeg/fonts all pre-configured.*

</div>

> 📚 **Full setup, API-key sourcing, environment variables, deployment, and troubleshooting:** see **[`docs/DEVELOPER_GUIDE.md`](docs/DEVELOPER_GUIDE.md)**.

---

## 📄 License

Proprietary. Configure your own brand and supply your own API keys. Third-party usage (Groq, Google/YouTube, Cloudinary, Jamendo, Resend) is subject to those providers' terms.

<div align="center">
<sub>Built to run faceless YouTube channels at scale. 🚀</sub>
</div>
