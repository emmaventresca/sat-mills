/* SAT practice - student app */
(() => {
const C = window.CONFIG, LS = window.localStorage;

/* Demo mode: reached from the teacher dashboard as index.html?demo=1.
   It never writes to Supabase and keeps its own progress namespace, so
   demonstrating the app to someone cannot touch her real data or stats. */
const DEMO = new URLSearchParams(location.search).has("demo");
const NS = DEMO ? "sat.demo." : "sat.";
const $  = s => document.querySelector(s);
const el = (t, c, h) => { const e=document.createElement(t); if(c)e.className=c; if(h!=null)e.innerHTML=h; return e; };
async function sha256(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2,"0")).join("");
}

/* ---------- Supabase + offline outbox ---------- */
let sb = null;
const configured = () => C.SUPABASE_URL && !C.SUPABASE_URL.startsWith("PASTE");
if (configured() && window.supabase) {
  try { sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY); } catch(e){ console.warn(e); }
}
const OUTBOX = "sat.outbox";
const readOutbox  = () => { try { return JSON.parse(LS.getItem(OUTBOX)) || []; } catch { return []; } };
const writeOutbox = q => LS.setItem(OUTBOX, JSON.stringify(q.slice(-500)));

let backoffUntil = 0, flushing = false;
async function flush() {
  if (!sb || flushing || Date.now() < backoffUntil) return;
  let q = readOutbox();
  if (!q.length) return;
  flushing = true;
  try {
    const batch = q.slice(0, 50);
    const { error } = await sb.from("events").insert(batch);
    if (error) {
      // Table missing, offline, or policy refused. Keep the events and back off
      // so a long session does not retry on every single card.
      backoffUntil = Date.now() + 30000;
      console.warn("practice upload deferred:", error.message);
    } else {
      backoffUntil = 0;
      writeOutbox(q.slice(batch.length));
      if (readOutbox().length) { flushing = false; return flush(); }
    }
  } finally { flushing = false; }
}
function log(action, extra = {}) {
  if (DEMO) return;            // demo practice is never recorded
  const ev = Object.assign({
    student: C.STUDENT_NAME, session_id: state.sessionId,
    deck_id: state.deck ? state.deck.id : "-", action
  }, extra);
  writeOutbox(readOutbox().concat([ev]));
  flush();
}
window.addEventListener("online", flush);
setInterval(flush, 20000);

/* ---------- local progress ---------- */
const pkey = id => NS + "progress." + id;
function getProg(id) {
  try { return JSON.parse(LS.getItem(pkey(id))) || {seen:{}, flagged:[], rounds:0}; }
  catch { return {seen:{}, flagged:[], rounds:0}; }
}
const setProg = (id, p) => LS.setItem(pkey(id), JSON.stringify(p));

/* ---------- spaced repetition (Leitner boxes) ----------
   Box 1 = just missed, box 5 = known cold. A correct answer promotes a card and
   pushes its next review further out; a miss sends it straight back to box 1.
   Intervals are in days, indexed by box.                                      */
const BOX_DAYS = {1:0, 2:1, 3:3, 4:7, 5:21};
const DAY = 86400000;
function schedule(rec, got) {
  rec.box = got ? Math.min((rec.box || 1) + 1, 5) : 1;
  rec.due = Date.now() + (got ? BOX_DAYS[rec.box] * DAY : 10 * 60000);
  return rec;
}
const isDue = rec => !rec || !rec.due || rec.due <= Date.now();
function dueCount(deck, p) {
  return deck.cards.filter(c => p.seen[c.id] && isDue(p.seen[c.id])).length;
}

/* ---------- daily streak ---------- */
const today = () => new Date().toISOString().slice(0,10);
function bumpDay() {
  let d = {}; try { d = JSON.parse(LS.getItem(NS + "days")) || {}; } catch {}
  d[today()] = (d[today()] || 0) + 1;
  LS.setItem(NS + "days", JSON.stringify(d));
}
function streak() {
  let d = {}; try { d = JSON.parse(LS.getItem(NS + "days")) || {}; } catch {}
  let n = 0, t = new Date();
  if (!d[today()]) t.setDate(t.getDate() - 1);      // yesterday still counts
  for (;;) {
    const k = t.toISOString().slice(0,10);
    if (!d[k]) break;
    n++; t.setDate(t.getDate() - 1);
  }
  return {days:n, todayCount: d[today()] || 0};
}

