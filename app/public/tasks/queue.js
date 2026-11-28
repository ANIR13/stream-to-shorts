'use strict';
// Polling the task queue, batches and time left.

let pollTimer = null;
function pollSoon() { clearTimeout(pollTimer); pollTimer = setTimeout(pollJobs, 150); }
async function pollJobs() {
  let list = [];
  try { list = await api('/api/jobs'); } catch {
    S.failCount = (S.failCount || 0) + 1;
    if (S.failCount >= 2 && !S.offline) {
      S.offline = true;
      showBanner('offline', 'err', 'The app has stopped: its black window was closed. Rendering is paused and edits can\'t be saved. Double-click start.bat to start it again. This page reconnects by itself and offers to resume your tasks.');
    }
    clearTimeout(pollTimer); pollTimer = setTimeout(pollJobs, 3000); return;
  }
  S.failCount = 0;
  if (S.offline) {
    S.offline = false; hideBanner('offline'); toast('Reconnected to the app', 'ok');
    S.status = await api('/api/status').catch(() => S.status);
    if (S.p) await reloadProject().catch(() => {});
    checkInterrupted();
  }
  const prev = new Map(S.jobs.map(j => [j.id, j.status]));
  const wasActive = S.jobs.some(isActiveJob);
  S.jobs = list;
  const active = list.some(isActiveJob);
  if (S.jobsReady) for (const j of list) {
    const was = prev.get(j.id);
    // Also announce tasks that started and finished between two checks (e.g. a quick failure).
    const justFinished = was ? was !== j.status : (j.finished && Date.now() - j.finished < 15000);
    if (justFinished && ['done', 'error'].includes(j.status)) onJobFinished(j, active);
  }
  if (S.jobsReady && wasActive && !active) onQueueEmpty();
  if (active && !S.batchStart) S.batchStart = Math.min(...list.filter(isActiveJob).map(j => j.created));
  S.jobsReady = true;
  renderJobs();
  if (S.p && (active || prev.size !== list.length)) { renderClipList(); renderCaptionStatus(); }
  clearTimeout(pollTimer);
  pollTimer = setTimeout(pollJobs, active ? 700 : 2500);
}
const isActiveJob = j => j.status === 'queued' || j.status === 'running';
// Jobs that belong to the current batch: everything created since the batch began.
const batchJobs = () => S.batchStart ? S.jobs.filter(j => j.created >= S.batchStart) : [];
function batchInfo() {
  const b = batchJobs();
  if (!b.length) return null;
  const done = b.filter(j => j.status === 'done').length, failed = b.filter(j => j.status === 'error').length;
  const cancelled = b.filter(j => j.status === 'cancelled').length;
  const live = b.filter(j => !['cancelled'].includes(j.status));
  const running = b.find(j => j.status === 'running'), queued = b.filter(j => j.status === 'queued');
  // Time estimate from finished tasks of the same type (any batch), else from the running task's speed.
  const avg = type => {
    const fin = S.jobs.filter(j => j.type === type && j.status === 'done' && j.started && j.finished);
    if (fin.length) return fin.reduce((a, j) => a + (j.finished - j.started), 0) / fin.length;
    if (running && running.type === type && running.progress > 0.05) return (Date.now() - running.started) / running.progress;
    return null;
  };
  let left = 0, known = true;
  for (const j of [running, ...queued].filter(Boolean)) {
    const a = avg(j.type);
    if (a == null) { known = false; continue; }
    left += j === running ? Math.max(0, a - (Date.now() - j.started)) : a;
  }
  const finished = done + failed;
  const total = live.length;
  const frac = total ? (finished + (running ? running.progress : 0)) / total : 1;
  return { total, finished, done, failed, cancelled, running, left: known ? left : null, frac };
}
const fmtLeft = ms => { const m = Math.round(ms / 60000); return m < 1 ? 'under a minute' : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; };
function renderBatch() {
  const el = $('#batchState'), sum = $('#jobSummary');
  const b = S.jobs.some(isActiveJob) ? batchInfo() : null;
  if (!b || !b.total) {
    el.classList.add('hidden'); sum.classList.add('hidden'); document.title = 'Stream to Shorts'; return;
  }
  const kind = b.running ? ({ proxy: 'Building preview', render: 'Rendering', draft: 'Quick draft', captions: 'Captions', analyze: 'Analyzing', transcribe: 'Transcribing' }[b.running.type] || 'Working') : 'Waiting';
  const pos = Math.min(b.total, b.finished + 1);
  const left = b.left != null ? (b.left < 60000 ? ' · less than a minute left' : ` · about ${fmtLeft(b.left)} left`) : '';
  const busy = b.running && S.p && b.running.slug !== S.p.slug ? ` · ${videoName(b.running.slug)}` : '';
  const text = `${kind} ${pos}/${b.total}${busy}${left}`;
  el.innerHTML = `<span>${esc(text)}</span><i style="width:${Math.round(b.frac * 100)}%"></i>`;
  el.classList.remove('hidden');
  sum.innerHTML = `<b>${esc(text)}</b><div class="progress"><i style="width:${Math.round(b.frac * 100)}%"></i></div>`
    + `<div class="muted small">${b.done} done${b.failed ? ` · ${b.failed} failed` : ''}${b.cancelled ? ` · ${b.cancelled} cancelled` : ''} · runs on this PC, keep the black window open</div>`;
  sum.classList.remove('hidden');
  document.title = `(${b.finished}/${b.total}) Stream to Shorts`;
}
