'use strict';
// The Tasks panel: progress, details, retry.

function renderJobs() {
  const active = S.jobs.filter(isActiveJob).length;
  const b = $('#jobsBadge'); b.textContent = active; b.classList.toggle('hidden', !active);
  renderBatch();
  renderProjectTabs();
  const nCancelled = S.jobs.filter(j => j.status === 'cancelled').length, nFailed = S.jobs.filter(j => j.status === 'error').length;
  $('#btnRetryCancelled').textContent = `↻ Retry ${nCancelled} cancelled`;
  $('#btnRetryCancelled').classList.toggle('hidden', !nCancelled);
  $('#btnRetryFailed').textContent = `↻ Retry ${nFailed} failed`;
  $('#btnRetryFailed').classList.toggle('hidden', !nFailed);
  $('#btnCancelAll').classList.toggle('hidden', active < 2);
  // Fixed order (oldest first) so rows never move under the mouse while tasks progress.
  const list = [...S.jobs].sort((a, b2) => a.id - b2.id);
  const slugs = [...new Set(list.map(j => j.slug))];
  const grouped = slugs.length > 1 || (S.p && slugs.length === 1 && slugs[0] !== S.p.slug);
  const ordered = grouped ? slugs.flatMap(sl => list.filter(j => j.slug === sl)) : list;
  const head = (j, i) => grouped && (i === 0 || ordered[i - 1].slug !== j.slug)
    ? `<div class="job-group"><b>${esc(videoName(j.slug))}</b>${S.p && j.slug === S.p.slug ? ' <span class="muted">(open now)</span>' : ` <button class="btn small ghost" data-openvideo="${esc(j.slug)}">Open</button>`}</div>` : '';
  const html = list.length ? ordered.map((j, i) => head(j, i) + `
    <div class="job ${j.status}" id="job-${j.id}">
      <div class="top"><b>${esc(j.label)}</b><span class="muted">${{ running: Math.round(j.progress * 100) + '%', queued: 'queued', done: '✓ done', error: 'failed', cancelled: 'cancelled' }[j.status]}</span></div>
      ${isActiveJob(j) ? `<div class="progress"><i style="width:${Math.round(j.progress * 100)}%"></i></div>` : ''}
      <div class="row between"><div class="msg ${j.status === 'error' ? 'err' : ''}">${esc(j.status === 'error' ? (j.hint || 'Failed') : j.status === 'running' ? j.message : j.status === 'done' && j.started ? `took ${fmt((j.finished - j.started) / 1000, false)}` : '')}</div>
      ${isActiveJob(j) ? `<button class="btn small ghost" data-cancel="${j.id}" title="Stop this task">Cancel</button>`
        : ['cancelled', 'error'].includes(j.status) ? `<button class="btn small ghost" data-retry="${j.id}">↻ Retry</button>` : ''}</div>
      ${j.status === 'error' ? `<details class="err-details" data-job="${j.id}"><summary>Technical details</summary><pre>${esc(j.error)}</pre><button class="btn small ghost" data-copy="${j.id}">Copy</button></details>` : ''}
    </div>`).join('') : '<div class="empty">No tasks yet.</div>';
  const el = $('#jobList');
  if (el.dataset.html !== html) {
    const open = $$('#jobList details[open]').map(d => d.dataset.job); // keep expanded details open across refreshes
    el.innerHTML = html; el.dataset.html = html;
    open.forEach(id => { const d = el.querySelector(`details[data-job="${id}"]`); if (d) d.open = true; });
  }
}
function showJob(id) {
  $('#jobsDrawer').classList.remove('hidden');
  const row = $(`#job-${id}`); if (!row) return;
  const d = row.querySelector('details'); if (d) d.open = true;
  row.scrollIntoView({ block: 'nearest' }); row.classList.add('flash'); setTimeout(() => row.classList.remove('flash'), 1200);
}
$('#jobList').addEventListener('click', async e => {
  const ov = e.target.dataset.openvideo;
  if (ov) { const v = S.videos.find(x => x.slug === ov); if (v) { $('#jobsDrawer').classList.add('hidden'); openVideo(v.file); } return; }
  const copy = e.target.dataset.copy;
  if (copy) {
    const j = S.jobs.find(x => x.id === +copy);
    try { await navigator.clipboard.writeText(`${j.label}\n${j.error}`); toast('Error copied', 'ok', 1500); } catch { toast('Could not copy. Select the text instead.', 'err'); }
    return;
  }
  const cancel = e.target.dataset.cancel, retry = e.target.dataset.retry;
  if (cancel) {
    const j = S.jobs.find(x => x.id === +cancel);
    if (!confirm(`Cancel "${j ? j.label : 'this task'}"?${j && j.status === 'running' ? '\nThe progress of this task will be lost.' : ''}`)) return;
    await api('/api/jobs/cancel', { method: 'POST', body: { id: +cancel } }); pollSoon();
  } else if (retry) {
    const r = await api('/api/jobs/retry', { method: 'POST', body: { id: +retry } }).catch(err => { toast(err.message, 'err'); return null; });
    if (r && !r.length) toast('That task is already queued', '');
    pollSoon();
  }
});
async function retryStatus(status) {
  try {
    const r = await api('/api/jobs/retry', { method: 'POST', body: { status } });
    toast(`${r.length} task${r.length === 1 ? '' : 's'} added back to the queue`, 'ok');
    askNotify(); pollSoon();
  } catch (e) { toast(e.message, 'err'); }
}
$('#btnRetryCancelled').addEventListener('click', () => retryStatus('cancelled'));
$('#btnRetryFailed').addEventListener('click', () => retryStatus('error'));
$('#btnCancelAll').addEventListener('click', async () => {
  const n = S.jobs.filter(isActiveJob).length;
  if (!confirm(`Cancel all ${n} tasks? You can retry them afterwards.`)) return;
  await api('/api/jobs/cancel', { method: 'POST', body: { all: true } }); pollSoon();
});
$('#batchState').addEventListener('click', () => $('#jobsDrawer').classList.remove('hidden'));
$('#btnJobs').addEventListener('click', () => $('#jobsDrawer').classList.toggle('hidden'));
$('#btnCloseJobs').addEventListener('click', () => $('#jobsDrawer').classList.add('hidden'));
$('#btnClearJobs').addEventListener('click', async () => { await api('/api/jobs/clear', { method: 'POST', body: {} }); pollSoon(); });
