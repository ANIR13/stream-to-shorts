'use strict';
// The video list, opening a video, and keeping each video's place (clip, zoom, tab, playhead).

async function loadVideos() {
  S.videos = await api('/api/videos');
  const sel = $('#videoSelect');
  sel.innerHTML = `<option value="">Choose a video…</option>` + S.videos.map(v =>
    `<option value="${esc(v.file)}">${esc(v.file)} · ${fmtSize(v.size)}${v.analyzed ? ' · analyzed' : ''}</option>`).join('');
  if (S.p) sel.value = S.p.video;
  renderProjectTabs();
  $('#welcomeList').innerHTML = S.videos.length
    ? S.videos.map(v => `<div class="welcome-item" data-file="${esc(v.file)}"><div><b translate="no">${esc(v.file)}</b><div class="muted small">${fmtSize(v.size)}${v.duration ? ' · ' + fmt(v.duration, false) : ''}${v.clips ? ` · ${v.clips} clips · ${v.rendered} rendered` : v.analyzed ? ' · analyzed' : v.hasProject ? ' · started' : ' · new'}</div></div><button class="btn primary small">${v.hasProject ? 'Continue' : 'Start project'}</button></div>`).join('')
    : `<div class="empty">No videos yet. Put a video in the <code>source</code> folder or click <b>＋ Import video</b>.</div>`;
}
function showWelcome() { $('#welcome').classList.remove('hidden'); $('#app').classList.add('hidden'); }

// ---- several videos: each keeps its own place (clip, zoom, tab, playhead) and undo history ----
const HIST = new Map();
function rememberUi() {
  if (!S.p) return;
  store.set('ui:' + S.p.slug, JSON.stringify({ sel: S.sel, view: S.view, tab: currentTab(), t: player.currentTime || 0 }));
  HIST.set(S.p.slug, { past: H.past, future: H.future });
}
const OPEN_KEY = 'openVideos';
function openList() { try { const l = JSON.parse(store.get(OPEN_KEY) || '[]'); return Array.isArray(l) ? l : []; } catch { return []; } }
function setOpenList(l) { store.set(OPEN_KEY, JSON.stringify(l.slice(-6))); }
const videoName = sl => { const v = S.videos.find(x => x.slug === sl); return v ? tabName(v.file, S.videos.map(x => x.file)) : sl; };

