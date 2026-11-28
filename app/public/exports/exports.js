'use strict';
// Exports tab: finished shorts and upload texts.

async function loadExports() {
  if (!S.p) return;
  setVal($('#pubTags'), (S.p.publish && S.p.publish.hashtags) || '');
  const r = await api(`/api/outputs?slug=${enc(slug())}`).catch(() => ({ files: [], other: [] }));
  S.outputs = (r.files || []).sort((a, b) => a.name.localeCompare(b.name));
  S.otherOutputs = (r.other || []).sort((a, b) => a.name.localeCompare(b.name));
  $('#exportsInfo').textContent = S.outputs.length ? `${S.outputs.length} short${S.outputs.length > 1 ? 's' : ''} · ${fmtSize(S.outputs.reduce((a, o) => a + o.size, 0))}` : '';
  const card = (o, other) => {
    const c = other ? null : S.p.clips.find(x => x.output === o.name);
    const src = other ? `/media/output-other/${enc(o.name)}` : `/media/output/${enc(slug())}/${enc(o.name)}`;
    const status = c ? (isOutdated(c) ? '<span class="pill warn">Outdated</span>' : '<span class="pill ok">Up to date</span>') : other ? '' : '<span class="pill">No clip</span>';
    return `<div class="export" data-name="${esc(o.name)}" data-src="${esc(src)}">
      <video src="${src}#t=1" preload="metadata" muted></video>
      <div class="export-meta"><div class="export-name" translate="no">${c ? `<b>#${clipNo(c)}</b> ` : ''}${esc(o.name)}</div>
        <div class="row gap wrap"><span class="muted">${fmtSize(o.size)}</span>${status}</div>
        <div class="row gap">
          ${c ? `<button class="btn small ghost" data-goto="${c.id}">Edit clip</button>` : ''}
        </div>
        <div class="row gap copy-row">
          ${c ? `<button class="btn small ghost" data-copy="title" data-clip="${c.id}">Copy title</button><button class="btn small ghost" data-copy="description" data-clip="${c.id}">Copy description</button>` : ''}
          <button class="icon" data-del="${other ? 'other' : 'mine'}" title="Move to the Recycle Bin" aria-label="Delete ${esc(o.name)}">🗑</button>
        </div></div></div>`;
  };
  $('#exportGrid').innerHTML = (S.outputs.length ? S.outputs.map(o => card(o, false)).join('')
    : '<div class="empty">Nothing rendered yet. Use <b>Render ▾</b> at the top.</div>')
    + (S.otherOutputs.length ? `<h3 class="export-head">Other videos in the output folder (${S.otherOutputs.length})</h3>` + S.otherOutputs.map(o => card(o, true)).join('') : '');
}
$('#exportGrid').addEventListener('click', async e => {
  const el = e.target.closest('.export'); if (!el) return;
  const cp = e.target.closest('[data-copy]');
  if (cp) {
    await saveNow();
    try {
      const u = await api(`/api/upload-text?slug=${enc(slug())}&clipId=${enc(cp.dataset.clip)}`);
      await navigator.clipboard.writeText(u[cp.dataset.copy]);
      toast(tr(cp.dataset.copy === 'title' ? 'Title copied' : 'Description copied'), 'ok', 1500);
    } catch (err) { toast(err.message || tr('Could not copy. Select the text instead.'), 'err'); }
    return;
  }
  const goto = e.target.closest('[data-goto]'), del = e.target.closest('[data-del]');
  if (goto) { selectClip(goto.dataset.goto, true); switchTab('edit'); return; }
  if (del) {
    if (!confirm(`Move "${el.dataset.name}" to the Recycle Bin?`)) return;
    try {
      await api('/api/outputs/delete', { method: 'POST', body: { slug: slug(), name: el.dataset.name, other: del.dataset.del === 'other' } });
      toast('Moved to the Recycle Bin', 'ok');
      await reloadProject(); loadExports();
    } catch (err) { toast(err.message, 'err'); }
    return;
  }
  openVideoModal(el.dataset.src, el.dataset.name);
});
$('#pubTags').addEventListener('input', e => { S.p.publish = { ...(S.p.publish || {}), hashtags: e.target.value }; scheduleSave(); });
$('#btnWriteTxt').addEventListener('click', async () => {
  await saveNow();
  try { const r = await api('/api/upload-text/write', { method: 'POST', body: { slug: slug() } }); toast(`${r.count} upload ${r.count === 1 ? 'text' : 'texts'} updated`, 'ok'); }
  catch (e) { toast(e.message, 'err'); }
});
$('#btnOpenOutput').addEventListener('click', () => api('/api/open', { method: 'POST', body: { what: 'output', slug: slug() } }));