/* ---------- state ---------- */
const state = { decks:[], deck:null, queue:[], i:0, flipped:false, answers:{},
                sessionId:null, cardAt:0, mode:"all" };
const tally = () => {
  let got=0, missed=0;
  Object.values(state.answers).forEach(v => v === "got" ? got++ : missed++);
  return {got, missed};
};

/* ---------- login ---------- */
function showLogin(msg) {
  $("#app").innerHTML = "";
  const box = el("div","card");
  box.style.maxWidth = "380px";
  box.innerHTML = `
    <h1>SAT practice</h1>
    <p class="muted small">Hi Mills. Enter your password to start.</p>
    ${msg ? `<div class="err">${msg}</div>` : ""}
    <label for="pw">Password</label>
    <input id="pw" type="password" autocomplete="current-password" autofocus>
    <div class="row" style="margin-top:14px"><button class="btn-primary grow" id="go">Start practicing</button></div>
    <p class="small muted" style="margin:14px 0 0">Teacher? <a href="progress.html">Progress dashboard</a></p>
    <p class="small muted" style="margin:6px 0 0">Just looking? <a href="index.html?demo=1">Open the demo</a> - no password, nothing saved.</p>`;
  const shell = el("div","center"); shell.appendChild(box); $("#app").appendChild(shell);
  const submit = async () => {
    const ok = await sha256($("#pw").value.trim()) === C.STUDENT_PASSWORD_SHA256;
    if (ok) { sessionStorage.setItem("sat.auth","student"); showDecks(); }
    else showLogin("That password is not right. Try again.");
  };
  $("#go").onclick = submit;
  $("#pw").onkeydown = e => { if (e.key === "Enter") submit(); };
}

