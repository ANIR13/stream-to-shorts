'use strict';
// Edit tab: clip fields, title ideas, per-clip style.

function setVal(el, v) { if (document.activeElement !== el) el.value = v; }
function renderEditor() {
  if (currentTab() === 'tracks') renderTracksTab();
  const c = selClip();
  $('#editEmpty').classList.toggle('hidden', !!c);
  $('#editForm').classList.toggle('hidden', !c);
  if (!c) return;
  setVal($('#fTitle1'), c.title1 || '');
  setVal($('#fTitle2'), c.title2 || '');
  setVal($('#fStart'), fmt(c.start));
  setVal($('#fEnd'), fmt(c.end));
  const d = c.end - c.start;
  const dl = $('#durLabel');
  dl.textContent = `${d.toFixed(1)}s${d > 60 ? ': too long for Shorts (max 60s)' : ''}`;
  dl.classList.toggle('warn', d > 60);
  $('#btnTrim60').classList.toggle('hidden', d <= 60.05);
  setVal($('#fDesc'), c.description || '');
  $('#fCaptionsOn').checked = c.captionsOn !== false;
  $('#fLayoutMode').value = c.layoutMode || '';
  renderWhy();
  if ($('#titleIdeas').dataset.for !== c.id) { $('#titleIdeas').innerHTML = ''; $('#titleIdeas').dataset.for = c.id; }
  renderClipStyleSelect();
  renderTitleFit();
  renderCaptionStatus();
}
// Title ideas from the clip's captions: short punchy sentences, preferring exclamations, questions,
// numbers and the video's own key words (hint words and word fixes). Runs on this PC, no online AI.
const FILLER = /^(yeah|yes|yep|no|so|and|but|okay|ok|uh|um|oh|well|like|right|bro|guys|now|then|just|alright|hmm|ah|i mean|exactly|wait)$/i;
const NOISE = /^(uh|um|hmm|ah|er|erm|mm)$/i; // removed anywhere
const WEAK_END = /^(the|a|an|to|of|and|or|but|so|if|i|you|he|she|we|they|its|this|that|these|those|some|my|his|her|your|our|their|is|are|was|were|be|can|will|would|gonna|just|in|on|at|for|with|from|by|as|than|there's|what's|i'm|i'll|he's|she's|let's|don't|not|very|really|pretty|kinda)$/i;
const WEAK_START = /^(and|or|but|so|to|of|then|because|that|which|than)$/i;
const HYPE = /\b(mate|checkmate|win|won|winning|lose|lost|insane|crazy|wow|never|blunder|brilliant|trap|sacrifice|queen|king|clutch|seconds|last|best|worst|impossible|unbelievable|finally|no way|save|resign|time|minute|dead|over|gg)\b/i;
function splitTitle(text) {
  const w = text.split(' ');
  if (text.length <= 16 || w.length < 2) return [text, ''];
  let best = 1, bestLen = Infinity;
  for (let k = 1; k < w.length; k++) {
    const a = w.slice(0, k).join(' ').length, b = w.slice(k).join(' ').length;
    const m = Math.max(a, b) + (b < a ? 0 : 1); // slightly prefer a longer first line
    if (m < bestLen) { bestLen = m; best = k; }
  }
  return [w.slice(0, best).join(' '), w.slice(best).join(' ')];
}
// Candidates are whole sentences, clauses (between commas) and 5-7 word windows of long sentences,
// with filler words removed and no weak first/last word. Scored for exclamations, questions,
// the video's key words, numbers and hype words. Near-duplicates are skipped.
function suggestTitles(c) {
  const raw = (c.captions || []).flatMap(ch => (ch.words || []).map(w => String(w.w)));
  if (!raw.length) return null;
  const hints = new Set(String(S.p.whisper.prompt || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(x => x.length > 3)
    .concat((S.p.whisper.fixes || []).flatMap(f => String(f.to || '').toLowerCase().split(/\s+/)).filter(x => x.length > 3)));
  const sents = []; let cur = [];
  for (const w of raw) { cur.push(w); if (/[.!?…]["»”]?$/.test(w)) { sents.push(cur); cur = []; } }
  if (cur.length) sents.push(cur);
  const units = [];
  for (const sw of sents) {
    const end = (sw[sw.length - 1].match(/[!?]/) || [''])[0];
    units.push({ words: sw, end, whole: true });
    let part = [];
    for (const w of sw) { part.push(w); if (/[,;:]$/.test(w)) { units.push({ words: part, end: '', whole: false }); part = []; } }
    if (part.length && part.length < sw.length) units.push({ words: part, end, whole: false });
  }
  const clean = w => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}']+$/gu, '');
  const trim = ws => {
    for (let changed = true; changed && ws.length;) {
      changed = false;
      if (FILLER.test(ws[0]) || WEAK_START.test(ws[0])) { ws.shift(); changed = true; }
      const last = ws[ws.length - 1], keep = /^you$/i.test(last || '') && /^thank$/i.test(ws[ws.length - 2] || ''); // 'thank you' stays whole
      if (ws.length && !keep && (FILLER.test(last) || WEAK_END.test(last))) { ws.pop(); changed = true; }
    }
    return ws;
  };
  const cands = [];
  const add = (list, end, whole, atEnd) => {
    const ws = trim(list.slice());
    if (ws.length < 2) return;
    const text = ws.join(' '), low = text.toLowerCase();
    let score = whole ? 1.5 : atEnd ? 0.8 : 0;
    if (end === '!') score += 3; else if (end === '?') score += 2;
    for (const h of hints) if (low.includes(h)) score += 2;
    if (/\d/.test(text)) score += 1;
    if (HYPE.test(low)) score += 1.5;
    score -= Math.abs(ws.length - 5) * 0.35;
    const out = (text + end).toUpperCase();
    if (out.length <= 40) cands.push({ score, text: out });
  };
  for (const u of units) {
    let ws = u.words.map(clean).filter(w => w && !NOISE.test(w));
    ws = ws.filter((w, i) => !(i >= 2 && w.toLowerCase() === ws[i - 1].toLowerCase() && w.toLowerCase() === ws[i - 2].toLowerCase()));
    if (ws.length <= 8) add(ws, u.end, u.whole);
    else for (let i = 0; i + 4 <= ws.length; i++) for (const n of [5, 6, 7]) if (i + n <= ws.length) add(ws.slice(i, i + n), i + n >= ws.length ? u.end : '', false, i + n >= ws.length);
  }
  const seen = [], out = [];
  for (const x of cands.sort((p, q) => q.score - p.score)) {
    const tk = new Set(x.text.split(' '));
    if (seen.some(t => { const sw = t.split(' '); return sw.filter(w => tk.has(w)).length / Math.min(tk.size, sw.length) > 0.5; })) continue;
    seen.push(x.text);
    out.push(splitTitle(x.text));
    if (out.length === 3) break;
  }
  return out;
}
function showIdeas() {
  const c = selClip(), el = $('#titleIdeas'); if (!c) return;
  const ideas = suggestTitles(c);
  if (ideas === null) { el.innerHTML = `<span class="muted">${esc(tr('Generate captions first: ideas come from what was said in the clip.'))}</span>`; return; }
  if (!ideas.length) { el.innerHTML = `<span class="muted">${esc(tr('No good phrase found in this clip. Try writing your own.'))}</span>`; return; }
  el.innerHTML = ideas.map(([a, b]) => `<button class="idea" data-t1="${esc(a)}" data-t2="${esc(b)}" title="${esc(tr('Use this title'))}">${esc(a)}${b ? ` <i>${esc(b)}</i>` : ''}</button>`).join('');
}
$('#btnSuggest').addEventListener('click', showIdeas);
$('#titleIdeas').addEventListener('click', e => {
  const b = e.target.closest('.idea'); const c = selClip(); if (!b || !c) return;
  c.title1 = b.dataset.t1; c.title2 = b.dataset.t2;
  $('#fTitle1').value = c.title1; $('#fTitle2').value = c.title2;
  scheduleSave(); renderClipList(); renderTitleFit(); renderSetup(); drawPreview();
  keyFeedback(tr('Title set. Edit it freely; Ctrl+Z undoes this.'));
});
function renderTitleFit() {
  const c = selClip(), el = $('#titleFit');
  if (!c) return;
  const st = eff(c).style;
  const size = Layout.titleSize(st, c.title1, c.title2);
  const show = (c.title1 || c.title2) && size < st.titleSize;
  el.classList.toggle('hidden', !show);
  if (show) el.textContent = `This title is long, so it's shrunk to ${size} px (style size ${st.titleSize} px) to fit the width. Shorter lines stay bigger.`;
}
function renderClipStyleSelect() {
  const c = selClip(); if (!c) return;
  const sel = $('#fStylePreset');
  const names = S.presets.map(p => p.name);
  const own = c.style && c.styleName && !names.includes(c.styleName) ? [c.styleName] : [];
  sel.innerHTML = '<option value="">Project style</option>' + names.concat(own).map(n => `<option value="${esc(n)}">${esc(n)}${own.includes(n) ? ' (deleted preset)' : ''}</option>`).join('');
  sel.value = c.style ? (c.styleName || '') : '';
}
$('#fLayoutMode').addEventListener('change', e => {
  const c = selClip(); if (!c) return;
  if (e.target.value) c.layoutMode = e.target.value; else delete c.layoutMode;
  scheduleSave(); renderClipList(); drawPreview();
});
$('#fStylePreset').addEventListener('change', e => {
  const c = selClip(); if (!c) return;
  const pr = S.presets.find(p => p.name === e.target.value);
  if (pr) { c.style = { ...pr.style }; c.styleName = pr.name; } else if (!e.target.value) { delete c.style; delete c.styleName; }
  scheduleSave(); renderClipList(); renderTitleFit(); drawPreview(); renderStyleTab();
});
