# SAT Practice — Mills

A small static flashcard site for one student, plus a private progress dashboard.

- **`index.html`** — student practice app (password gate)
- **`progress.html`** — teacher dashboard (separate password)
- **`data/*.json`** — the six decks, 882 cards
- **`decks/*.tsv`** — the same decks as Quizlet import files
- **`tools/`** — the scripts that generated the decks (provenance)

## Decks

| Deck | Cards | Band |
|---|---|---|
| Vocabulary — Core | 303 | 1000→1300 |
| Transitions — Core | 105 | 1000→1300 |
| Math Signals — Core | 170 | 1000→1300 |
| Vocabulary — Advanced | 197 | 1300→1450 |
| Transitions — Advanced | 36 | 1300→1450 |
| Math Signals — Advanced | 71 | 1300→1450 |

87% of the core vocabulary is attested in College Board's own question bank or its
published practice tests. The math decks are built from the bank's real item
distribution (1,925 items) and lead with Desmos methods rather than hand algebra.

---

## ⚠️ Read this about security

This site has **no real accounts**. Both passwords are checked *in the browser*, and
the student password is visible to anyone who views the page source. The Supabase
`anon` key is public by design, and the table policies allow anonymous read and write.

That is a deliberate trade for a private practice site for one student. **Do not put
anything sensitive in this project**, and do not reuse the passwords anywhere else.
Practice logs are the only thing stored.

---

## Setup

### 1. Create the Supabase project (~5 min)

1. Go to [supabase.com](https://supabase.com) and create a free account.
2. **New project.** Any name. Save the database password somewhere (you will not need
   it for this site, but Supabase asks for one).
3. Wait for it to finish provisioning.

### 2. Create the table

In the Supabase sidebar: **SQL Editor → New query**. Paste the entire contents of
[`supabase/schema.sql`](supabase/schema.sql) and press **Run**. You should see
"Success. No rows returned."

### 3. Paste your keys

In Supabase: **Project Settings → Data API**. Copy:

- **Project URL** → looks like `https://abcdefgh.supabase.co`
- **anon public** key → a long string starting `eyJ...`

Open [`assets/config.js`](assets/config.js) and paste both in. While you are there,
change `TEACHER_PASSWORD` to something she will not guess.

```js
SUPABASE_URL:      "https://abcdefgh.supabase.co",
SUPABASE_ANON_KEY: "eyJhbGciOi...",
TEACHER_PASSWORD:  "something-only-you-know",
```

### 4. Publish to GitHub Pages

```bash
git add -A && git commit -m "Configure Supabase"
git push
```

Then in your GitHub repo: **Settings → Pages → Source: Deploy from a branch →
`main` / `/ (root)` → Save**. After a minute the site is live at
`https://YOUR-USERNAME.github.io/sat-practice/`.

Send Mills that link. Her password is **`Mills`**.
Your dashboard is at that link + `/progress.html`.

---

## How practice works

- Decks are split into rounds of 20 cards (`ROUND_SIZE` in config).
- A round serves **unseen cards first**, so she moves through a deck rather than
  re-seeing the same ones.
- She flips each card, then marks **Got it** or **Missed it**, and can **Flag** any
  card to come back to.
- Keyboard: `space` flips and then marks correct, `1` / `←` missed, `2` / `→` got,
  `f` flags.
- At the end of every round she gets a result, a nudge, and four ways to keep going:
  next 20 new cards, drill the ones she has missed, review her flagged cards, or
  restart the deck. When a core deck is fully seen, it points her at the advanced one.

## What you see on the dashboard

Practice sessions, cards answered, overall accuracy, time on cards, and current flag
count. Then a per-deck table (rounds, accuracy, last practised), everything she has
**flagged**, her **most-missed cards** ranked, and a recent-session log.

Press **Refresh** to re-read. It is a live query, not a cached report.

## Offline behaviour

Events queue in `localStorage` if she is offline or Supabase is unreachable, and
upload on the next successful connection. Nothing is lost if the wifi drops
mid-session. Practice also works fully before Supabase is configured — results just
stay on her device until the keys are added.

## Rebuilding the decks

```bash
python3 tools/build_decks.py
```

Regenerates `data/*.json` and `decks/*.tsv` from the sources in `tools/`.
Card IDs are content hashes of the front text, so editing a card's *front* creates a
new ID and resets that card's history; editing only the *back* is safe.

## Running locally

```bash
python3 -m http.server 8765
```

Then open `http://localhost:8765`.