/* ---------- deck list ---------- */
const deckCache = {};
async function loadDeck(id) {
  if (!deckCache[id]) {
    const r = await fetch(`data/${id}.json`, {cache:"no-cache"});
    deckCache[id] = await r.json();
  }
  return deckCache[id];
}
async function loadIndex() {
  if (state.decks.length) return;
  const r = await fetch("data/index.json", {cache:"no-cache"});
  state.decks = (await r.json()).decks;
}
async function showDecks(note) {
  await loadIndex();
  const w = el("div","wrap");
  const done = state.decks.reduce((a,d)=>a+Object.keys(getProg(d.id).seen).length,0);
  const total = state.decks.reduce((a,d)=>a+d.count,0);
  const st = streak();
  w.appendChild(el("div","topbar",
    `<div><h1>Your decks</h1><p class="muted small" style="margin:0">${done} of ${total} cards seen so far</p></div>
     <button id="out">Log out</button>`));

  const hdr = el("div","grid");
  hdr.innerHTML = `
    <div class="stat"><b>${st.days}</b><span>day streak${st.days>=3?" - keep it going":""}</span></div>
    <div class="stat"><b>${st.todayCount}</b><span>cards today</span></div>
    <div class="stat"><b id="duetotal">-</b><span>due for review</span></div>`;
  w.appendChild(hdr);

  const tools = el("div","card");
  tools.style.marginTop = "12px";
  tools.innerHTML = `
    <label for="q">Search every card</label>
    <input id="q" type="text" placeholder="e.g. tangent, however, discriminant">
    <div id="qres"></div>
    <div class="row" style="margin-top:12px;align-items:center">
      <button id="shuf">${LS.getItem(NS + "shuffle")==="1" ? "Shuffle: ON" : "Shuffle: OFF"}</button>
      <span class="muted small grow">Shuffling mixes up card order so you learn the cards, not the sequence.</span>
      <button id="reset" class="small">${DEMO ? "Reset demo" : "Reset my progress"}</button>
    </div>`;
  w.appendChild(tools);
  if (DEMO) w.appendChild(el("div","ok",
    `<b>Demo mode.</b> This is exactly what Mills sees, with sample progress filled in.
     Nothing here is saved and none of it reaches her real data.
     <a href="progress.html">Back to the dashboard</a>`));
  if (note) w.appendChild(el("div","ok",note));
  if (!configured()) w.appendChild(el("div","err",
    "<b>Progress is only saving on this device.</b> Supabase is not configured yet, so nothing is reaching the teacher dashboard. Practice still works and results are queued locally, and they will upload once the keys are added."));

  ["1000 to 1300","1300 to 1450"].forEach(level => {
    const list = state.decks.filter(d => d.level === level);
    if (!list.length) return;
    w.appendChild(el("h2", null, level === "1000 to 1300" ? "Core - start here" : "Advanced - when core feels easy"));
    list.forEach(d => {
      const p = getProg(d.id), seen = Object.keys(p.seen).length;
      const pct = Math.round(seen / d.count * 100);
      const b = el("button","card deck");
      b.innerHTML = `<div class="t">${d.title}<span class="badge ${level==="1000 to 1300"?"core":"adv"}">${d.count} cards</span></div>
        <div class="d">${d.description}</div>
        <div class="bar"><i style="width:${pct}%"></i></div>
        <div class="d" style="margin-top:7px">${seen ? `${seen} seen - ${pct}% - practiced ${p.rounds} time${p.rounds===1?"":"s"}` : "Not started"}${p.flagged.length?` - <span style="color:var(--flag)">${p.flagged.length} flagged</span>`:""}</div>`;
      b.onclick = () => showDeckMenu(d.id);
      w.appendChild(b);
    });
  });
  const review = el("div"); review.id = "review";
  w.appendChild(review);
  $("#app").innerHTML = ""; $("#app").appendChild(w);
  $("#out").onclick = () => { sessionStorage.removeItem("sat.auth"); showLogin(); };
  $("#shuf").onclick = () => {
    LS.setItem(NS + "shuffle", LS.getItem(NS + "shuffle")==="1" ? "0" : "1");
    showDecks();
  };
  $("#reset").onclick = () => {
    const msg = DEMO
      ? "Reset the demo back to its sample progress?"
      : "Clear all of your progress on this device? Streak, boxes, flags and history will be wiped. This cannot be undone.";
    if (!confirm(msg)) return;
    Object.keys(LS).filter(k => k.startsWith(NS)).forEach(k => LS.removeItem(k));
    location.reload();
  };
  wireSearch();
  renderReview(review);
  totalDue();
}

async function totalDue() {
  const decks = await Promise.all(state.decks.map(d => loadDeck(d.id)));
  const n = decks.reduce((a,deck) => a + dueCount(deck, getProg(deck.id)), 0);
  const elx = $("#duetotal"); if (elx) elx.textContent = n;
}

async function wireSearch() {
  const box = $("#q"), out = $("#qres");
  if (!box) return;
  const decks = await Promise.all(state.decks.map(d => loadDeck(d.id)));
  box.oninput = () => {
    const q = box.value.trim().toLowerCase();
    if (q.length < 2) { out.innerHTML = ""; return; }
    const hits = [];
    decks.forEach(deck => deck.cards.forEach(c => {
      if ((c.front + " " + c.back).toLowerCase().includes(q)) hits.push({c, deck});
    }));
    const shown = hits.slice(0,25);
    out.innerHTML = shown.length
      ? `<table style="margin-top:12px"><tbody>${shown.map((h,i) =>
          `<tr class="hitrow" data-i="${i}"><td>${h.c.front}</td>
            <td style="width:1%"><span class="tag">${h.deck.title.replace(" - "," ")}</span></td></tr>`
        ).join("")}</tbody></table>
        <p class="muted small" style="margin:10px 0 0">${hits.length>25?`${hits.length} matches, showing 25. `:""}Click any card to read it.</p>`
      : `<p class="muted small" style="margin-top:12px">No cards match that.</p>`;
    out.querySelectorAll(".hitrow").forEach(tr =>
      tr.onclick = () => showCardModal(shown[tr.dataset.i]));
  };
}

