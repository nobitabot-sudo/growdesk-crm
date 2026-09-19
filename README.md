# GrowDesk CRM

Lead-distribution CRM for GrowDesk callers: scrapes/imports leads from multiple sources,
guarantees no phone number is ever entered twice, and auto-assigns every new lead to
whichever active caller currently has the fewest leads (round robin).

## What's inside

- `server.js` — the API (Express). Also serves the frontend.
- `db.js` — data layer. Uses Supabase/Postgres if `DATABASE_URL` is set, else
  falls back to a local `data/db.json` file — both store the exact same JSON
  shape, so nothing else in the app needs to know or care which one is active.
  A few things live here that matter most:
  - `normalizePhone()` — strips everything to the last 10 digits so `+91 98765-43210`,
    `09876543210`, and `9876543210` are recognized as the same number.
  - `ingestLeads()` — the single door every lead walks through, whether it came from
    a live scrape, a CSV import, or the manual add-lead form. It checks the phone
    against every existing lead before inserting; new leads land unassigned in
    the shared pool (see "the pool model" below).
  - `topUpCaller()` — pulls a caller up to her active-lead cap from that pool,
    oldest lead first, whenever she has room.
- `scrapers/googlePlaces.js` — the one live "scrape" source, using the official
  Google Places API. See the note at the top of that file on why JustDial and
  Instagram are import-only rather than scraped directly. Also has
  `scrapeCategoriesWithBudget()` — pulls leads for several categories at once,
  round-robin (one search page per category per turn, not draining one before
  the next), and stops the instant estimated spend would cross the $ budget
  you give it. The Scrape tab's "Budget Scrape" section is the UI for this.
- `public/` — the installable PWA (login, caller dashboard, admin panels).

## Database setup (Supabase)

Without `DATABASE_URL` set, the app stores everything in a local
`data/db.json` file — that's fine on your own laptop, but most free hosts
wipe their disk on restart, so leads/callers/logins would vanish. Supabase's
free Postgres (500 MB, never expires, no card) fixes that. Setup:

1. Go to **supabase.com** → sign up (GitHub login is fine) → **New project**.
   Pick any name/region, set a database password (save it — you'll need it
   in step 3), and wait ~2 minutes for it to provision.
2. Once it's ready: left sidebar → **Project Settings** (gear icon) →
   **Database**.
3. Under **Connection string**, pick the **URI** tab, and copy it — it looks
   like `postgresql://postgres.xxxxx:[YOUR-PASSWORD]@aws-...pooler.supabase.com:6543/postgres`.
   Replace `[YOUR-PASSWORD]` with the password from step 1.
   Use the **Transaction pooler** connection string (the default one shown)
   rather than the direct connection — it works better with how hosts like
   Render manage connections.
4. That whole string is your `DATABASE_URL`. Set it as an environment
   variable wherever the app runs (locally in `.env`, or in Render's
   Environment tab when deployed — see below).
5. That's it — no manual table creation needed. The app creates its own
   table (`app_state`) automatically the first time it connects.

You can open Supabase's **Table Editor** any time to look at the raw data
(it's stored as one JSON blob per app in a table called `app_state` — this
app doesn't use a traditional table-per-entity schema, see the note in
"Known limits" below for why and when that would matter enough to change).

## First-time setup

```bash
npm install
cp .env.example .env    # then fill in DATABASE_URL, GOOGLE_PLACES_API_KEY, GROQ_API_KEY
node server.js
```

Open `http://localhost:3000`. Log in as:
- **Name:** `Admin`
- **Access Code:** `ADMIN01`

