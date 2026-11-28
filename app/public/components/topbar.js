'use strict';
// Top bar: video picker, analyze, import.

$('#videoSelect').addEventListener('change', e => openVideo(e.target.value));
$('#btnRefreshVideos').addEventListener('click', loadVideos);
$('#welcomeList').addEventListener('click', e => { const it = e.target.closest('[data-file]'); if (it) openVideo(it.dataset.file); });
$('#btnAnalyze').addEventListener('click', async () => {
  if (!S.p) return toast('Choose a video first', 'err');
  if (S.p.analyzed && !confirm('Analyze again? Your clips are kept.')) return;
  await saveNow();
  try { await api('/api/analyze', { method: 'POST', body: { slug: slug() } }); toast('Analyzing. This takes a few minutes for long streams.'); $('#jobsDrawer').classList.remove('hidden'); pollSoon(); }
  catch (e) { toast(e.message, 'err'); }
});
$('#fileImport').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) importFile(f); });
const VIDEO_RE = /\.(mkv|mp4|mov|webm|flv|avi|ts|m4v)$/i;
function importFile(f) {
  const asset = /\.(png|jpe?g|webp|mp3|wav|m4a|aac|ogg|flac|opus)$/i.test(f.name);   // pictures and music for the Tracks tab
  if (!VIDEO_RE.test(f.name) && !asset) return toast(tr('Only video files can be imported') + ' (.mkv, .mp4, .mov, .webm, .flv, .avi, .ts, .m4v)', 'err');
  const t = toast(`Importing ${f.name}… 0%`, '', 0);
  const xhr = new XMLHttpRequest();
  xhr.open('PUT', `/api/upload?name=${enc(f.name)}`);
  xhr.upload.onprogress = ev => { if (ev.lengthComputable) t.textContent = `Importing ${f.name}… ${Math.round(ev.loaded / ev.total * 100)}%`; };
  xhr.onload = async () => {
    t.remove();
    if (xhr.status !== 200) { let m = 'Import failed'; try { m = JSON.parse(xhr.responseText).error; } catch { /* ignore */ } return toast(m, 'err'); }
    if (asset) { await loadAssets(); renderTracksTab(); return toast(`${tr('Added to the Tracks tab')}: ${f.name}`, 'ok'); }
    await loadVideos(); openVideo(f.name);
  };
  xhr.onerror = () => { t.remove(); toast('Import failed', 'err'); };
  xhr.send(f);
}
// drop a video anywhere on the window
let dragDepth = 0;
