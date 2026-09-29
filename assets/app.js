/* SAT practice - student app */
(() => {
const C = window.CONFIG, LS = window.localStorage;
const $  = s => document.querySelector(s);
const el = (t, c, h) => { const e=document.createElement(t); if(c)e.className=c; if(h!=null)e.innerHTML=h; return e; };

/* ---------- Supabase + offline outbox ---------- */
let sb = null;
const configured = () => C.SUPABASE_URL && !C.SUPABASE_URL.startsWith("PASTE");
if (configured() && window.supabase) {
  try { sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY); } catch(e){ console.warn(e); }
}
const OUTBOX = "sat.outbox";
const readOutbox  = () => { try { return JSON.parse(LS.getItem(OUTBOX)) || []; } catch { return []; } };
const writeOutbox = q => LS.setItem(OUTBOX, JSON.stringify(q.slice(-500)));

async function flush() {
  if (!sb) return;
  let q = readOutbox();
  if (!q.length) return;
  const batch = q.slice(0, 50);
  const { error } = await sb.from("events").insert(batch);
  if (!error) { writeOutbox(q.slice(batch.length)); if (readOutbox().length) flush(); }
}
function log(action, extra = {}) {
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
const pkey = id => "sat.progress." + id;
function getProg(id) {
  try { return JSON.parse(LS.getItem(pkey(id))) || {seen:{}, flagged:[], rounds:0}; }
  catch { return {seen:{}, flagged:[], rounds:0}; }
}
const setProg = (id, p) => LS.setItem(pkey(id), JSON.stringify(p));

/* ---------- state ---------- */
const state = { decks:[], deck:null, queue:[], i:0, flipped:false, shown:0,
                sessionId:null, cardAt:0, roundStats:{got:0,missed:0}, mode:"all" };

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
    <div class="row" style="margin-top:14px"><button class="btn-primary grow" id="go">Start practising</button></div>
    <p class="small muted" style="margin:14px 0 0">Teacher? <a href="progress.html">Progress dashboard</a></p>`;
  const shell = el("div","center"); shell.appendChild(box); $("#app").appendChild(shell);
  const submit = () => {
    if ($("#pw").value.trim() === C.STUDENT_PASSWORD) {
      sessionStorage.setItem("sat.auth","student"); showDecks();
    } else showLogin("That password is not right. Try again.");
  };
  $("#go").onclick = submit;
  $("#pw").onkeydown = e => { if (e.key === "Enter") submit(); };
}

/* ---------- deck list ---------- */
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
  w.appendChild(el("div","topbar",
    `<div><h1>Your decks</h1><p class="muted small" style="margin:0">${done} of ${total} cards seen so far</p></div>
     <button id="out">Log out</button>`));
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
        <div class="d" style="margin-top:7px">${seen ? `${seen} seen - ${pct}% - practised ${p.rounds} time${p.rounds===1?"":"s"}` : "Not started"}${p.flagged.length?` - <span style="color:var(--flag)">${p.flagged.length} flagged</span>`:""}</div>`;
      b.onclick = () => startDeck(d.id);
      w.appendChild(b);
    });
  });
  $("#app").innerHTML = ""; $("#app").appendChild(w);
  $("#out").onclick = () => { sessionStorage.removeItem("sat.auth"); showLogin(); };
}