async function openVideo(file) {
  if (!file) return showWelcome();
  if (S.p && S.p.video === file) { $('#welcome').classList.add('hidden'); $('#app').classList.remove('hidden'); return; }
  await saveNow();
  if (S.conflict) { if (S.p) $('#videoSelect').value = S.p.video; return toast('First choose which version to keep (message at the top), then switch videos.', 'err', 6000); }
  rememberUi();
  const t = toast('Opening video…', '', 0);
  let p;
  try { p = await api(`/api/project?video=${enc(file)}`); }
  catch (e) { t.remove(); toast(e.message, 'err'); if (S.p) $('#videoSelect').value = S.p.video; return; }
  t.remove();
  S.p = p;
  const h = HIST.get(p.slug);
  if (h) { H.past = h.past; H.future = h.future; rebaseHistory(); } else resetHistory();
  store.set('lastVideo', file);
  const ol = openList(); if (!ol.includes(file)) { ol.push(file); setOpenList(ol); }
  hideBanner('conflict'); hideBanner('twotabs'); S.conflict = false;
  bcPost({ type: 'open', video: file });
  $('#videoSelect').value = file;
  $('#welcome').classList.add('hidden');
  $('#app').classList.remove('hidden');
  $('#detectPop')?.remove(); closeModal();
  let ui = null; try { ui = JSON.parse(store.get('ui:' + p.slug) || 'null'); } catch { /* ignore */ }
  const dur = p.meta.duration;
  S.view = ui && Array.isArray(ui.view) && ui.view[1] > ui.view[0] && ui.view[1] <= dur + 1 ? ui.view : [0, dur];
  S.sel = ui && p.clips.some(c => c.id === ui.sel) ? ui.sel : (p.clips[0]?.id || null);
  const t0 = ui && Number.isFinite(ui.t) ? ui.t : (p.clips.find(c => c.id === S.sel)?.start || 0);
  await Promise.all([loadAnalysis(), loadTranscript()]);
  setPlayerSource(true);
  player.addEventListener('loadedmetadata', () => seek(t0), { once: true });
  switchTab(ui && ui.tab ? ui.tab : 'edit');
  renderAll();
  renderProjectTabs();
  loadVideos().catch(() => {}); // refresh the other videos' progress in the videos bar
  if (!p.analyzed) toast('Tip: click "Analyze video" to find the best moments automatically.', '', 6000);
}
// Name without extension, unless another open video has the same name (then show the extension too).
const baseName = f => f.replace(/\.[^.]+$/, '');
const tabName = (f, list) => list.some(o => o !== f && baseName(o) === baseName(f)) ? f : baseName(f);
// Bar of the videos you're working on, with each one's progress and running tasks.
function renderProjectTabs() {
  const el = $('#projectTabs');
  const list = openList().filter(f => S.videos.some(v => v.file === f));
  el.classList.toggle('hidden', list.length < 2);
  if (list.length < 2) { el.innerHTML = ''; return; }
  const html = list.map(f => {
    const v = S.videos.find(x => x.file === f), cur = !!(S.p && S.p.video === f);
    const clips = cur ? S.p.clips.length : v.clips, done = cur ? S.p.clips.filter(c => c.output).length : v.rendered;
    const act = S.jobs.filter(j => j.slug === v.slug && isActiveJob(j)), run = act.find(j => j.status === 'running');
    const status = act.length
      ? `<span class="pt-run">${run ? ({ render: 'rendering', draft: 'draft', captions: 'captions', analyze: 'analyzing', transcribe: 'transcribing' }[run.type] || 'working') + ' ' + Math.round(run.progress * 100) + '%' : 'queued'}${act.length > 1 ? ` · ${act.length} tasks` : ''}</span>`
      : `<span class="muted">${clips ? `${done}/${clips} rendered` : v.analyzed ? 'analyzed, no clips' : 'not analyzed'}</span>`;
    return `<div class="pt ${cur ? 'active' : ''}" role="tab" aria-selected="${cur}" tabindex="0" data-file="${esc(f)}" title="${esc(f)}">
      <b translate="no">${esc(tabName(f, list))}</b>${status}
      <button class="icon pt-close" data-closetab="${esc(f)}" aria-label="Remove ${esc(f)} from this bar" title="Remove from this bar (its project is kept)">✕</button></div>`;
  }).join('') + '<button class="btn small ghost pt-add" id="btnAddVideoTab" title="Open another video">＋ Video</button>';
  if (el.dataset.html !== html) { el.innerHTML = html; el.dataset.html = html; }
}
$('#projectTabs').addEventListener('click', e => {
  const close = e.target.closest('[data-closetab]');
  if (close) { setOpenList(openList().filter(f => f !== close.dataset.closetab)); renderProjectTabs(); return; }
  if (e.target.closest('#btnAddVideoTab')) { $('#videoSelect').focus(); $('#videoSelect').showPicker?.(); return; }
  const tab = e.target.closest('.pt'); if (tab) openVideo(tab.dataset.file);
});
$('#projectTabs').addEventListener('keydown', e => {
  const tab = e.target.closest('.pt');
  if (tab && e.target === tab && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.stopPropagation(); openVideo(tab.dataset.file); }
});
async function loadAnalysis() {
  S.analysis = S.p.analyzed ? await api(`/api/analysis?slug=${enc(slug())}`).catch(() => null) : null;
  S.loudNorm = null;
  if (S.analysis) {
    const e = S.analysis.rms.map(d => Math.pow(10, d / 10));
    const sm = e.map((_, i) => { let s = 0, n = 0; for (let k = i - 2; k <= i + 2; k++) if (k >= 0 && k < e.length) { s += e[k]; n++; } return 10 * Math.log10(s / n + 1e-12); });
    const sorted = [...sm].sort((a, b) => a - b);
    const lo = sorted[Math.floor(sorted.length * 0.05)], hi = sorted[sorted.length - 1];
    S.loudNorm = sm.map(v => clamp((v - lo) / (hi - lo || 1), 0, 1));
  }
}
async function loadTranscript() {
  S.transcript = await api(`/api/transcript?slug=${enc(slug())}`).catch(() => null);
}
function setPlayerSource(force) {
  const src = S.p.hasProxy ? `/media/proxy/${enc(slug())}?v=${S.p.proxyVer || 0}` : `/media/source/${enc(slug())}`;
  const note = $('#playerNote');
  note.classList.toggle('hidden', S.p.hasProxy);
  note.textContent = 'Playing the original file. Click "Analyze video" to build a fast, smooth preview.';
  if (force || player.dataset.src !== src) {
    const t = player.currentTime || 0;
    player.src = src; player.dataset.src = src;
    player.addEventListener('loadedmetadata', () => { player.currentTime = t; }, { once: true });
  }
}
player.addEventListener('error', () => {
  const note = $('#playerNote');
  note.classList.remove('hidden');
  note.textContent = 'The browser can\'t play this file directly. Click "Analyze video" to build a preview. Rendering works either way.';
});
