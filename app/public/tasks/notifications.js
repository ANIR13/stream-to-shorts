'use strict';
// Desktop notifications and what happens when a task finishes.

function notify(title, body) {
  try {
    if ('Notification' in window && Notification.permission === 'granted' && document.hidden) new Notification(title, { body });
  } catch { /* ignore */ }
}
function askNotify() {
  try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); } catch { /* ignore */ }
}
function onQueueEmpty() {
  const b = batchJobs();
  S.batchStart = null;
  const done = b.filter(j => j.status === 'done').length, failed = b.filter(j => j.status === 'error').length;
  const cancelled = b.filter(j => j.status === 'cancelled').length;
  if (b.length > 1) {
    const msg = `All tasks finished: ${done} done${failed ? `, ${failed} failed` : ''}${cancelled ? `, ${cancelled} cancelled` : ''}`;
    toast(msg, failed ? 'err' : 'ok', 10000);
    notify('Stream → Shorts', msg);
  } else if (b.length === 1 && b[0].status === 'done') notify('Stream → Shorts', `${b[0].label}: done`);
  if (S.p && currentTab() === 'exports') loadExports();
}
async function onJobFinished(j, othersActive) {
  const other = !S.p || j.slug !== S.p.slug;
  const where = other ? ` (${videoName(j.slug)})` : '';
  const openIt = other ? [{ label: 'Open video', fn: () => { const v = S.videos.find(x => x.slug === j.slug); if (v) openVideo(v.file); } }] : [];
  if (j.status === 'error') toast(`${j.label}${where} failed. ${j.hint || ''}`, 'err', 12000, [{ label: 'Details', fn: () => showJob(j.id) }, ...openIt]);
  else if (j.type === 'draft' && other) {
    // a draft of another video: don't cover the video on screen, offer it instead
    const v = S.videos.find(x => x.slug === j.slug);
    toast(`${j.label}${where} is ready.`, 'ok', 12000, [{ label: 'Watch', fn: () => openVideoModal(`/media/draft/${enc(j.slug)}/${enc(j.clipId)}`, `${j.label}${where} · low-quality preview`) }, ...openIt]);
    return;
  } else if (j.type === 'draft') {
    openVideoModal(`/media/draft/${enc(j.slug)}/${enc(j.clipId)}`, `${j.label} · low-quality preview, not saved to output`);
    if (j.note) toast(j.note, '', 6000);
    return;
  } else if (!othersActive) toast(`${j.label}${where}: done`, 'ok', 5000, openIt);
  if (!S.p || j.slug !== S.p.slug) { loadVideos(); return; }
  if (j.type === 'analyze') { await reloadProject(); await loadAnalysis(); setPlayerSource(false); renderAll(); loadVideos(); }
  else if (j.type === 'transcribe') { await loadTranscript(); renderCaptionsTab(); }
  else if (j.type === 'proxy') { await reloadProject(); setPlayerSource(false); }
  else { await reloadProject(); if (currentTab() === 'exports' || j.type === 'render') loadExports(); }
}
