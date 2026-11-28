'use strict';
// Clip timing buttons, trim to 60 s, render and quick draft, render menu.

function setClipTime(which, t, snap = false) {
  const c = selClip(); if (!c || t == null) return '';
  let how = '';
  if (snap) { const sn = snapEdge(t, which); t = sn.t; how = sn.how || ''; }
  Object.assign(c, Timing.setEdge(c, which, t, S.p.meta.duration));
  S.p.clips.sort((a, b) => a.start - b.start);
  scheduleSave(); renderEditor(); renderClipList(); drawTimeline(); drawPreview();
  return how;
}
$('#fStart').addEventListener('change', e => { setClipTime('start', parseTime(e.target.value)); e.target.blur(); });
$('#fEnd').addEventListener('change', e => { setClipTime('end', parseTime(e.target.value)); e.target.blur(); });
$$('[data-nudge]').forEach(b => b.addEventListener('click', () => {
  const [which, d] = b.dataset.nudge.split(':'); const c = selClip(); if (!c) return;
  setClipTime(which, c[which] + Number(d)); seek(c[which]);
}));
$('#btnSetStart').addEventListener('click', () => { const how = setClipTime('start', player.currentTime, true); if (how) keyFeedback(`${tr('Snapped to a')} ${tr(how)}`); });
$('#btnSetEnd').addEventListener('click', () => { const how = setClipTime('end', player.currentTime, true); if (how) keyFeedback(`${tr('Snapped to a')} ${tr(how)}`); });
$('#fCaptionsOn').addEventListener('change', e => { const c = selClip(); c.captionsOn = e.target.checked; scheduleSave(); drawPreview(); });
$('#btnGenCaptions').addEventListener('click', async () => {
  const c = selClip(); if (!c) return;
  if (Array.isArray(c.captions) && !confirm('Transcribe this clip again from scratch? Any words you corrected by hand in this clip will be replaced.\n(Saved word fixes are applied again automatically.)')) return;
  await saveNow();
  try { await api('/api/captions',{ method: 'POST', body: { slug: slug(), clipId: c.id } }); toast('Generating captions on this PC…'); pollSoon(); }
  catch (e) { toast(e.message, 'err'); }
});
$('#btnDuplicate').addEventListener('click', () => {
  const c = selClip(); if (!c) return;
  const copy = { ...JSON.parse(JSON.stringify(c)), id: newId(), num: undefined, output: undefined, renderedAt: undefined, renderSig: undefined };
  S.p.clips.splice(S.p.clips.indexOf(c) + 1, 0, copy);
  scheduleSave(); selectClip(copy.id, false);
});
$('#btnDelete').addEventListener('click', () => {
  const c = selClip(); if (!c) return;
  if (!confirm('Delete this clip? Already-rendered video files are kept.')) return;
  const i = S.p.clips.indexOf(c);
  S.p.clips.splice(i, 1);
  S.sel = (S.p.clips[i] || S.p.clips[i - 1])?.id || null;
  scheduleSave(); renderAll();
});
// Shorten a clip to the 60 s Shorts limit, ending on a pause in speech when there is one nearby.
function trimTo60(c) {
  if (c.end - c.start <= 60.05) return false;
  const limit = c.start + 60;
  const sn = snapEdge(limit - 0.6, 'end');
  c.end = r1(sn.t <= limit && sn.t >= c.start + 2 ? sn.t : limit);
  return true;
}
$('#btnTrim60').addEventListener('click', () => { const c = selClip(); if (c && trimTo60(c)) { scheduleSave(); renderEditor(); renderClipList(); drawTimeline(); drawPreview(); keyFeedback(tr('Trimmed to') + ' ' + (c.end - c.start).toFixed(1) + ' s'); } });
async function renderClips(ids) {
  if (!ids.length) return;
  const long = S.p.clips.filter(c => ids.includes(c.id) && c.end - c.start > 60.05);
  if (long.length) {
    const msg = `${long.length} ${long.length > 1 ? 'clips are' : 'clip is'} longer than 60 s, the Shorts limit.\nOK = trim to 60 s, then render · Cancel = render as they are`;
    if (confirm(msg)) { long.forEach(trimTo60); scheduleSave(); renderAll(); toast(`Trimmed ${long.length} ${long.length > 1 ? 'clips' : 'clip'} to 60 s`, 'ok'); }
  }
  const untitled = S.p.clips.filter(c => ids.includes(c.id) && !c.title1 && !c.title2);
  if (untitled.length && !confirm(untitled.length > 1
    ? `${untitled.length} of these clips have no title.\nOK = render anyway · Cancel = add titles first (💡 Title ideas can help)`
    : `#${clipNo(untitled[0])} has no title.\nOK = render anyway · Cancel = add titles first (💡 Title ideas can help)`)) {
    selectClip(untitled[0].id, true); switchTab('edit'); $('#fTitle1').focus();
    return;
  }
  await saveNow();
  askNotify();
  try {
    const jobs = await api('/api/render',{ method: 'POST', body: { slug: slug(), clipIds: ids } });
    toast(jobs.length ? `${jobs.length} clip${jobs.length > 1 ? 's' : ''} added to the render queue` : 'Already in the queue', 'ok');
    pollSoon();
  } catch (e) { toast(e.message, 'err'); }
}
$('#btnRenderPreview').addEventListener('click', () => S.sel ? renderClips([S.sel]) : toast('Select a clip first', 'err'));
$('#btnDraft').addEventListener('click', quickDraft);
async function quickDraft() {
  const c = selClip();
  if (!c) return toast('Select a clip first', 'err');
  await saveNow();
  const t = player.currentTime;
  const from = t >= c.start && t < c.end - 1 ? t : c.start;
  try {
    await api('/api/draft', { method: 'POST', body: { slug: slug(), clipId: c.id, from } });
    toast(`Quick draft of #${clipNo(c)} from ${fmt(from - c.start)}… it opens when ready`);
    pollSoon();
  } catch (e) { toast(e.message, 'err'); }
}
const menu = $('#renderMenu');
function setMenu(open) {
  menu.classList.toggle('hidden', !open);
  $('#btnRenderMenu').setAttribute('aria-expanded', String(open));
  if (!open || !S.p) return;
  // Keep the menu on screen at any window width.
  const r = $('#btnRenderMenu').getBoundingClientRect(), mw = Math.min(320, window.innerWidth - 16);
  menu.style.width = mw + 'px';
  menu.style.left = clamp(r.right - mw, 8, window.innerWidth - mw - 8) + 'px';
  menu.style.top = (r.bottom + 6) + 'px';
  const clips = S.p.clips, c = selClip();
  const nSel = clips.filter(x => x.selected).length, nPend = clips.filter(needsRender).length;
  const set = (key, text, n) => { const b = menu.querySelector(`[data-render="${key}"]`); b.disabled = !n; b.querySelector('span').textContent = text; };
  set('one', c ? `#${clipNo(c)} ${[c.title1, c.title2].filter(Boolean).join(' ') || 'Untitled'}` : 'select a clip first', c ? 1 : 0);
  set('selected', nSel ? `${nSel} ticked in the clip list` : 'tick clips in the list first', nSel);
  set('pending', nPend ? `${nPend} not rendered or changed since` : 'everything is up to date', nPend);
  set('all', `${clips.length} clips`, clips.length);
  menu.querySelector('[data-render="draft"]').disabled = !c;
  // Suggest transcribing the whole stream once when many clips still need captions.
  const tip = $('#rmTip');
  const needCaps = clips.filter(x => x.captionsOn !== false && eff(x).style.captions && !Array.isArray(x.captions)).length;
  const showTip = !S.transcript && S.status?.whisper && needCaps >= 3;
  tip.classList.toggle('hidden', !showTip);
  if (showTip) tip.innerHTML = `<b>Tip:</b> ${needCaps} clips still need captions. Transcribing the whole stream once is faster than one clip at a time, and makes captions instant afterwards. <button class="btn small ghost" data-render="transcribe">Transcribe whole stream first</button>`;
}
$('#btnRenderMenu').addEventListener('click', e => {
  e.stopPropagation();
  const open = menu.classList.contains('hidden');
  setMenu(open);
  if (open && e.detail === 0) menu.querySelector('[data-render]:not(:disabled)')?.focus(); // opened with Enter/Space
});
menu.addEventListener('keydown', e => {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  e.preventDefault(); e.stopPropagation();
  const items = [...menu.querySelectorAll('[data-render]:not(:disabled)')], i = items.indexOf(document.activeElement);
  items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
});
document.addEventListener('click', e => { if (!e.target.closest('.menu-wrap')) setMenu(false); });
window.addEventListener('resize', () => setMenu(false));
menu.addEventListener('click', async e => {
  const b = e.target.closest('[data-render]'); if (!b || b.disabled) return;
  const kind = b.dataset.render, clips = S.p.clips;
  setMenu(false);
  if (kind === 'one') renderClips([S.sel]);
  else if (kind === 'selected') renderClips(clips.filter(c => c.selected).map(c => c.id));
  else if (kind === 'pending') renderClips(clips.filter(needsRender).map(c => c.id));
  else if (kind === 'all') {
    const fresh = clips.filter(c => !needsRender(c)).length;
    if (fresh && !confirm(`Render all ${clips.length} clips? ${fresh} of them are already up to date and will be rendered again.\n\nTip: "New & outdated only" skips those.`)) return;
    renderClips(clips.map(c => c.id));
  } else if (kind === 'draft') quickDraft();
  else if (kind === 'transcribe') $('#btnTranscribeFull').click();
});