Change that access code immediately — right now anyone who reads this file knows it.
The quickest way: open Supabase's Table Editor (or `data/db.json` if running without
a database), find the admin user's `accessCode` field inside the JSON, edit it, save.
(A proper "change my own code" screen is a good next addition once you're past the demo stage.)

Google Places API key: console.cloud.google.com → enable "Places API (legacy)" →
create an API key → attach billing (Google's own $200/month free credit covers
small-scale use). Without this key set, the Scrape tab will show an error but
CSV Import and manual add still work fine.

## Deploying so the callers can actually use it

This is a normal Node app — any host that runs `node server.js` and gives you a public
URL works: Render, Railway, a small VPS, etc. On whichever you pick, set these
as environment variables (in that platform's dashboard, not in the repo):
1. `DATABASE_URL` (from the Supabase setup above) — with this set, no persistent
   disk on the app host is needed, since all the actual data lives in Supabase,
   not on the app server's own disk. This is what makes Render's free tier
   (which has no persistent disk) safe to use.
2. `GOOGLE_PLACES_API_KEY` (and `GROQ_API_KEY` if you want the Bot tab working)

Once it's live at a URL (e.g. `https://growdesk-crm.onrender.com`), each caller opens
it on her phone and taps "Add to Home Screen" — it installs like an app (that's the PWA
manifest + service worker doing their job) and opens full-screen without a browser bar.

## How leads actually flow (the pool model)

Scraping or importing does **not** hand leads to anyone directly. Every new lead lands
in a shared pool (`status: 'new'`, unassigned). A caller gets pulled from that pool —
oldest lead first — automatically, in two moments:
- the moment she opens her lead list (`GET /api/leads/mine`)
- the moment one of her leads is marked `closed` or `rejected`

Each caller is topped up until she's holding `ACTIVE_CAP_PER_CALLER` leads that are
still "in play" (`assigned`, `contacted`, `interested`, or `follow-up` — not
`closed`/`rejected`). That constant lives at the top of `db.js`, default `5`. Nobody
has to manually assign anything; the pool just drains as the team works through it.
Admin's **Callers** tab shows how many leads are still waiting in the pool.

## Skipping "already-famous" businesses

Every scrape (single-category or budget mode) drops a business before it ever reaches
the pool if either is true:
- it already has a **website** listed on its Google Business Profile (weak lead — it's
  already solved the "no online presence" problem GrowDesk exists to fix)
- it has **300+ reviews** (rough proxy for "big enough to already be sorted" — a chain
  or well-known local institution)

Neither threshold is exact — the point is steering clear of businesses that clearly
don't need these services, not a precise size cutoff. The constant is
`FAMOUS_REVIEW_THRESHOLD` in `scrapers/googlePlaces.js` if it needs adjusting.

## Logins, settings, and analytics

- **Logins persist across restarts** — sessions live in `data.sessions` inside
  `db.json`, not in server memory, so redeploying or restarting the process
  doesn't log anyone out. There's no expiry by design (a small internal team
  tool doesn't need it); a caller stays logged in until deactivated or she
  logs out herself.
- **Active-lead cap is admin-editable** — Callers tab has a "Save Cap" control
  that changes `data.settings.activeCapPerCaller` immediately, no restart
  needed. (No more editing `db.js` by hand.)
- **Analytics tab** (admin) shows overall conversion rate, a category-wise
  breakdown (which vertical actually closes), and caller-wise performance —
  all computed fresh from `db.js`'s `computeStats()`.

## GrowDesk Bot

A small Q&A assistant, in a "🤖 Bot" tab for both callers and admin, that
answers only from `businessKnowledge.js` — services, prices, the advance-payment
logic, and which categories GrowDesk targets. Meant for the moment mid-call
where a caller needs "client wants website + CRM + WhatsApp bot together,
what's the price?" answered fast, without pulling in an admin.

It's built to refuse to guess: anything not covered in `businessKnowledge.js`
(a discount, a custom quote, specifics of one client's ongoing deal) gets a
"check with admin" answer instead of an invented number.

Runs on **Groq's API free tier** — genuinely free on an ongoing basis (unlike
Anthropic's API, which only gives a small one-time trial credit and then bills
per token). Get a key with no credit card at console.groq.com → API Keys, and
set it as `GROQ_API_KEY`. The free tier allows roughly 1,000+ requests a day on
Llama 3.3 70B (higher on smaller models) — a small telecalling team asking
pricing questions won't come close to that, and Groq's inference is notably
fast, which matters for a tool meant to be checked mid-call. Without the key
set, the bot tab returns a clear error instead of failing silently. Optionally
set `GROQ_MODEL` to override the default (`llama-3.3-70b-versatile`); for an
even higher daily cap, `llama-3.1-8b-instant` trades a little quality for
~14,400 requests/day.

To update what the bot knows (a price changes, a new service is added), edit
`businessKnowledge.js` — no code logic changes needed, it's just the text the
bot is instructed to answer from.

## Pushing this to GitHub

1. On github.com, click **New repository** — give it a name (e.g.
   `growdesk-crm`), leave it **empty** (don't check "Add a README", GitHub's
   README would conflict with pushing this folder's own). Private or public,
   your call — private if the code shouldn't be publicly visible.
2. On your computer, open a terminal inside this unzipped folder and run:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/<your-username>/growdesk-crm.git
   git push -u origin main
   ```
   (No `git` installed? Download it from git-scm.com, or use GitHub Desktop's
   "Add local repository" instead of the terminal commands above.)
3. That's it — the code's on GitHub. `.gitignore` already excludes
   `node_modules/`, `.env`, and `data/db.json` (your real lead data and access
   codes), so none of that gets pushed by accident.
4. When you connect this repo to a host (Render, Railway, etc.), those
   platforms pull straight from GitHub and redeploy automatically on every
   push — you won't need to re-upload a zip each time. Set the real
   `GOOGLE_PLACES_API_KEY` / `GROQ_API_KEY` values in that platform's
   dashboard (see `.env.example` for the full list) — never in the repo itself.
5. Future changes: `git add .`, `git commit -m "what changed"`, `git push` —
   same three commands every time.

## Day-to-day use

1. **Callers tab** → add each girl by name → an access code is generated. Copy it and
   WhatsApp it to her immediately (it's shown once, right there, and not stored anywhere
   visible again — the code itself lives in `db.json` if you ever need to look it up).
2. **Scrape tab** → pull fresh leads from Google Places for a category + city.
3. **Import tab** → for JustDial, Instagram, or any manually-collected list: export to
   CSV with columns `businessName,phone,category,city,address` and upload.
4. Either path runs through the same dedup + round-robin logic — a lead already in the
   system (by phone number) is silently skipped, and a new one goes to whoever has the
   lightest load right now.
5. Each caller only ever sees her own assigned leads (auto-topped-up from the pool as
   described above), updates status/notes as she calls.
6. Every lead card has two extra panels the caller opens as needed:
   - **📞 Script** — the GROW call script (Greet → Reveal → Offer → Wrap+advance), auto-filled
     for that lead's category.
   - **🎯 Situations** — one-tap common objections ("busy abhi", "price zyada hai", "sochke
     batata hu", etc.), each with a ready reply and a button to set the lead's status
     accordingly, so the pipeline stays honest even mid-call.
   Category is auto-tagged from Google's place `types` (or keyword-matched from the business
   name for CSV imports) unless the CSV row already specifies one — see `categoryMap.js`.
   Script text and the objections list live in `public/scriptData.js`; edit the wording there
   any time without touching server code.
7. Admin's **Sab Leads** tab sees everything across all callers, with CSV export.

## Known limits worth knowing about (not hidden, just scoped out for v1)

- One admin access code, no "forgot code" flow — for a 2–10 person team this is fine;
  worth hardening before it's a bigger operation.
- Storage is one JSON blob per row (in Supabase or the local file), not a
  proper table-per-entity SQL schema — every request loads the whole thing,
  mutates it in memory, and writes it back whole. Totally fine at the scale
  this is built for (small team, thousands of leads) and much less code to
  maintain, but it's not built for many people hitting the API at the exact
  same instant (a rare edge case for a handful of callers) or for very large
  data volumes. If this ever needs to scale well past that, moving to a real
  users/leads/sessions table schema is the next step — `db.js` is the only
  file that would need rewriting; `server.js` and the frontend wouldn't change.
- No automatic re-scrape scheduling — Scrape tab is triggered manually for now.
