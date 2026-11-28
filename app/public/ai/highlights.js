'use strict';
// Moment strength and "Why this moment?": explaining fast and smart detection scores.

// Moment strength: the auto-detect score, or for clips made by hand, how loud/lively the clip is
// according to the analysis (0-100).
// Why a moment was picked, in plain words. parts are z-scores (how far above a typical moment).
const PART_WORDS = {
  audio: [[2, 'very loud'], [1, 'loud'], [0.3, 'a bit louder than usual'], [-Infinity, 'not especially loud']],
  peak: [[2, 'big sudden spike'], [1, 'sudden spike'], [0.3, 'small spike'], [-Infinity, 'no sudden spike']],
  visual: [[2, 'lots of on-screen action'], [1, 'on-screen action'], [0.3, 'some movement'], [-Infinity, 'calm screen']],
};
const PART_KEYS = ['audio', 'peak', 'visual'];
// Smart detection: five signals, each 0-1 (see app/src/core/smart.js and docs/DETECTION.md).
const SMART_KEYS = ['audio', 'visual', 'semantic', 'emotion', 'context'];
const SMART_WORDS = {
  audio: [[0.6, 'very loud'], [0.3, 'loud'], [0.1, 'a bit louder than usual'], [-Infinity, 'not especially loud']],
  visual: [[0.6, 'lots of on-screen action'], [0.3, 'on-screen action'], [0.1, 'some movement'], [-Infinity, 'calm screen']],
  semantic: [[0.6, 'important things said'], [0.3, 'something worth hearing'], [0.1, 'some talk'], [-Infinity, 'little said']],
  emotion: [[0.6, 'strong emotion'], [0.3, 'some emotion'], [0.1, 'a little emotion'], [-Infinity, 'calm voice']],
  context: [[0.7, 'complete thought'], [0.4, 'mostly complete'], [0.2, 'partly complete'], [-Infinity, 'cut mid-thought']],
};
const REASON_TEXT = {
  quiet: 'Quiet but meaningful', complete: 'Starts and ends on complete sentences', qa: 'A question and its answer',
  punchline: 'A setup, then a reaction', story: 'Tells a story', laughter: 'Laughter', excitement: 'Excitement',
  surprise: 'Surprise', frustration: 'Frustration', enthusiasm: 'Enthusiasm', event: 'Gaming moment', insight: 'Insight or fact',
};
function explainScore(c) {
  if (!c || !c.scoreParts) return null;
  const smart = c.scoreEngine === 'smart';
  const keys = smart ? SMART_KEYS : PART_KEYS, table = smart ? SMART_WORDS : PART_WORDS;
  const w = c.scoreWeights || { audio: 1, peak: 0.5, visual: 0.3 };
  const contrib = keys.map(k => Math.max(0, (Number(w[k]) || 0) * (Number(c.scoreParts[k]) || 0)));
  const total = contrib.reduce((a, b) => a + b, 0);
  const shares = contrib.map(v => total ? Math.round(v / total * 100) : 0);
  const words = keys.map(k => table[k].find(([min]) => (Number(c.scoreParts[k]) || 0) >= min)[1]);
  return { keys, words, shares, smart, reasons: smart && Array.isArray(c.scoreReasons) ? c.scoreReasons : [] };
}
function scoreBarHtml(c) {
  if (c.score == null) return '';
  const ex = explainScore(c);
  const width = clamp(c.score, 3, 100);
  if (!ex) return `<div class="scorebar" title="${esc(tr('Moment strength') + ' ' + c.score + '/100')}"><i style="width:${width}%"></i></div>`;
  const tip = `${tr('Moment strength')} ${c.score}/100 · ` + ex.keys.map((k, i) => `${tr(ex.words[i])} ${ex.shares[i]}%`).join(' · ');
  return `<div class="scorebar parts" title="${esc(tip)}"><span style="width:${width}%">${ex.keys.map((k, i) => ex.shares[i] ? `<i class="p-${k}" style="width:${ex.shares[i]}%"></i>` : '').join('')}</span></div>`;
}
function renderWhy() {
  const c = selClip(), el = $('#whyMoment'); if (!el) return;
  const ex = explainScore(c);
  el.classList.toggle('hidden', !c);
  if (!c) return;
  if (!ex) { el.innerHTML = `<span class="muted small">${esc(tr(c.score != null ? 'This clip was detected before score details were kept. Run Auto-detect again to see why.' : 'Made by hand: no detection details.'))}</span>`; return; }
  const reasons = ex.reasons.filter(r => REASON_TEXT[r.k]).map(r => `<li>${esc(tr(REASON_TEXT[r.k]))}${r.w ? ` <q translate="no">${esc(r.w)}</q>` : ''}${Number.isFinite(r.t) ? ` <button class="linkish mono" data-seek="${Number(r.t)}">${fmt(r.t, false)}</button>` : ''}</li>`).join('');
  el.innerHTML = `<b>${esc(tr('Why this moment?'))}</b> <span class="muted small">${esc(tr('Moment strength'))} ${c.score}/100${ex.smart ? ' · ' + esc(tr('Smart detection')) : ''}</span>
    <div class="why-parts">${ex.keys.map((k, i) => `<span class="why-part"><i class="dot p-${k}"></i>${esc(tr(ex.words[i]))} <span class="muted">${ex.shares[i]}%</span></span>`).join('')}</div>${reasons ? `<ul class="why-reasons">${reasons}</ul>` : ''}`;
}
document.addEventListener('click', e => { const b = e.target.closest('#whyMoment [data-seek]'); if (b) seek(Number(b.dataset.seek)); });
function strengthOf(c) {
  if (c.score != null) return c.score;
  const L = S.loudNorm; if (!L) return -1;
  const a = Math.max(0, Math.floor(c.start)), b = Math.min(L.length, Math.ceil(c.end));
  if (b <= a) return -1;
  let sum = 0; for (let i = a; i < b; i++) sum += L[i];
  return Math.round(sum / (b - a) * 100);
}
