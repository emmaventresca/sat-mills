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

This site has **no real accounts**. Both passwords are checked *in the browser*.
They are stored as SHA-256 hashes rather than plain text, so browsing this repo does
not hand someone the password — but that is obfuscation, not security. Anyone who
reads `assets/app.js` can see how the check works and bypass it. The Supabase `anon`
key is public by design, and the table policies allow anonymous read and write.

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

Open [`assets/config.js`](assets/config.js) and paste both in.

To change either password, generate a hash and paste it over the existing one:

```bash
python3 tools/hash_password.py "my new teacher password"
```

Current defaults: student `Mills`, teacher `mills-coach-2026`.

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

Clicking a deck opens a menu rather than starting immediately:

- **Review N due today** — spaced repetition, the highest-value option (see below)
- **Practice N new cards** — cards she has never seen
- **Drill the N you have missed**
- **Review your N flagged cards**
- **Re-practice the N you have already seen**
- **Browse all N cards** — flip through the whole deck freely, nothing graded,
  nothing hidden

In a round she flips each card and marks **Got it** or **Missed it**, and can
**Flag** anything to come back to. **Previous / Next** move freely in every mode,
so nothing disappears the moment it is answered — going back shows what she marked
and lets her change it.

Keyboard: `space` flips, `1` missed, `2` got, `←` `→` move without grading,
`f` flags.

### Spaced repetition

Every answered card sits in one of five Leitner boxes. A correct answer promotes it
and pushes the next review further out (1, 3, 7, then 21 days); a miss drops it
straight back to box 1 and re-queues it in ten minutes. The deck menu surfaces
whatever is due, which is the single best use of a short study session.

### Other study aids

- **Daily streak and cards-today counter** on the home screen
- **Search every card** across all six decks at once
- **Shuffle toggle** so she learns the cards rather than their order
- **Where you are weakest** — per-deck accuracy by section, so she can see that (say)
  Circles is at 40% while Systems is at 90%
- **Your missed / flagged cards** listed at the bottom of the home screen, with a
  button to practice them
- End of round: a result, a nudge, and four ways to keep going

## What you see on the dashboard

Practice sessions, cards answered, overall accuracy, time on cards, and current flag
count. Then a per-deck table (rounds, accuracy, last practiced), everything she has
**flagged**, her **most-missed cards** ranked, **practice by day** (sessions, cards,
accuracy and time per day with a bar for relative effort), and a recent-session log.

Per-card time is measured from the card appearing to her marking it, capped at two
minutes so a session left open overnight does not distort the totals.

Press **Refresh** to re-read. It is a live query, not a cached report.

## Offline behavior

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
