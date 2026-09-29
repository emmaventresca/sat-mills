/* Card text formatting: math notation -> KaTeX, A)-D) options onto their own
   lines, and "LABEL:" lead-ins emphasised. The deck sources stay plain text so
   the Quizlet exports remain readable; all of this happens at render time. */
(() => {
const STOP = new Set(["is","as","of","to","in","it","or","if","on","at","by","be","an",
  "we","so","do","no","up","my","me","us","he","the","and","for","are","was","not"]);
const WORDY = new Set(["angle","base","area","height","width","length","radius",
  "diameter","old","new","sum","count","total","whole","percent","part","side","theta"]);
const FUNCS = new Set(["sqrt","pi","sin","cos","tan","arcsin","arccos","arctan",
  "abs","log","ln","mean","median","stdev","total","min","max","quartile","distance","cdot"]);

/* A span only counts as math if it carries a real math signal AND contains no
   ordinary prose word. That second test is what keeps sentences intact. */
function looksLikeMath(s) {
  const t = s.trim();
  if (t.length < 2 || t.length > 240) return false;

  // no ordinary prose: only function names and a few words that belong in a formula
  const words = t.match(/[A-Za-z]{3,}/g) || [];
  if (words.some(w => !FUNCS.has(w.toLowerCase()) && !WORDY.has(w.toLowerCase()))) return false;

  const operands = t.match(/[A-Za-z0-9]+/g) || [];
  if (operands.length === 0) return false;                  // a bare ">=" is not an equation

  // it has to carry a real maths signal
  const strong = /[\^=]|sqrt\(|·|≤|≥|±/.test(t);
  const slash  = /\//.test(t) && operands.length >= 2;      // a/b, -A/B, 2/3
  if (!strong && !slash) return false;

  // a lone word with a dangling operator ("MEAN =") is a label, not an equation
  if (/^[A-Za-z]+\s*[=+\-*/·]?$/.test(t)) return false;
  // one operand is only an equation if it is raised or rooted: s^2 yes, "· H ·" no
  if (operands.length < 2 && !/[\^=]|sqrt/.test(t)) return false;
  return true;
}

function toTeX(s) {
  let t = s.trim();
  t = t.replace(/\s*<=\s*/g, " \\le ").replace(/\s*>=\s*/g, " \\ge ")
       .replace(/\s*!=\s*/g, " \\ne ").replace(/≤/g," \\le ").replace(/≥/g," \\ge ");
  // sqrt, allowing one level of nested parentheses
  for (let i = 0; i < 3; i++)
    t = t.replace(/sqrt\(((?:[^()]|\([^()]*\))*)\)/g, "\\sqrt{$1}");
  // trig / log functions get proper upright names
  t = t.replace(/\b(sin|cos|tan|arcsin|arccos|arctan|log|ln)\s*/g, "\\$1 ");
  t = t.replace(/(\d)\s*pi\b/g, "$1\\pi").replace(/(?<!\\)\bpi\b/g, "\\pi");
  t = t.replace(/·/g, " \\cdot ").replace(/±/g, " \\pm ").replace(/≈/g, " \\approx ").replace(/°/g, "^{\\circ}");
  // " x " used as a multiplication sign between quantities
  t = t.replace(/([A-Za-z0-9)])\s+x\s+(?=[A-Za-z0-9(])/g, "$1 \\times ");
  t = t.replace(/\^\(([^()]*)\)/g, "^{$1}");
  t = t.replace(/\^(-?[A-Za-z0-9.]+)/g, "^{$1}");
  // subscripts: x1, y2, b1 ... but never inside a decimal or exponent
  t = t.replace(/\b([a-zA-Z])([12])\b/g, "$1_{$2}");
  // fractions - both sides must be clean integers or simple groups
  t = t.replace(/\(([^()]{1,16})\)\s*\/\s*\(([^()]{1,16})\)/g, "\\frac{$1}{$2}");
  t = t.replace(/\((\d+)\s*\/\s*(\d+)\)/g, "\\frac{$1}{$2}");
  t = t.replace(/(?<![\\A-Za-z0-9.}])(\d+)\s*\/\s*(\d+)(?![\d.])/g, "\\frac{$1}{$2}");
  t = t.replace(/\*/g, " \\cdot ");
  WORDY.forEach(w => { t = t.replace(new RegExp("\\b" + w + "\\b", "gi"),
                                     m => `\\text{${m}}`); });
  t = t.replace(/\s{2,}/g, " ");
  return t;
}

function katexify(tex) {
  if (!window.katex) return null;
  try { return window.katex.renderToString(tex, {throwOnError:false, displayMode:false}); }
  catch { return null; }
}

/* Walk the text in whitespace-separated runs, grouping adjacent math-ish tokens. */
const esc = t => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function mathify(text) {
  const isTok = w => {
    if (!/^['"]*[A-Za-z0-9^().,+\-*/·=<>!≤≥±≈°_]+[?!;:'"]*$/.test(w)) return false;
    if (/^[.,]$/.test(w)) return false;
    const bare = w.replace(/[^A-Za-z]/g, "").toLowerCase();
    // math signal, a lone variable letter, or a known function - never a prose word
    if (/^[+\-*/=<>≤≥±≈·(),]+$/.test(w)) return true;      // bare operator continues a run
    if (/[0-9^=/·*<>≤≥]/.test(w)) return true;        // carries a math signal
    // a function name only counts as maths when it is actually a call, so the
    // English words "total", "mean", "min" and "max" stay prose
    const head = (w.match(/[A-Za-z]+/) || [""])[0].toLowerCase();
    if (FUNCS.has(head) && new RegExp("^['\"(]?" + head + "\\(", "i").test(w)) return true;
    if (bare === "pi" || bare === "theta") return true;
    if (STOP.has(bare) && !/[0-9^=/·]/.test(w)) return false;    // "is", "to", "'at"...
    // variable terms: at most two letters once punctuation is stripped, so
    // "bx", "a(x", "r)(x", "s)" keep an equation together while "gives" breaks it
    return bare.length > 0 && bare.length <= 2;
  };
  const parts = text.split(/(\s+)/);
  let out = "", buf = [], bufRaw = "";

  /* Peel a run apart into: whatever belongs to the surrounding prose (leading
     separators or quotes, trailing punctuation, a dangling multiplication sign,
     stray short words) and the equation in the middle. Emit the prose parts
     verbatim on both branches so nothing is duplicated or dropped. */
  const flush = () => {
    if (!buf.length) { return; }
    const raw   = bufRaw.trim();
    const at    = bufRaw.indexOf(raw);
    const lead  = at > 0 ? bufRaw.slice(0, at) : "";
    const trail = bufRaw.slice(at + raw.length);

    let core = raw, pre = "", post = "";
    let m;
    // leading title separators and opening quotes are prose
    if ((m = core.match(/^[·'"\s]+/)))      { pre  = m[0]; core = core.slice(m[0].length); }
    // trailing sentence punctuation and closing quotes are prose
    if ((m = core.match(/[.,;:?!'"]+$/)))    { post = m[0] + post; core = core.slice(0, -m[0].length); }
    // a dangling multiplication sign belongs to the words after it
    if ((m = core.match(/\s+x$/)))           { post = m[0] + post; core = core.slice(0, -m[0].length); }
    // short English words swept in at either end
    while ((m = core.match(/\s+([A-Za-z]{1,3})$/)) && STOP.has(m[1].toLowerCase())) {
      post = m[0] + post; core = core.slice(0, -m[0].length);
    }
    while ((m = core.match(/^([A-Za-z]{1,3})\s+/)) && STOP.has(m[1].toLowerCase())) {
      pre += m[0]; core = core.slice(m[0].length);
    }
    // a leading "=" belongs to the label outside the box: slope = [-A/B]
    if ((m = core.match(/^=\s*/)))           { pre += m[0]; core = core.slice(m[0].length); }
    // never leave a bracket unclosed inside a box: drop whole tokens off the
    // end (or the start) until the parentheses balance
    const bal = x => (x.match(/\(/g) || []).length - (x.match(/\)/g) || []).length;
    for (let guard = 0; guard < 8 && bal(core) !== 0 && core.trim(); guard++) {
      if (bal(core) > 0) {
        const m4 = core.match(/\s*\S+$/);
        if (!m4) break;
        post = m4[0] + post; core = core.slice(0, -m4[0].length);
      } else {
        const m5 = core.match(/^\S+\s*/);
        if (!m5) break;
        pre += m5[0]; core = core.slice(m5[0].length);
      }
    }
    // anything left over on the edges after trimming
    if ((m = core.match(/^[·'"\s=]+/)))      { pre += m[0]; core = core.slice(m[0].length); }
    if ((m = core.match(/[.,;:?!'"\s]+$/)))  { post = m[0] + post; core = core.slice(0, -m[0].length); }

    if (looksLikeMath(core)) {
      // several statements in one run typeset better as one box per sentence
      let pieces = core.split(/(?<=[.])\s+(?=[A-Za-z0-9(])/), glue = " ";
      if (pieces.length === 1 && core.length > 42 && /,/.test(core)) {
        const bits = core.split(/,\s*/).filter(Boolean);
        if (bits.length > 1 && bits.every(b => /[=^]|sqrt|·/.test(b))) { pieces = bits; glue = ", "; }
      }
      let body;
      if (pieces.length > 1) {
        body = pieces.map(x => {
          const h = katexify(toTeX(x.replace(/\.$/, "")));
          return h ? `<span class="mth">${h}</span>` : x;
        }).join(glue);
      } else {
        const h = katexify(toTeX(core));
        body = h ? `<span class="mth">${h}</span>` : `<code>${core}</code>`;
      }
      out += esc(lead + pre) + body + esc(post + trail);
    } else {
      out += esc(bufRaw);
    }
    buf = []; bufRaw = "";
  };

  for (const p of parts) {
    if (/^\s+$/.test(p)) { if (buf.length) bufRaw += p; else out += p; continue; }
    if (isTok(p)) { buf.push(p); bufRaw += p; }
    else { flush(); out += esc(p); }
  }
  flush();
  return out;
}

/* "A) foo B) bar C) baz D) qux" -> one per line */
function splitChoices(html) {
  if (!/\bA\)\s/.test(html) || !/\bD\)\s/.test(html)) return html;
  const i = html.search(/\bA\)\s/);
  const head = html.slice(0, i), tail = html.slice(i);
  const items = tail.split(/\s+(?=[A-D]\)\s)/).filter(Boolean);
  if (items.length < 2) return html;
  return head + `<ul class="choices">` +
    items.map(x => {
      const m = x.match(/^([A-D])\)\s*([\s\S]*)$/);
      return m ? `<li><b>${m[1]}</b><span>${m[2].trim()}</span></li>` : `<li>${x}</li>`;
    }).join("") + `</ul>`;
}

/* Public: format one side of a card. */
/* "09 NONLIN-EQ · H · SKIP-OK · 'question'" - the prefix is a label, and its
   middot separators must never be read as multiplication. */
function stripTitle(t) {
  const re = /^(\d{2}\s+[A-Z][A-Z0-9-]*(?:\s+(?:vs|and|or|to|[A-Z][A-Z0-9-]*))*|[A-Z](?![a-z])[A-Z0-9-]*)\s*·\s*/;
  let head = "", m;
  while ((m = t.match(re))) { head += m[0]; t = t.slice(m[0].length); }
  return [head, t];
}

/* Break "09 NONLIN-EQ · H · SKIP-OK · 'question'" into a badge and the question
   itself, so the label can be shown as a tag instead of run into the text. */
const DIFF = {E:"Easy", M:"Medium", H:"Hard", "SKIP-OK":"Skip OK"};
window.splitCardTitle = function (front) {
  const [head, rest] = stripTitle(front);
  if (!head) return null;
  const bits = head.split("·").map(x => x.trim()).filter(Boolean);
  const first = (bits.shift() || "").replace(/^\d+\s*/, "");
  const tags  = bits.map(b => DIFF[b] || b);
  // drop the quotes wrapping a question, including when options follow it
  const body = rest.trim().replace(/^'/, "").replace(/'(?=\s*(?:[A-D]\)|$))/, "").trim();
  return {section:first, tags, body: body || front};
};

window.formatCard = function (text) {
  return text.split(" | ").map(part => {
    const [head, rest] = stripTitle(part);
    let p = head + mathify(rest);
    p = p.replace(/^([A-Z][A-Za-z' -]{1,26}):/, '<b class="lbl">$1:</b>');
    return splitChoices(p);
  }).join('<div class="sep"></div>');
};
window._mathInternals = {looksLikeMath, toTeX, mathify, splitChoices};
})();
