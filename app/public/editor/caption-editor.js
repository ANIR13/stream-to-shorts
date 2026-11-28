'use strict';
// Caption lines of a clip: status, editing, word timing.

function renderCaptionStatus() {
  const c = selClip(); if (!c) return;
  const st = $('#captionStatus');
  const j = S.jobs.find(x => x.clipId === c.id && x.slug === S.p.slug && x.type === 'captions' && ['queued', 'running'].includes(x.status));
  const stale = c.captionsRange && (c.captionsRange[0] !== c.start || c.captionsRange[1] !== c.end);
  $('#btnGenCaptions').disabled = !!j || !S.status?.whisper;
  $('#btnGenCaptions').textContent = Array.isArray(c.captions) ? 'Regenerate captions' : 'Generate captions';
  if (!S.p.style.captions) st.textContent = 'Captions are turned off for all clips (Style tab).';
  else if (j) st.textContent = `Listening… ${Math.round(j.progress * 100)}%`;
  else if (!S.status?.whisper) st.textContent = 'Speech recognition is not installed (see the Captions & AI tab).';
  else if (Array.isArray(c.captions)) st.textContent = stale
    ? (c.start < c.captionsRange[0] - 0.05 || c.end > c.captionsRange[1] + 0.05
      ? 'You changed the clip timing. Your caption edits are kept; only the added seconds will be transcribed when you render.'
      : 'You shortened the clip. Your caption edits are kept; lines outside the new timing are dropped when you render.')
    : `${c.captions.length} caption lines. Click any line to fix the words.`;
  else st.textContent = 'No captions yet. They will be generated automatically when you render, or generate them now to review the words.';
  const list = $('#chunkList');
  $('#chunkHelp').classList.toggle('hidden', !Array.isArray(c.captions) || !c.captions.length);
  if (!Array.isArray(c.captions)) { list.innerHTML = ''; list.dataset.for = ''; return; }
  if (list.dataset.for === c.id + ':' + c.captions.length + ':' + (c.captionsRange || []).join() + ':' + (c.captionsVer || 0)) return;
  list.dataset.for = c.id + ':' + c.captions.length + ':' + (c.captionsRange || []).join() + ':' + (c.captionsVer || 0);
  list.innerHTML = c.captions.map((ch, i) => `<div class="chunk" data-i="${i}"><span class="mono" title="Jump here">${fmt(ch.s - c.start)}</span><input value="${esc((ch.words || []).map(w => w.w).join(' '))}" aria-label="Caption line ${i + 1}"><button class="icon" data-delchunk title="Remove this line" aria-label="Remove line ${i + 1}">✕</button></div>`).join('');
}
function markChunk() {
  const c = selClip();
  if (!c || !Array.isArray(c.captions)) return;
  const t = player.currentTime;
  $$('#chunkList .chunk').forEach(el => { const ch = c.captions[+el.dataset.i]; el.classList.toggle('now', !!ch && t >= ch.s && t < ch.e); });
}
$('#chunkList').addEventListener('click', e => {
  const row = e.target.closest('.chunk'); const c = selClip();
  if (row && e.target.tagName === 'SPAN') { seek(c.captions[+row.dataset.i].s); }
  if (row && e.target.matches('[data-delchunk]')) { c.captions.splice(+row.dataset.i, 1); captionsChanged(c, Math.min(+row.dataset.i, c.captions.length - 1), 0); }
});
const r2 = v => Math.round(v * 100) / 100;
// Re-draw the caption lines after a structural edit and put the cursor at line focusI, position caret.
function captionsChanged(c, focusI, caret) {
  $('#chunkList').dataset.for = '';
  scheduleSave(); renderCaptionStatus(); drawPreview(); renderClipList();
  const inp = $$('#chunkList .chunk input')[focusI];
  if (inp) { inp.focus(); const p = caret == null ? inp.value.length : caret; inp.setSelectionRange(p, p); }
}
$('#chunkList').addEventListener('keydown', e => {
  if (e.target.tagName !== 'INPUT') return;
  const row = e.target.closest('.chunk'); const c = selClip(); if (!row || !c) return;
  const i = +row.dataset.i, ch = c.captions[i], inp = e.target;
  if (e.key === 'Enter') {
    // Split at the cursor: words before it stay, the rest becomes a new line.
    e.preventDefault();
    const before = inp.value.slice(0, inp.selectionStart).trim();
    const k = before ? before.split(/\s+/).length : 0;
    if (k <= 0 || k >= ch.words.length) return toast('Put the cursor between two words to split the line', '', 2500);
    const A = ch.words.slice(0, k), B = ch.words.slice(k);
    c.captions.splice(i, 1, { s: ch.s, e: B[0].s, words: A }, { s: B[0].s, e: ch.e, words: B });
    captionsChanged(c, i + 1, 0);
  } else if (e.key === 'Backspace' && i > 0 && inp.selectionStart === 0 && inp.selectionEnd === 0) {
    // Join with the line above.
    e.preventDefault();
    const prev = c.captions[i - 1];
    const caret = prev.words.map(w => w.w).join(' ').length + 1;
    prev.words = prev.words.concat(ch.words); prev.e = ch.e;
    c.captions.splice(i, 1);
    captionsChanged(c, i - 1, caret);
  }
});
$('#chunkList').addEventListener('input', e => {
  const row = e.target.closest('.chunk'); const c = selClip();
  if (!row || !c) return;
  const ch = c.captions[+row.dataset.i];
  const parts = e.target.value.trim().split(/\s+/).filter(Boolean);
  if (parts.length === ch.words.length) {
    // Same number of words: only the spelling changed, so keep each word's speech timing.
    ch.words = ch.words.map((w, k) => ({ ...w, w: parts[k] }));
  } else {
    const n = Math.max(1, parts.length), d = (ch.e - ch.s) / n;
    ch.words = parts.map((w, k) => ({ w, s: r2(ch.s + d * k), e: r2(ch.s + d * (k + 1)) }));
  }
  renderClipList();
  scheduleSave(); drawPreview();
});
$('#fDesc').addEventListener('input', e => { const c = selClip(); if (!c) return; c.description = e.target.value; scheduleSave(); });
['fTitle1', 'fTitle2'].forEach(id => $('#' + id).addEventListener('input', e => {
  const c = selClip(); if (!c) return;
  c[id === 'fTitle1' ? 'title1' : 'title2'] = e.target.value;
  scheduleSave(); drawPreview();
  const card = $(`.clip[data-id="${c.id}"] .title`);
  if (card) { const t = [c.title1, c.title2].filter(Boolean).join(' '); card.textContent = `#${clipNo(c)} ${t || 'Untitled clip'}`; card.classList.toggle('untitled', !t); }
  renderTitleFit(); renderSetup();
}));
