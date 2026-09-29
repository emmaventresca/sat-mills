/* SAT practice - teacher dashboard */
(() => {
const C = window.CONFIG;
const $ = s => document.querySelector(s);
const el = (t,c,h) => { const e=document.createElement(t); if(c)e.className=c; if(h!=null)e.innerHTML=h; return e; };
async function sha256(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2,"0")).join("");
}
let sb = null;
const configured = () => C.SUPABASE_URL && !C.SUPABASE_URL.startsWith("PASTE");
if (configured() && window.supabase) sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY);

const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[m]));
const ago = iso => {
  const m = Math.floor((Date.now() - new Date(iso)) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return m + " min ago";
  const h = Math.floor(m/60); if (h < 24) return h + (h===1?" hour ago":" hours ago");
  const d = Math.floor(h/24); return d + (d===1?" day ago":" days ago");
};
const mins = ms => ms < 60000 ? Math.round(ms/1000)+"s" : Math.round(ms/60000)+" min";

function login(msg) {
  const box = el("div","card"); box.style.maxWidth = "380px";
  box.innerHTML = `<h1>Progress dashboard</h1>
    <p class="muted small">Teacher access.</p>
    ${msg?`<div class="err">${msg}</div>`:""}
    <label for="pw">Teacher password</label>
    <input id="pw" type="password" autofocus>
    <div class="row" style="margin-top:14px"><button class="btn-primary grow" id="go">View progress</button></div>
    <p class="small muted" style="margin:14px 0 0"><a href="index.html">Back to practice</a></p>
    <p class="small muted" style="margin:6px 0 0">Demoing to someone? <a href="index.html?demo=1">Open the student view</a> - no password, nothing saved.</p>`;
  const shell = el("div","center"); shell.appendChild(box);
  $("#app").innerHTML = ""; $("#app").appendChild(shell);
  const go = async () => {
    const ok = await sha256($("#pw").value.trim()) === C.TEACHER_PASSWORD_SHA256;
    if (ok) { sessionStorage.setItem("sat.auth.t","1"); load(); }
    else login("Wrong password.");
  };
  $("#go").onclick = go;
  $("#pw").onkeydown = e => { if (e.key === "Enter") go(); };
}

async function load() {
  $("#app").innerHTML = `<div class="wrap"><p class="muted">Loading practice data…</p></div>`;
  if (!sb) {
    $("#app").innerHTML = `<div class="wrap"><div class="err"><b>Not connected.</b>
      Paste your Supabase URL and anon key into <code>assets/config.js</code>, then commit and push.</div></div>`;
    return;
  }
  const { data, error } = await sb.from("events").select("*").order("created_at",{ascending:false}).limit(5000);
  if (error) {
    $("#app").innerHTML = `<div class="wrap"><div class="err"><b>Could not read data.</b> ${esc(error.message)}
      <br><br>Most likely the table does not exist yet. Run <code>supabase/schema.sql</code> in the Supabase SQL editor.</div></div>`;
    return;
  }
  render(data || []);
}

function render(ev) {
  const decks = {}, cards = {}, flags = new Map(), sessions = {}, days = {};
  let answered = 0, got = 0, totalMs = 0;

  ev.forEach(e => {
    const d = decks[e.deck_id] = decks[e.deck_id] || {got:0,missed:0,rounds:0,last:null};
    if (!d.last || e.created_at > d.last) d.last = e.created_at;
    if (e.action === "got" || e.action === "missed") {
      answered++; if (e.action === "got") got++;
      const day = e.created_at.slice(0,10);
      const dd = days[day] = days[day] || {n:0, got:0, ms:0, sessions:new Set()};
      dd.n++; if (e.action === "got") dd.got++;
      if (e.ms) dd.ms += Math.min(e.ms, 120000);
      if (e.session_id) dd.sessions.add(e.session_id);
      if (e.ms) totalMs += Math.min(e.ms, 120000);
      d[e.action]++;
      const k = e.card_id || e.card_front;
      const c = cards[k] = cards[k] || {front:e.card_front, deck:e.deck_id, got:0, missed:0};
      c[e.action]++;
    }
    if (e.action === "finish") d.rounds++;
    if (e.session_id) {
      const s = sessions[e.session_id] = sessions[e.session_id] || {deck:e.deck_id, first:e.created_at, last:e.created_at, n:0};
      if (e.created_at < s.first) s.first = e.created_at;
      if (e.created_at > s.last)  s.last  = e.created_at;
      if (e.action === "got" || e.action === "missed") s.n++;
    }
    // flags: latest action per card wins
    if (e.action === "flag" || e.action === "unflag") {
      if (!flags.has(e.card_id)) flags.set(e.card_id, {on:e.action === "flag", front:e.card_front, deck:e.deck_id, at:e.created_at});
    }
  });

  const flagged = [...flags.values()].filter(f => f.on);
  const missedCards = Object.values(cards).filter(c => c.missed > 0)
    .sort((a,b) => (b.missed - a.missed) || (a.got - b.got)).slice(0, 25);
  const sess = Object.values(sessions).filter(s => s.n > 0).sort((a,b) => b.last.localeCompare(a.last));
  const last = ev.length ? ev[0].created_at : null;
  const acc = answered ? Math.round(got/answered*100) : 0;

  const w = el("div","wrap");
  w.appendChild(el("div","topbar",
    `<div><h1>${esc(C.STUDENT_NAME)}'s progress</h1>
      <p class="muted small" style="margin:0">${last ? "Last practiced " + ago(last) : "No practice recorded yet"}</p></div>
     <div class="row">
       <a id="demo" class="btn-primary" style="text-decoration:none;display:inline-block;padding:11px 17px;border-radius:13px;font-weight:700"
          href="index.html?demo=1" target="_blank" rel="noopener">Student view</a>
       <button id="rl">Refresh</button><button id="out">Log out</button></div>`));

  if (!ev.length) {
    w.appendChild(el("div","card","<p>Nothing yet. Once she practices, it will appear here automatically.</p>"));
    $("#app").innerHTML=""; $("#app").appendChild(w);
    $("#rl").onclick = load; $("#out").onclick = () => { sessionStorage.removeItem("sat.auth.t"); login(); };
    return;
  }

  const g = el("div","grid");
  g.innerHTML = `
    <div class="stat"><b>${sess.length}</b><span>practice sessions</span></div>
    <div class="stat"><b>${answered}</b><span>cards answered</span></div>
    <div class="stat"><b>${acc}%</b><span>overall accuracy</span></div>
    <div class="stat"><b>${mins(totalMs)}</b><span>time on cards</span></div>
    <div class="stat"><b style="color:var(--flag)">${flagged.length}</b><span>currently flagged</span></div>`;
  w.appendChild(g);

  // per deck
  w.appendChild(el("h2",null,"By deck"));
  const dt = el("div","card");
  dt.innerHTML = `<table><thead><tr><th>Deck</th><th class="num">Rounds</th><th class="num">Answered</th>
    <th class="num">Accuracy</th><th class="num">Last practiced</th></tr></thead><tbody>${
    Object.entries(decks).filter(([,d]) => d.got + d.missed > 0)
      .sort((a,b) => (b[1].got+b[1].missed) - (a[1].got+a[1].missed))
      .map(([id,d]) => {
        const n = d.got + d.missed;
        return `<tr><td>${esc(id)}</td><td class="num">${d.rounds}</td><td class="num">${n}</td>
          <td class="num">${Math.round(d.got/n*100)}%</td><td class="num">${ago(d.last)}</td></tr>`;
      }).join("") || `<tr><td colspan="5" class="muted">No completed cards yet.</td></tr>`}</tbody></table>`;
  w.appendChild(dt);

  // flagged
  w.appendChild(el("h2",null,`Flagged by her (${flagged.length})`));
  const ft = el("div","card");
  ft.innerHTML = flagged.length
    ? `<table><thead><tr><th>Card</th><th>Deck</th><th class="num">Flagged</th></tr></thead><tbody>${
        flagged.sort((a,b) => b.at.localeCompare(a.at)).map(f =>
          `<tr><td>${esc(f.front)}</td><td><span class="tag">${esc(f.deck)}</span></td>
           <td class="num">${ago(f.at)}</td></tr>`).join("")}</tbody></table>`
    : `<p class="muted">She has not flagged anything yet. Flagging is how she marks a card to come back to.</p>`;
  w.appendChild(ft);

  // most missed
  w.appendChild(el("h2",null,"Most missed cards"));
  const mt = el("div","card");
  mt.innerHTML = missedCards.length
    ? `<table><thead><tr><th>Card</th><th>Deck</th><th class="num">Missed</th><th class="num">Got</th></tr></thead><tbody>${
        missedCards.map(c => `<tr><td>${esc(c.front)}</td><td><span class="tag">${esc(c.deck)}</span></td>
          <td class="num" style="color:var(--bad)">${c.missed}</td><td class="num">${c.got}</td></tr>`).join("")}</tbody></table>`
    : `<p class="muted">Nothing missed yet.</p>`;
  w.appendChild(mt);

  // practice by day
  w.appendChild(el("h2",null,"Practice by day"));
  const dayRows = Object.entries(days).sort((a,b) => b[0].localeCompare(a[0])).slice(0,30);
  const maxMs = Math.max(1, ...dayRows.map(([,d]) => d.ms));
  const dt2 = el("div","card");
  dt2.innerHTML = dayRows.length
    ? `<table><thead><tr><th>Day</th><th class="num">Sessions</th><th class="num">Cards</th>
        <th class="num">Accuracy</th><th class="num">Time</th><th style="width:34%"></th></tr></thead><tbody>${
        dayRows.map(([day,d]) => {
          const label = new Date(day+"T12:00:00").toLocaleDateString(undefined,{weekday:"short",month:"short",day:"numeric"});
          return `<tr><td>${label}</td><td class="num">${d.sessions.size}</td><td class="num">${d.n}</td>
            <td class="num">${Math.round(d.got/d.n*100)}%</td><td class="num">${mins(d.ms)}</td>
            <td><div class="bar" style="margin:6px 0 0"><i style="width:${Math.round(d.ms/maxMs*100)}%"></i></div></td></tr>`;
        }).join("")}</tbody></table>
       <p class="muted small" style="margin:12px 0 0">Time is measured per card, from the card appearing to her marking it, capped at 2 minutes so a session left open does not distort the total.</p>`
    : `<p class="muted">No practice recorded yet.</p>`;
  w.appendChild(dt2);

  // sessions
  w.appendChild(el("h2",null,"Recent sessions"));
  const st = el("div","card");
  st.innerHTML = `<table><thead><tr><th>When</th><th>Deck</th><th class="num">Cards</th><th class="num">Length</th></tr></thead><tbody>${
    sess.slice(0,20).map(s => `<tr><td>${ago(s.last)}</td><td><span class="tag">${esc(s.deck)}</span></td>
      <td class="num">${s.n}</td><td class="num">${mins(new Date(s.last)-new Date(s.first))}</td></tr>`).join("")}</tbody></table>`;
  w.appendChild(st);

  $("#app").innerHTML = ""; $("#app").appendChild(w);
  $("#rl").onclick = load;
  $("#out").onclick = () => { sessionStorage.removeItem("sat.auth.t"); login(); };
}

if (sessionStorage.getItem("sat.auth.t") === "1") load(); else login();
})();
