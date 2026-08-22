<div align="center">

# 🤝 Contributing to YouTubePilot AI

**Every contributor here started by not knowing how this works.**<br>
So did the person who built it.

<sub>Bug reports · features · docs · tests · a better error message — all of it counts</sub>

</div>

---

## 👋 Start here

This project was built by one person, learning as they went, mostly after midnight
on a two-core laptop. That has two consequences worth knowing up front:

1. **There are rough edges.** You will find things that make you think *"why on earth
   is it done like this?"* Sometimes there's a reason. Often there isn't, and it just
   never got cleaned up. Ask — or fix it.
2. **Your first pull request is welcome here.** Genuinely. If you've never contributed
   to open source before, this is a reasonable place to start, and questions are not
   an imposition.

There is no contribution too small. Fixing one confusing sentence in the README is a
real contribution, and it will be treated like one.

---

## 🚀 Getting it running

You need **Node 18+** and a **PostgreSQL** database. That's it to start.

```bash
git clone https://github.com/ys941/youtubepilot-ai.git
cd youtubepilot-ai
npm install

cp .env.example .env.local
```

Only **four** variables are needed to boot the dashboard:

| Variable | What it's for |
|---|---|
| `DATABASE_URL` | Your Postgres connection string |
| `APP_ACCESS_KEY` | The key you'll type on the login screen — pick anything |
| `SESSION_SECRET` | A long random string; `openssl rand -base64 32` works |
| `ATTRIBUTION_ACK` | Set to `https://github.com/ys941` — the app will not start without it ([why](#-attribution)) |

```bash
npm run db:push     # create the tables
npm run dev         # http://localhost:3000
```

**Everything else in `.env.example` is optional.** Each key only unlocks the feature it
powers — no YouTube credentials means no publishing, but the dashboard, the generator UI
and the settings all still work. You do not need a single API key to start contributing.

> 💡 No Postgres handy? `docker compose up -d postgres` gives you one in a few seconds.

---

## 🧭 Where things live

```
app/
├─ (dashboard)/          the screens — overview, generator, scheduler, analytics, settings
└─ api/                  route handlers; the automation entry points live here
lib/                     the actual logic — AI calls, video rendering, scheduling, publishing
prisma/schema.prisma     the data model; start here to understand the domain
components/              shared UI
```

If you're trying to understand the system, read `prisma/schema.prisma` first. The data
model explains the product faster than any document could.

---

## 💡 Things worth doing

Nobody is working on these. No permission needed — just say so in a PR or discussion
so two people don't do the same work twice.

| | Area | Why it matters |
|:--:|---|---|
| 🧪 | **Tests** | There is no test suite at all. This is the biggest gap in the project, and the easiest to start on — pure functions in `lib/` need no API keys to test. |
| ♿ | **Accessibility** | The dashboard has never been audited for keyboard or screen-reader use. One screen per PR is a perfect size. |
| 📖 | **Docs** | A setup guide written by someone who just did the setup — including everywhere they got stuck — would be worth more than one written by the author. |
| 🌍 | **i18n** | The UI is English-only. The reply logic already handles multiple languages; the interface doesn't. |
| 🎨 | **Themes** | The theme system is data-driven. New palettes are mostly a matter of taste. |
| ⚡ | **Performance** | Video rendering is the slowest part of the pipeline. It has never been profiled. |

---

## 🔀 Sending a pull request

```bash
git checkout -b fix/thing-that-was-broken
# ... make the change ...
npm run build          # must pass
git commit -m "fix: stop the scheduler double-firing on DST changes"
git push origin fix/thing-that-was-broken
```

Then open a PR. What helps:

- **Say what changed and why.** One honest paragraph beats a formal template.
- **Keep it focused.** One idea per PR. A 40-file PR takes a month to review; a 3-file PR takes an evening.
- **Screenshots for UI changes.** Before and after, if you can.
- **Say if you're unsure.** "I think this is right but I couldn't test the publishing path" is genuinely useful information, not a weakness.

Reviews may take a few days — this is nobody's day job. A polite nudge after a week is
completely fine.

---

## ⭐ Attribution

This project is free to use, fork, self-host and build a business on. There is one
condition, and it is deliberately small:

**Credit to the original author stays visible.**

In practice that means two things:

- The dashboard footer links to [@ys941](https://github.com/ys941). The app name above
  it is fully white-label and follows your Brand settings — the author credit is not.
- The server runs two checks at start-up: `ATTRIBUTION_ACK="https://github.com/ys941"`
  must be set in your environment, **and** the footer must still contain the credit.
  Strip the credit and the app refuses to boot. Nothing is transmitted — both checks
  are local.

This is **clause 2 of the [licence](LICENSE)**, so it applies whether or not the check
is present — deleting the check in [`lib/attribution.ts`](lib/attribution.ts) does not
remove the obligation.

---

## 🎨 Code style

There's no linter gate and no formatting police. Match the surrounding code and you'll
be fine. TypeScript is `strict`, so `npm run build` will tell you most of what's wrong.

One rule that matters more than style:

> ### ⚠️ Keep it white-label
>
> This app must work for **any** niche, for **anyone**. Never hardcode a topic, a channel
> handle, a persona, a language or a brand into the code, the prompts, the generated
> output or the metadata. Everything user-specific belongs in settings or the database.
>
> If your change would embarrass someone running a cooking channel, it's not ready.

---

## 🐛 Reporting bugs

Open an issue with whatever you have. Rough is fine.

Most useful: what you expected, what happened instead, and anything from the console.
If you can't reproduce it reliably, say so — intermittent bugs are still real bugs.

> ⚠️ **Scrub your API keys, tokens and channel IDs** out of anything you paste.

---

## 🔐 Security issues

Please **don't** open a public issue for a security problem.

Email **ys9410017064@gmail.com** instead, and give it a few days before disclosing
publicly. You'll be credited unless you'd rather not be.

---

## 📜 Licence

Contributions are made under the [MIT Licence with Attribution Requirement](LICENSE),
the same as the project.

See [COPYRIGHT.md](COPYRIGHT.md) for exactly what you may and may not do with this code —
the short version is "almost anything, just keep the credit".

---

<div align="center">

**Thank you for being here.** ⭐

<sub>Not sure where to start? Open a discussion and describe what you'd like to work on —<br>
you'll get an answer, and probably a pointer to exactly the right file.</sub>

</div>
