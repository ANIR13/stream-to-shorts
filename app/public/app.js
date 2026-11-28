'use strict';
// Stream → Shorts interface. Start-up. Every other script is loaded before this one (see index.html).
// The interface is split by feature into the folders next to this file (core, editor, preview, ai,
// tasks, exports, settings, components). They are plain scripts that share one global scope and run
// in the order of the <script> tags in index.html; see docs/ARCHITECTURE.md#browser-interface.

// Start-up steps that use code from several files run here, after every file has loaded.
setPlayerSize(SIZES.includes(store.get('playerSize')) ? store.get('playerSize') : (window.innerHeight < 820 ? 's' : 'm'));

(async function boot() {
  try { S.status = await api('/api/status'); } catch { toast('Cannot reach the local server. Is start.bat running?', 'err', 0); return; }
  await loadVideos();
  loadPresets();
  pollJobs();
  checkInterrupted();
  const last = store.get('lastVideo');
  const pick = S.videos.find(v => v.file === last) || (S.videos.length === 1 ? S.videos[0] : null);
  if (pick) openVideo(pick.file); else showWelcome();
})();