/* ---------- start / build queue ---------- */
async function startDeck(id, mode = "all") {
  const r = await fetch(`data/${id}.json`, {cache:"no-cache"});
  state.deck = await r.json();
  state.mode = mode;
  const p = getProg(id);
  let pool = state.deck.cards;
  if (mode === "missed")  pool = pool.filter(c => (p.seen[c.id]||{}).missed);
  if (mode === "flagged") pool = pool.filter(c => p.flagged.includes(c.id));
  if (mode === "new")     pool = pool.filter(c => !p.seen[c.id]);
  if (!pool.length) { showDecks("Nothing left in that group - nice work. Pick a deck to keep going."); return; }
  state.queue = pool.slice(0, mode === "all" ? C.ROUND_SIZE : Math.min(pool.length, 40));
  if (mode === "all") {
    const unseen = pool.filter(c => !p.seen[c.id]);
    state.queue = (unseen.length ? unseen : pool).slice(0, C.ROUND_SIZE);
  }
  state.i = 0; state.flipped = false; state.roundStats = {got:0,missed:0};
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
  state.cardAt = Date.now();

  const w = el("div","wrap");
  w.appendChild(el("div","topbar",
    `<div><b>${state.deck.title}</b><div class="pill">${state.deck.level}</div></div>
     <button id="quit">Back to decks</button>`));
  w.appendChild(el("div","counter",
    `<span class="pill">Card ${state.i+1} of ${state.queue.length}</span>
     <span class="pill" style="color:var(--good)">${state.roundStats.got} got</span>`));
  const bar = el("div","bar"); bar.innerHTML = `<i style="width:${state.i/state.queue.length*100}%"></i>`;
  w.appendChild(bar);

  const face = el("div","card face");
  face.id = "face";
  if (state.flipped) {
    face.className = "card face back";
    face.innerHTML = `<span class="sec">${c.section}</span>${fmt(c.back)}`;
  } else {
    face.innerHTML = `<div>${c.front}</div>`;
  }
  face.style.marginTop = "12px";
  w.appendChild(face);

  if (!state.flipped) {
    w.appendChild(el("p","hint","Tap the card, or press space, to see the answer"));
    const row = el("div","row",`<button class="btn-primary grow" id="flip">Show answer</button>
      <button class="btn-flag ${flagged?"on":""}" id="flag">${flagged?"Flagged":"Flag this"}</button>`);
    row.style.marginTop = "12px"; w.appendChild(row);
  } else {
    w.appendChild(el("p","hint","Be honest - did you know it before you flipped?"));
    const row = el("div","row");
    row.style.marginTop = "12px";
    row.innerHTML = `<button class="btn-bad grow" id="miss">Missed it</button>
      <button class="btn-good grow" id="got">Got it</button>
      <button class="btn-flag ${flagged?"on":""}" id="flag">${flagged?"Flagged":"Flag"}</button>`;
    w.appendChild(row);
  }
  $("#app").innerHTML = ""; $("#app").appendChild(w);

  $("#quit").onclick = () => showDecks();
  const flip = () => { state.flipped = true; renderCard(); };
  if ($("#flip")) $("#flip").onclick = flip;
  if (!state.flipped) face.onclick = flip;
  if ($("#got"))  $("#got").onclick  = () => answer(true);
  if ($("#miss")) $("#miss").onclick = () => answer(false);
  $("#flag").onclick = () => toggleFlag(c);
}
/* bold the LABEL: fragments before a colon, and pipe separators become breaks */
function fmt(s) {
  return s.split(" | ").map(part =>
    part.replace(/^([A-Z][A-Za-z' -]{1,26}):/, "<b>$1:</b>")
  ).join("<br><br>");
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
  const rec = p.seen[c.id] || {got:0, missed:0};
  got ? rec.got++ : rec.missed++;
  p.seen[c.id] = rec; setProg(state.deck.id, p);
  got ? state.roundStats.got++ : state.roundStats.missed++;
  log(got ? "got" : "missed",
      {card_id:c.id, card_front:c.front.slice(0,180), ms: Date.now() - state.cardAt});
  state.i++; state.flipped = false; renderCard();
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
  log("finish", {card_id:null, card_front:`${state.roundStats.got}/${state.queue.length} correct`});

  const seen = Object.keys(p.seen).length, pct = Math.round(seen / d.count * 100);
  const got = state.roundStats.got, n = state.queue.length;
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
      <div class="stat"><b>${p.rounds}</b><span>rounds practised</span></div>
    </div>`;
  w.appendChild(box);

  const next = el("div","card");
  let opts = `<h2 style="margin-top:0">Keep going</h2>`;
  if (newLeft)      opts += `<button class="btn-primary deck" id="more">Next ${Math.min(newLeft,C.ROUND_SIZE)} new cards <span class="muted">- ${newLeft} left in this deck</span></button>`;
  if (missedLeft)   opts += `<button class="deck" id="rm">Drill the ${missedLeft} you have missed <span class="muted">- highest value practice</span></button>`;
  if (flaggedLeft)  opts += `<button class="deck" id="rf">Review your ${flaggedLeft} flagged card${flaggedLeft===1?"":"s"}</button>`;
  if (!newLeft && advanced && advanced.id !== d.id)
                    opts += `<button class="deck" id="adv">You have seen every card here - try <b>${advanced.title}</b></button>`;
  opts += `<button class="deck" id="again">Practise this deck again from the top</button>`;
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
  if (e.code === "Space" || e.key === "Enter") {
    e.preventDefault();
    if (!state.flipped) { state.flipped = true; renderCard(); }
    else if ($("#got")) answer(true);
  }
  if (state.flipped && (e.key === "1" || e.key === "ArrowLeft"))  answer(false);
  if (state.flipped && (e.key === "2" || e.key === "ArrowRight")) answer(true);
  if (e.key.toLowerCase() === "f") toggleFlag(state.queue[state.i]);
});

/* ---------- boot ---------- */
(async () => {
  flush();
  if (sessionStorage.getItem("sat.auth") === "student") { await loadIndex(); showDecks(); }
  else showLogin();
})();
})();