/* Peek at a single card without leaving the search results behind it. */
function showCardModal({c, deck}) {
  const m = el("div","modal");
  m.innerHTML = `<div class="modal-card">
      <button class="x" id="mx" aria-label="Close">&times;</button>
      <span class="sec">${deck.title}</span>
      <div class="modal-front">${frontHTML(c.front)}</div>
      <div class="modal-back">${fmt(c.back)}</div>
    </div>`;
  const close = () => { m.remove(); document.removeEventListener("keydown", esc); };
  const esc = e => { if (e.key === "Escape") close(); };
  m.onclick = e => { if (e.target === m) close(); };   // click the backdrop
  document.body.appendChild(m);
  m.querySelector("#mx").onclick = close;
  document.addEventListener("keydown", esc);
}

/* Your missed / flagged cards, across every deck. */
async function renderReview(root) {
  const decks = await Promise.all(state.decks.map(d => loadDeck(d.id)));
  const missed = [], flagged = [];
  decks.forEach(deck => {
    const p = getProg(deck.id);
    deck.cards.forEach(c => {
      const rec = p.seen[c.id];
      if (rec && rec.missed) missed.push({c, deck, n:rec.missed, got:rec.got});
      if (p.flagged.includes(c.id)) flagged.push({c, deck});
    });
  });
  missed.sort((a,b) => b.n - a.n);
  root.innerHTML = "";

  const section = (title, items, emptyMsg, mode, extra) => {
    root.appendChild(el("h2", null, `${title} (${items.length})`));
    const box = el("div","card");
    if (!items.length) { box.innerHTML = `<p class="muted" style="margin:0">${emptyMsg}</p>`; root.appendChild(box); return; }
    box.innerHTML = `<table><tbody>${items.slice(0,60).map(x =>
      `<tr><td>${x.c.front}</td><td style="width:1%"><span class="tag">${x.deck.title.replace(" - "," ")}</span></td>
       <td class="num" style="width:1%">${extra ? extra(x) : ""}</td></tr>`).join("")}</tbody></table>
      ${items.length > 60 ? `<p class="muted small" style="margin:10px 0 0">Showing the first 60.</p>` : ""}`;
    root.appendChild(box);
    const byDeck = [...new Set(items.map(x => x.deck.id))];
    const row = el("div","row"); row.style.marginTop = "10px";
    row.innerHTML = byDeck.map(id =>
      `<button data-deck="${id}" data-mode="${mode}">Practice these in ${state.decks.find(d=>d.id===id).title}</button>`).join("");
    root.appendChild(row);
    row.querySelectorAll("button").forEach(b =>
      b.onclick = () => startDeck(b.dataset.deck, b.dataset.mode));
  };

  section("Cards you have missed", missed,
    "Nothing missed yet. Once you mark a card as missed it will show up here so you can find it again.",
    "missed", x => `missed ${x.n}x`);
  section("Cards you have flagged", flagged,
    "Nothing flagged. Tap Flag on any card to save it here for later.",
    "flagged", null);
}

