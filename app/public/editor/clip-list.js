'use strict';
// The clip list: cards, search, filters, sorting, bulk actions, selection.

function clipPills(c) {
  const j = activeJob(c.id);
  const out = [];
  if (j) out.push(j.status === 'running' ? `<span class="pill run">${{ render: 'Rendering', draft: 'Draft', captions: 'Captions' }[j.type] || 'Working'} ${Math.round(j.progress * 100)}%</span>` : `<span class="pill run">Queued</span>`);
  else {
    const last = S.jobs.filter(x => x.clipId === c.id && x.slug === S.p.slug && x.type === 'render').pop();
    if (last && last.status === 'error') out.push(`<span class="pill err" title="${esc(last.hint || last.error)} (details in Tasks)">Failed</span>`);
    else if (last && last.status === 'cancelled') out.push(`<span class="pill warn" title="The render was cancelled. Retry it from Tasks or click Render.">Cancelled</span>`);
    else if (isMissing(c)) out.push(`<span class="pill err" title="The video file of this short was deleted or moved outside the app. Render it again, or put the file back in the output folder.">File missing</span>`);
    else if (isOutdated(c)) out.push(`<span class="pill warn" title="You changed this clip after it was rendered. Render it again to update the video.">Outdated</span>`);
    else if (c.output) out.push(`<span class="pill ok">Rendered</span>`);
  }
  const ov = overlapsOf(c);
  if (ov.length) out.push(`<span class="pill err" title="Shares footage with clip ${ov.map(o => '#' + clipNo(o)).join(', ')}">Overlaps ${ov.map(o => '#' + clipNo(o)).join(' ')}</span>`);
  if (c.end - c.start > 60) out.push(`<span class="pill err" title="Shorts must be 60 s or less">Too long</span>`);
  if (c.layoutMode || c.style) out.push(`<span class="pill" title="This clip has its own layout or style">Custom</span>`);
  if (Array.isArray(c.captions)) out.push(`<span class="pill cc">CC</span>`);
  return out.join('');
}
// Only the sort order is remembered; search and filter start empty so no clip ever looks missing.
S.list = (() => { let sort = 'time'; try { sort = JSON.parse(store.get('clipList') || '{}').s || 'time'; } catch { /* ignore */ } return { q: '', f: 'all', s: sort }; })();
$('#clipFilter').value = S.list.f; $('#clipSort').value = S.list.s;
const lastRenderJob = c => S.jobs.filter(x => x.clipId === c.id && x.slug === S.p.slug && x.type === 'render').pop();
function visibleClips() {
  const q = S.list.q.trim().toLowerCase(), f = S.list.f;
  let list = S.p.clips.filter(c => {
    if (q) {
      const num = q.replace(/^#/, '');
      const hay = [c.title1, c.title2, c.description].filter(Boolean).join(' ').toLowerCase();
      if (!(String(clipNo(c)) === num || hay.includes(q))) return false;
    }
    if (f === 'todo') return !c.output || isMissing(c);
    if (f === 'outdated') return isOutdated(c);
    if (f === 'untitled') return !c.title1 && !c.title2;
    if (f === 'failed') return lastRenderJob(c)?.status === 'error';
    if (f === 'long') return c.end - c.start > 60.05;
    return true;
  });
  if (S.list.s === 'score') list = [...list].sort((a, b) => strengthOf(b) - strengthOf(a));
  else if (S.list.s === 'num') list = [...list].sort((a, b) => clipNo(a) - clipNo(b));
  return list;
}
const saveList = () => store.set('clipList', JSON.stringify({ s: S.list.s }));
$('#clipSearch').addEventListener('input', e => { S.list.q = e.target.value; renderClipList(); });
$('#clipFilter').addEventListener('change', e => { S.list.f = e.target.value; saveList(); renderClipList(); });
$('#clipSort').addEventListener('change', e => { S.list.s = e.target.value; saveList(); renderClipList(); });
function renderClipList() {
  const clips = S.p.clips;
  const shown = visibleClips();
  const filtered = shown.length !== clips.length;
  const nDone = clips.filter(c => c.output && !isMissing(c) && !isOutdated(c)).length, nOld = clips.filter(c => !isMissing(c) && isOutdated(c)).length;
  $('#clipCount').textContent = clips.length ? (filtered ? `(${shown.length}/${clips.length})` : `(${clips.length})`) : '';
  $('#selectAll').checked = shown.length && shown.every(c => c.selected);
  const nSel = clips.filter(c => c.selected).length;
  renderBulk(nSel);
  $('#selInfo').textContent = clips.length ? `${nDone}/${clips.length} rendered${nOld ? ` · ${nOld} outdated` : ''}${nSel ? ` · ${nSel} ticked` : ''}` : '';
  $('#clipList').innerHTML = !clips.length ? '' : !shown.length
    ? `<div class="empty">${esc(tr('No clips match.'))} <button class="btn small ghost" data-clearfilter>${esc(tr('Show all clips'))}</button></div>`
    : shown.map(c => {
    const title = [c.title1, c.title2].filter(Boolean).join(' ');
    const mid = Math.round((c.start + (c.end - c.start) * 0.6) / 5) * 5;
    const d = c.end - c.start;
    return `<div class="clip ${c.id === S.sel ? 'active' : ''}" data-id="${c.id}" tabindex="0" role="button" aria-pressed="${c.id === S.sel}" aria-label="Clip #${clipNo(c)} ${esc(title) || 'Untitled'}, ${fmt(c.start, false)}, ${d.toFixed(0)} seconds">
      <input type="checkbox" data-check ${c.selected ? 'checked' : ''} title="Include in batch render">
      <img loading="lazy" src="/api/frame?slug=${enc(slug())}&t=${mid}&w=192" alt="">
      <div class="meta">
        <div class="title ${title ? '' : 'untitled'}"${title ? ' translate="no"' : ''}>#${clipNo(c)} ${esc(title) || 'Untitled clip'}</div>
        <div class="sub"><span class="mono">${fmt(c.start, false)}</span>· ${d.toFixed(0)}s ${clipPills(c)}</div>
        ${scoreBarHtml(c)}
      </div></div>`;
  }).join('');
  if (!clips.length) $('#clipList').innerHTML = `<div class="empty">No clips yet.<br>Click <b>Analyze video</b>, <b>＋ Add</b>, or drag across the timeline to make one.</div>`;
  renderSetup();
}
$('#clipList').addEventListener('click', e => {
  if (e.target.closest('[data-clearfilter]')) { S.list = { q: '', f: 'all', s: S.list.s }; $('#clipSearch').value = ''; $('#clipFilter').value = 'all'; saveList(); renderClipList(); return; }
  const card = e.target.closest('.clip');
  if (!card) return;
  const c = S.p.clips.find(x => x.id === card.dataset.id);
  if (e.target.matches('[data-check]')) { c.selected = e.target.checked; scheduleSave(); renderClipList(); return; }
  selectClip(c.id, true);
});
$('#clipList').addEventListener('keydown', e => {
  const card = e.target.closest('.clip');
  if (!card || e.target !== card || (e.key !== 'Enter' && e.key !== ' ')) return;
  e.preventDefault(); e.stopPropagation();
  selectClip(card.dataset.id, true);
  $(`.clip[data-id="${card.dataset.id}"]`)?.focus();
});
function renderBulk(nSel) {
  $('#bulkRow').classList.toggle('hidden', !nSel);
  if (!nSel) return;
  const o = (v, t) => `<option value="${esc(v)}">${esc(t)}</option>`;
  const html = o('', nSel > 1 ? `${tr('With the')} ${nSel} ${tr('ticked clips…')}` : tr('With the ticked clip…'))
    + `<optgroup label="${esc(tr('Actions'))}">${o('trim60', tr('Trim to 60 s'))}${o('capOn', tr('Turn captions on'))}${o('capOff', tr('Turn captions off'))}${o('untick', tr('Untick all'))}${o('delete', tr('Delete'))}</optgroup>`
    + `<optgroup label="${esc(tr('Layout'))}">${o('layout:', tr('Project default'))}${o('layout:split', tr('Facecam + Gameplay'))}${o('layout:gameplay', tr('Gameplay only'))}${o('layout:cam', tr('Facecam only'))}</optgroup>`
    + `<optgroup label="${esc(tr('Style'))}">${o('style:', tr('Project style'))}${S.presets.map(p => o('style:' + p.name, p.name)).join('')}</optgroup>`;
  const sel = $('#bulkAction');
  if (sel.dataset.html !== html) { sel.innerHTML = html; sel.dataset.html = html; }
}
$('#bulkAction').addEventListener('change', e => {
  const v = e.target.value; e.target.value = '';
  const ticked = S.p.clips.filter(c => c.selected);
  if (!v || !ticked.length) return;
  let msg = `${ticked.length} ${ticked.length > 1 ? 'clips' : 'clip'} updated`;
  if (v === 'delete') {
    if (!confirm(ticked.length > 1 ? `Delete ${ticked.length} ticked clips? Already-rendered video files are kept.` : 'Delete the ticked clip? Already-rendered video files are kept.')) return;
    S.p.clips = S.p.clips.filter(c => !c.selected);
    if (!S.p.clips.some(c => c.id === S.sel)) S.sel = S.p.clips[0]?.id || null;
    msg = `${ticked.length} ${ticked.length > 1 ? 'clips' : 'clip'} deleted`;
  } else if (v === 'trim60') ticked.forEach(trimTo60);
  else if (v === 'capOn' || v === 'capOff') ticked.forEach(c => { c.captionsOn = v === 'capOn'; });
  else if (v === 'untick') { ticked.forEach(c => { c.selected = false; }); msg = ''; }
  else if (v.startsWith('layout:')) ticked.forEach(c => { const m = v.slice(7); if (m) c.layoutMode = m; else delete c.layoutMode; });
  else if (v.startsWith('style:')) {
    const pr = S.presets.find(p => p.name === v.slice(6));
    ticked.forEach(c => { if (pr) { c.style = { ...pr.style }; c.styleName = pr.name; } else { delete c.style; delete c.styleName; } });
  }
  scheduleSave(); renderAll();
  if (msg) toast(msg + '. ' + tr('Ctrl+Z undoes this.'), 'ok');
});
$('#selectAll').addEventListener('change', e => { visibleClips().forEach(c => c.selected = e.target.checked); scheduleSave(); renderClipList(); }); // ticks only the clips shown

function selectClip(id, doSeek) {
  S.sel = id;
  const c = selClip();
  if (c) {
    const span = S.view[1] - S.view[0];
    if (c.start < S.view[0] || c.end > S.view[1]) {
      const w = Math.max(span, (c.end - c.start) * 1.5);
      const mid = (c.start + c.end) / 2;
      S.view = [clamp(mid - w / 2, 0, Math.max(0, S.p.meta.duration - w)), 0];
      S.view[1] = Math.min(S.p.meta.duration, S.view[0] + w);
    }
    if (doSeek) seek(c.start);
  }
  renderClipList(); renderEditor(); drawTimeline(); drawPreview();
}
function newId() { return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }
$('#btnAddClip').addEventListener('click', () => {
  const t = player.currentTime || 0;
  const start = r1(clamp(t, 0, Math.max(0, S.p.meta.duration - 10)));
  addClipAt(start, r1(Math.min(S.p.meta.duration, start + 45)));
});
function addClipAt(start, end) {
  const c = { id: newId(), start: r1(start), end: r1(end), title1: '', title2: '', selected: true, captionsOn: true, captions: null };
  S.p.clips.push(c);
  S.p.clips.sort((a, b) => a.start - b.start);
  scheduleSave(); selectClip(c.id, false); switchTab('edit');
  saveNow().then(() => { renderClipList(); drawTimeline(); toast(`Clip #${clipNo(c)} created (${(c.end - c.start).toFixed(1)} s). Give it a title.`, 'ok', 2500); });
  $('#fTitle1').focus();
}
