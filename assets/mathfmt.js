/* Card text formatting: math notation -> KaTeX, A)-D) options onto their own
   lines, and "LABEL:" lead-ins emphasised. The deck sources stay plain text so
   the Quizlet exports remain readable; all of this happens at render time. */
(() => {
const FUNCS = new Set(["sqrt","pi","sin","cos","tan","arcsin","arccos","arctan",
  "abs","log","ln","mean","median","stdev","total","min","max","quartile","distance","cdot"]);

/* A span only counts as math if it carries a real math signal AND contains no
   ordinary prose word. That second test is what keeps sentences intact. */
function looksLikeMath(s) {
  const t = s.trim();
  if (t.length < 2 || t.length > 80) return false;
  if (!/[\^=]|sqrt\(|\bpi\b|·|≤|≥|±|\d\s*\/\s*\d/.test(t)) return false;
  if (/[A-Za-z]{3,}/.test(t)) {
    const words = t.match(/[A-Za-z]{3,}/g) || [];
    if (words.some(w => !FUNCS.has(w.toLowerCase()))) return false;
  }
  if (!/[0-9]/.test(t) && !/\^/.test(t) && !/sqrt/.test(t)) return false;
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
  t = t.replace(/\s{2,}/g, " ");
  return t;
}

function katexify(tex) {
  if (!window.katex) return null;
  try { return window.katex.renderToString(tex, {throwOnError:false, displayMode:false}); }
  catch { return null; }
}

/* Walk the text in whitespace-separated runs, grouping adjacent math-ish tokens. */
function mathify(text) {
  const isTok = w => {
    if (!/^[A-Za-z0-9^().,+\-*/·=<>!≤≥±≈°_]+$/.test(w)) return false;
    if (/^[.,]$/.test(w)) return false;
    const bare = w.replace(/[^A-Za-z]/g, "").toLowerCase();
    // math signal, a lone variable letter, or a known function - never a prose word
    if (/^[+\-*/=<>≤≥±≈·(),]+$/.test(w)) return true;      // bare operator continues a run
    return /[0-9^=/·*<>≤≥]/.test(w) || /^[A-Za-z][).,]?$/.test(w) || FUNCS.has(bare);
  };
  const parts = text.split(/(\s+)/);
  let out = "", buf = [], bufRaw = "";
  const flush = () => {
    if (!buf.length) return;
    const raw = bufRaw.replace(/^\s+|\s+$/g, "");
    const trail = bufRaw.slice(raw.length ? bufRaw.indexOf(raw) + raw.length : 0);
    const lead  = bufRaw.slice(0, bufRaw.indexOf(raw) < 0 ? 0 : bufRaw.indexOf(raw));
    // strip sentence punctuation before testing, restore after
    const m = raw.match(/^(.*?)([.,;:]?)$/s);
    let core = m[1], punct = m[2], tail = "";
    const dang = core.match(/\s+x$/);          // trailing "x" is a multiplication sign, not a variable
    if (dang) { core = core.slice(0, -dang[0].length); tail = dang[0]; }
    punct = tail + punct;
    if (looksLikeMath(core)) {
      const html = katexify(toTeX(core));
      out += lead + (html ? `<span class="mth">${html}</span>` : `<code>${core}</code>`) + punct + trail;
    } else out += bufRaw;
    buf = []; bufRaw = "";
  };
  for (const p of parts) {
    if (/^\s+$/.test(p)) { if (buf.length) bufRaw += p; else out += p; continue; }
    if (isTok(p)) { buf.push(p); bufRaw += p; }
    else { flush(); out += p; }
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
window.formatCard = function (text) {
  return text.split(" | ").map(part => {
    let p = mathify(part);
    p = p.replace(/^([A-Z][A-Za-z' -]{1,26}):/, '<b class="lbl">$1:</b>');
    return splitChoices(p);
  }).join('<div class="sep"></div>');
};
window._mathInternals = {looksLikeMath, toTeX, mathify, splitChoices};
})();