/* ---------- per-deck menu ---------- */
async function showDeckMenu(id) {
  const deck = await loadDeck(id);
  const p = getProg(id);
  const seen    = Object.keys(p.seen).length;
  const newLeft = deck.cards.filter(c => !p.seen[c.id]).length;
  const missed  = deck.cards.filter(c => (p.seen[c.id]||{}).missed).length;
  const flagged = p.flagged.length;

  const w = el("div","wrap");
  w.appendChild(el("div","topbar",
    `<div><h1>${deck.title}</h1><p class="muted small" style="margin:0">${deck.count} cards - ${seen} seen</p></div>
     <button id="back">All decks</button>`));
  const box = el("div","card");
  const due = dueCount(deck, p);
  let h = "";
  if (due) h += `<button class="btn-primary deck" id="m-due">Review ${due} card${due===1?"":"s"} due today <span style="opacity:.85">- spaced repetition, the highest-value practice</span></button>`;
  if (newLeft) h += `<button class="${due?"":"btn-primary "}deck" id="m-new">Practice ${Math.min(newLeft, C.ROUND_SIZE)} new cards <span style="opacity:.85">- ${newLeft} not yet seen</span></button>`;
  if (missed)  h += `<button class="deck" id="m-missed">Drill the ${missed} you have missed</button>`;
  if (flagged) h += `<button class="deck" id="m-flag">Review your ${flagged} flagged card${flagged===1?"":"s"}</button>`;
  if (seen)    h += `<button class="deck" id="m-seen">Re-practice the ${seen} you have already seen</button>`;
  h += `<button class="deck" id="m-browse"><b>Browse all ${deck.count} cards</b> <span class="muted">- flip through freely, nothing is graded and nothing disappears</span></button>`;
  box.innerHTML = h;
  w.appendChild(box);
  const go = (sel, mode) => { const b = $(sel); if (b) b.onclick = () => startDeck(id, mode); };
  // Weakest sections: where her accuracy is lowest inside this deck.
  const bySec = {};
  deck.cards.forEach(c => {
    const rec = p.seen[c.id]; if (!rec) return;
    const x = bySec[c.section] = bySec[c.section] || {got:0, missed:0};
    x.got += rec.got; x.missed += rec.missed;
  });
  const rows = Object.entries(bySec)
    .map(([sec,x]) => ({sec, n:x.got+x.missed, acc:x.got/(x.got+x.missed)}))
    .filter(r => r.n >= 2).sort((a,b) => a.acc - b.acc).slice(0,6);
  if (rows.length) {
    w.appendChild(el("h2", null, "Where you are weakest in this deck"));
    const t = el("div","card");
    t.innerHTML = `<table><thead><tr><th>Section</th><th class="num">Answered</th><th class="num">Accuracy</th></tr></thead>
      <tbody>${rows.map(r => `<tr><td>${r.sec}</td><td class="num">${r.n}</td>
        <td class="num" style="color:${r.acc<0.6?"var(--bad)":r.acc<0.85?"var(--flag)":"var(--good)"}">${Math.round(r.acc*100)}%</td></tr>`).join("")}</tbody></table>
      <p class="muted small" style="margin:12px 0 0">Based on the cards you have answered so far. Sections with at least 2 answers.</p>`;
    w.appendChild(t);
  }

  $("#app").innerHTML=""; $("#app").appendChild(w);
  $("#back").onclick = () => showDecks();
  go("#m-due","due"); go("#m-new","new"); go("#m-missed","missed");
  go("#m-flag","flagged"); go("#m-seen","seen"); go("#m-browse","browse");
}

/* ---------- start / build queue ---------- */
async function startDeck(id, mode = "all") {
  state.deck = await loadDeck(id);
  state.mode = mode;
  const p = getProg(id);
  let pool = state.deck.cards;
  if (mode === "missed")  pool = pool.filter(c => (p.seen[c.id]||{}).missed);
  if (mode === "flagged") pool = pool.filter(c => p.flagged.includes(c.id));
  if (mode === "seen")    pool = pool.filter(c => p.seen[c.id]);
  if (mode === "due")     pool = pool.filter(c => p.seen[c.id] && isDue(p.seen[c.id]));
  if (mode === "new")     pool = pool.filter(c => !p.seen[c.id]);
  if (!pool.length) { showDecks("Nothing left in that group - nice work. Pick a deck to keep going."); return; }

  if (LS.getItem(NS + "shuffle") === "1" && mode !== "browse") {
    pool = pool.slice();
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
  }
  // Browse shows the whole deck and is never trimmed.
  state.queue = mode === "browse" ? pool : pool.slice(0, C.ROUND_SIZE);
  state.i = 0; state.flipped = false; state.answers = {};
  state.sessionId = `${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
  log("start", {card_id:null, card_front:`${state.deck.title} (${mode})`});
  renderCard();
}

/* ---------- card ---------- */
function renderCard() {
  const c = state.queue[state.i];
  if (!c) return finish();
  const p = getProg(state.deck.id);
  const flagged = p.flagged.includes(c.id);
  const browse  = state.mode === "browse";
  const prior   = state.answers[c.id];          // answered earlier in this round?
  const t = tally();
  state.cardAt = Date.now();

  const w = el("div","wrap");
  w.appendChild(el("div","topbar",
    `<div><b>${state.deck.title}</b><div class="pill">${browse ? "Browsing - nothing is graded" : state.deck.level}</div></div>
     <button id="quit">Back to decks</button>`));
  w.appendChild(el("div","counter",
    `<span class="pill">Card ${state.i+1} of ${state.queue.length}</span>
     <span class="pill">${browse ? c.section : `${t.got} got - ${t.missed} missed`}</span>`));
  const bar = el("div","bar");
  bar.innerHTML = `<i style="width:${(state.i+1)/state.queue.length*100}%"></i>`;
  w.appendChild(bar);

  const face = el("div","card face");
  face.id = "face";
  if (state.flipped) {
    face.className = "card face back";
    face.innerHTML = `<span class="sec">${c.section}</span>${fmt(c.back)}`;
  } else {
    face.innerHTML = frontHTML(c.front);
  }
  face.style.marginTop = "12px";
  w.appendChild(face);

  if (prior) {
    w.appendChild(el("p","hint",
      `You marked this <b style="color:var(--${prior === "got" ? "good" : "bad"})">${prior === "got" ? "got it" : "missed"}</b> - answer again to change it`));
  } else if (!state.flipped) {
    w.appendChild(el("p","hint","Tap the card, or press space, to see the answer"));
  } else if (!browse) {
    w.appendChild(el("p","hint","Be honest - did you know it before you flipped?"));
  }

  const row = el("div","row");
  row.style.marginTop = "12px";
  if (!state.flipped) {
    row.innerHTML = `<button class="btn-primary grow" id="flip">Show answer</button>
      <button class="btn-flag ${flagged?"on":""}" id="flag">${flagged?"Flagged":"Flag this"}</button>`;
  } else if (browse) {
    row.innerHTML = `<button class="grow" id="hide">Hide answer</button>
      <button class="btn-flag ${flagged?"on":""}" id="flag">${flagged?"Flagged":"Flag"}</button>`;
  } else {
    row.innerHTML = `<button class="btn-bad grow" id="miss">Missed it</button>
      <button class="btn-good grow" id="got">Got it</button>
      <button class="btn-flag ${flagged?"on":""}" id="flag">${flagged?"Flagged":"Flag"}</button>`;
  }
  w.appendChild(row);

  // Navigation is always available, in every mode.
  const nav = el("div","row");
  nav.style.marginTop = "10px";
  const lastCard = state.i === state.queue.length - 1;
  nav.innerHTML =
    `<button id="prev" ${state.i === 0 ? "disabled" : ""}>&larr; Previous</button>
     <span class="grow"></span>
     <button id="next">${lastCard ? (browse ? "Back to deck" : "Finish round") : "Next &rarr;"}</button>`;
  w.appendChild(nav);
  w.appendChild(el("p","hint small",
    browse ? "space flips - arrow keys move - f flags"
           : "space flips - 1 missed, 2 got - arrow keys move without grading - f flags"));

  $("#app").innerHTML = ""; $("#app").appendChild(w);

  $("#quit").onclick = () => showDeckMenu(state.deck.id);
  const flip = () => { state.flipped = true; renderCard(); };
  if ($("#flip")) $("#flip").onclick = flip;
  if ($("#hide")) $("#hide").onclick = () => { state.flipped = false; renderCard(); };
  if (!state.flipped) face.onclick = flip;
  else if (browse) face.onclick = () => { state.flipped = false; renderCard(); };
  if ($("#got"))  $("#got").onclick  = () => answer(true);
  if ($("#miss")) $("#miss").onclick = () => answer(false);
  $("#flag").onclick = () => toggleFlag(c);
  $("#prev").onclick = () => move(-1);
  $("#next").onclick = () => move(1);
}

/* Move without grading. Going past the end finishes a round, or returns to the
   deck menu when browsing (browsing has no score to report). */
function move(d) {
  const n = state.i + d;
  if (n < 0) return;
  if (n >= state.queue.length) {
    return state.mode === "browse" ? showDeckMenu(state.deck.id) : finish();
  }
  state.i = n; state.flipped = false; renderCard();
}

const DIFFCLASS = {Easy:"d-e", Medium:"d-m", Hard:"d-h", "Skip OK":"d-s"};
/* Front of a card: the "10 QUAD · E ·" label becomes a badge row above the
   question rather than running into the sentence. */
function frontHTML(front) {
  const t = window.splitCardTitle && window.splitCardTitle(front);
  if (!t) return `<div class="frontbody">${fmt(front)}</div>`;
  const tags = t.tags.map(x => `<span class="dtag ${DIFFCLASS[x] || ""}">${x}</span>`).join("");
  return `<div class="cardtag"><span class="sname">${t.section}</span>${tags}</div>
          <div class="frontbody">${fmt(t.body)}</div>`;
}

/* Card body formatting lives in mathfmt.js (math, choices, labels). */
function fmt(s) {
  return window.formatCard ? window.formatCard(s)
       : s.split(" | ").map(x => x.replace(/^([A-Z][A-Za-z' -]{1,26}):/, "<b>$1:</b>")).join("<br><br>");
}
function toggleFlag(c) {
  const p = getProg(state.deck.id);
  const on = p.flagged.includes(c.id);
  p.flagged = on ? p.flagged.filter(x => x !== c.id) : p.flagged.concat([c.id]);
  setProg(state.deck.id, p);
  log(on ? "unflag" : "flag", {card_id:c.id, card_front:c.front.slice(0,180)});
  renderCard();
}
function answer(got) {
  const c = state.queue[state.i], p = getProg(state.deck.id);
  const prior = state.answers[c.id];
  if (prior !== (got ? "got" : "missed")) {
    const rec = p.seen[c.id] || {got:0, missed:0};
    got ? rec.got++ : rec.missed++;
    p.seen[c.id] = schedule(rec, got); setProg(state.deck.id, p);
    bumpDay();
    log(got ? "got" : "missed",
        {card_id:c.id, card_front:c.front.slice(0,180), ms: Date.now() - state.cardAt});
  }
  state.answers[c.id] = got ? "got" : "missed";
  move(1);
}

/* ---------- finish + encouragement ---------- */
const CHEERS = [
  "That is another round banked. Little and often is what moves a score.",
  "Nice work. The cards you missed are the ones worth the most next time.",
  "Done. Every pass makes the next one quicker.",
  "Round complete. Your brain is doing the boring part that pays off on test day.",
  "Solid. Consistency beats cramming every single time."
];
function finish() {
  const d = state.deck, p = getProg(d.id);
  p.rounds = (p.rounds || 0) + 1; setProg(d.id, p);
  log("finish", {card_id:null, card_front:`${tally().got}/${Object.keys(state.answers).length} correct`});

  const seen = Object.keys(p.seen).length, pct = Math.round(seen / d.count * 100);
  const t = tally();
  const got = t.got, n = Object.keys(state.answers).length || state.queue.length;
  const acc = Math.round(got / n * 100);
  const missedLeft  = d.cards.filter(c => (p.seen[c.id]||{}).missed).length;
  const flaggedLeft = p.flagged.length;
  const newLeft     = d.cards.filter(c => !p.seen[c.id]).length;
  const advanced = state.decks.find(x => x.level === "1300 to 1450" && x.id.split("-")[0] === d.id.split("-")[0]);

  let head;
  if (acc === 100)     head = `Perfect round - <b>${got} out of ${n}</b>.`;
  else if (acc >= 80)  head = `Strong round - <b>${got} out of ${n}</b>.`;
  else if (acc >= 50)  head = `<b>${got} out of ${n}</b>. Right in the useful zone.`;
  else                 head = `<b>${got} out of ${n}</b>. This deck is new to you, and that is fine.`;

  const w = el("div","wrap");
  w.appendChild(el("div","topbar",`<h1>Round done</h1><button id="quit">Back to decks</button>`));
  const box = el("div","card");
  box.innerHTML = `<p class="cheer">${head}</p>
    <p class="muted">${CHEERS[p.rounds % CHEERS.length]}</p>
    <div class="grid" style="margin-top:16px">
      <div class="stat"><b>${acc}%</b><span>this round</span></div>
      <div class="stat"><b>${pct}%</b><span>of deck seen</span></div>
      <div class="stat"><b>${p.rounds}</b><span>rounds practiced</span></div>
    </div>`;
  w.appendChild(box);

  const next = el("div","card");
  let opts = `<h2 style="margin-top:0">Keep going</h2>`;
  if (newLeft)      opts += `<button class="btn-primary deck" id="more">Next ${Math.min(newLeft,C.ROUND_SIZE)} new cards <span class="muted">- ${newLeft} left in this deck</span></button>`;
  if (missedLeft)   opts += `<button class="deck" id="rm">Drill the ${missedLeft} you have missed <span class="muted">- highest value practice</span></button>`;
  if (flaggedLeft)  opts += `<button class="deck" id="rf">Review your ${flaggedLeft} flagged card${flaggedLeft===1?"":"s"}</button>`;
  if (!newLeft && advanced && advanced.id !== d.id)
                    opts += `<button class="deck" id="adv">You have seen every card here - try <b>${advanced.title}</b></button>`;
  opts += `<button class="deck" id="again">Practice this deck again from the top</button>`;
  next.innerHTML = opts;
  w.appendChild(next);

  $("#app").innerHTML = ""; $("#app").appendChild(w);
  $("#quit").onclick = () => showDecks();
  if ($("#more"))  $("#more").onclick  = () => startDeck(d.id, "new");
  if ($("#rm"))    $("#rm").onclick    = () => startDeck(d.id, "missed");
  if ($("#rf"))    $("#rf").onclick    = () => startDeck(d.id, "flagged");
  if ($("#adv"))   $("#adv").onclick   = () => startDeck(advanced.id, "new");
  $("#again").onclick = () => startDeck(d.id, "all");
}

/* ---------- keyboard ---------- */
document.addEventListener("keydown", e => {
  if (!state.deck || !$("#face")) return;
  if (e.target.tagName === "INPUT") return;
  const browse = state.mode === "browse";
  if (e.code === "Space") {
    e.preventDefault();
    state.flipped = !state.flipped; renderCard(); return;
  }
  if (e.key === "ArrowLeft")  { e.preventDefault(); move(-1); return; }
  if (e.key === "ArrowRight") { e.preventDefault(); move(1);  return; }
  if (!browse && state.flipped && e.key === "1") answer(false);
  if (!browse && state.flipped && e.key === "2") answer(true);
  if (e.key.toLowerCase() === "f") toggleFlag(state.queue[state.i]);
});

/* Fill a demo with believable history so the screens are not all zeros. */
async function seedDemo() {
  if (LS.getItem(NS + "seeded")) return;
  const decks = await Promise.all(state.decks.map(d => loadDeck(d.id)));
  let rng = 20260929;
  const rand = () => (rng = (rng * 1103515245 + 12345) % 2147483648) / 2147483648;
  decks.forEach((deck, di) => {
    const share = [0.55, 0.30, 0.40, 0.10, 0.45, 0.08][di] || 0.2;
    const p = {seen:{}, flagged:[], rounds: Math.round(share * 9)};
    deck.cards.forEach((c, i) => {
      if (i / deck.cards.length > share) return;
      const hard = rand() < 0.28;
      const rec = {got: hard ? 1 : 1 + Math.floor(rand() * 2), missed: hard ? 1 + Math.floor(rand() * 2) : 0};
      rec.box = hard ? 1 : 2 + Math.floor(rand() * 3);
      rec.due = Date.now() + (rand() < 0.35 ? -DAY : BOX_DAYS[rec.box] * DAY);
      p.seen[c.id] = rec;
      if (rand() < 0.035) p.flagged.push(c.id);
    });
    setProg(deck.id, p);
  });
  const days = {};
  for (let i = 0; i < 9; i++) {
    if (i === 3 || i === 7) continue;                 // a couple of days off
    const d = new Date(); d.setDate(d.getDate() - i);
    days[d.toISOString().slice(0,10)] = 12 + Math.floor(rand() * 34);
  }
  LS.setItem(NS + "days", JSON.stringify(days));
  LS.setItem(NS + "seeded", "1");
}

/* ---------- boot ---------- */
(async () => {
  flush();
  if (DEMO) { await loadIndex(); await seedDemo(); showDecks(); }
  else if (sessionStorage.getItem("sat.auth") === "student") { await loadIndex(); showDecks(); }
  else showLogin();
})();
})();
