'use strict';
/* global Layout */
// ---------------- utils ----------------
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const r1 = v => Math.round(v * 10) / 10;
const enc = encodeURIComponent;
function fmt(t, dec = true) {
  t = Math.max(0, t || 0);
  const h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s = t % 60;
  const ss = dec ? s.toFixed(1).padStart(4, '0') : String(Math.floor(s)).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
function parseTime(str) {
  const parts = String(str).trim().split(':').map(Number);
  if (parts.some(n => !Number.isFinite(n))) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}
const fmtSize = b => b > 1e9 ? (b / 1e9).toFixed(2) + ' GB' : (b / 1e6).toFixed(1) + ' MB';
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};

async function api(path, opts = {}) {
  const init = { method: opts.method || 'GET', headers: {} };
  if (opts.body !== undefined) { init.body = JSON.stringify(opts.body); init.headers['Content-Type'] = 'application/json'; }
  const res = await fetch(path, init);
  const data = await res.json().catch(() => null);
  if (!res.ok) { const err = new Error((data && data.error) || `Request failed (${res.status})`); err.status = res.status; throw err; }
  return data;
}
function toast(msg, kind = '', ms = 3500, actions = []) {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  for (const a of actions) {
    const b = document.createElement('button');
    b.className = 'btn small ghost'; b.textContent = a.label;
    b.addEventListener('click', () => { el.remove(); a.fn(); });
    el.appendChild(b);
  }
  $('#toasts').appendChild(el);
  if (ms) setTimeout(() => el.remove(), ms);
  return el;
}

// Persistent messages under the top bar, one per id.
function showBanner(id, kind, text, actions = []) {
  let el = document.querySelector(`.banner[data-id="${id}"]`);
  if (!el) { el = document.createElement('div'); el.className = 'banner'; el.dataset.id = id; el.setAttribute('role', kind === 'err' ? 'alert' : 'status'); $('#banners').appendChild(el); }
  el.className = `banner ${kind}`;
  el.innerHTML = `<span>${esc(text)}</span>`;
  for (const a of actions) {
    const b = document.createElement('button');
    b.className = `btn small ${a.primary ? 'primary' : 'ghost'}`; b.textContent = a.label;
    b.addEventListener('click', async () => { if (!a.keep) el.remove(); await a.fn(); });
    el.appendChild(b);
  }
}
function hideBanner(id) { document.querySelector(`.banner[data-id="${id}"]`)?.remove(); }

// ---------------- state ----------------
const S = {
  status: null, videos: [], p: null, analysis: null, loudNorm: null, transcript: null,
  sel: null, jobs: [], jobsReady: false, view: [0, 1], playUntil: null, dirty: false, outputs: [], otherOutputs: [], presets: [],
};
const clipNo = c => c.num || (S.p.clips.indexOf(c) + 1);
const eff = c => Layout.effective(S.p, c);
// A rendered short is outdated when anything that affects the video changed after it was rendered.
const isOutdated = c => !!(c.output && c.renderSig && c.renderSig !== Layout.renderSig(S.p, c));
// A short deleted outside the app (flagged by the server) needs rendering again.
const isMissing = c => !!(c.output && c.outputMissing);
const needsRender = c => !c.output || isMissing(c) || isOutdated(c);
function overlapsOf(c) {
  return S.p.clips.filter(o => o !== c && o.start < c.end - 0.05 && o.end > c.start + 0.05);
}
const player = $('#player');
const selClip = () => S.p && S.p.clips.find(c => c.id === S.sel);
const slug = () => S.p.slug;
const activeJob = clipId => S.jobs.find(j => j.clipId === clipId && j.slug === S.p?.slug && ['queued', 'running'].includes(j.status));

// ---------------- saving ----------------
let saveTimer = null;
function setSave(t) { $('#saveState').textContent = t; }
function scheduleSave() {
  recordHistory();
  S.dirty = true; setSave('Unsaved…');
  clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 500);
}
// ---------------- undo / redo ----------------
// Snapshots of what the user edits (clips, layout, style, caption settings). Results produced by the
// app itself (rendered files, generated captions, clip numbers) are never undone.
const SERVER_ONLY = ['output', 'renderedAt', 'renderSig', 'captionsVer', 'num'];
const H = { past: [], future: [], last: null, lastAt: 0, lastLabel: '' };
function takeSnap() {
  const json = JSON.stringify({ layout: S.p.layout, style: S.p.style, whisper: S.p.whisper, clips: S.p.clips });
  const st = JSON.parse(json);
  st.clips.forEach(c => SERVER_ONLY.forEach(k => delete c[k]));
  return { json, key: JSON.stringify(st) };
}
function describeChange(a, b) {
  const n = c => '#' + (c.num || '?');
  if (b.clips.length > a.clips.length) return 'add clip';
  if (b.clips.length < a.clips.length) { const gone = a.clips.find(c => !b.clips.some(x => x.id === c.id)); return gone ? `delete clip ${n(gone)}` : 'delete clip'; }
  for (const c of b.clips) {
    const o = a.clips.find(x => x.id === c.id);
    if (!o) return 'clip changes';
    if (o.start !== c.start || o.end !== c.end) return `timing of ${n(c)}`;
    if (o.title1 !== c.title1 || o.title2 !== c.title2) return `title of ${n(c)}`;
    if (JSON.stringify(o.captions) !== JSON.stringify(c.captions)) return `captions of ${n(c)}`;
    if (o.captionsOn !== c.captionsOn || o.layoutMode !== c.layoutMode || o.styleName !== c.styleName || JSON.stringify(o.style) !== JSON.stringify(c.style)) return `settings of ${n(c)}`;
    if (o.selected !== c.selected) return 'clip ticks';
  }
  if (JSON.stringify(a.layout) !== JSON.stringify(b.layout)) return 'layout';
  if (JSON.stringify(a.style) !== JSON.stringify(b.style)) return 'style';
  if (JSON.stringify(a.whisper) !== JSON.stringify(b.whisper)) return 'caption settings';
  return 'edit';
}
// Called on every edit. Quick repeats of the same kind of edit (typing, dragging a slider) become one step.
function recordHistory() {
  if (!S.p || !H.last) return;
  const cur = takeSnap();
  if (cur.key === H.last.key) { H.last = cur; return; }
  const label = describeChange(JSON.parse(H.last.json), JSON.parse(cur.json));
  const now = Date.now();
  if (!(label === H.lastLabel && now - H.lastAt < 1200 && H.past.length)) {
    H.past.push({ ...H.last, label });
    if (H.past.length > 100) H.past.shift();
  }
  H.future = [];
  H.last = cur; H.lastAt = now; H.lastLabel = label;
  renderUndo();
}
// The project was replaced by the app (job finished, other tab, …): continue from the new state.
function rebaseHistory() { if (!S.p) return; H.last = takeSnap(); H.lastLabel = ''; renderUndo(); }
function resetHistory() { H.past = []; H.future = []; rebaseHistory(); }
// A one-click action done on the server (auto-detect, word fixes): make it undoable as one step.
function pushAction(label) {
  if (!S.p) return;
  recordHistory();
  H.past.push({ ...(H.last || takeSnap()), label }); H.future = []; H.lastLabel = '';
}
function applySnap(snap) {
  const st = JSON.parse(snap.json);
  const cur = new Map(S.p.clips.map(c => [c.id, c]));
  S.p.layout = st.layout; S.p.style = st.style; S.p.whisper = st.whisper;
  S.p.clips = st.clips.map(c => {
    const o = cur.get(c.id);
    if (o) {
      for (const k of SERVER_ONLY) c[k] = o[k];
      // Captions the app generated after this point are kept (undo only reverts your own text edits).
      if (Array.isArray(o.captions) && !Array.isArray(c.captions)) { c.captions = o.captions; c.captionsRange = o.captionsRange; }
    }
    return c;
  });
  if (!S.p.clips.some(c => c.id === S.sel)) S.sel = S.p.clips[0]?.id || null;
}
function stepHistory(from, to, verb) {
  recordHistory();
  while (from.length) {
    const e = from.pop();
    const now = takeSnap();
    if (e.key === now.key) continue; // nothing actually changed in that step
    to.push({ ...now, label: e.label });
    applySnap(e);
    H.last = takeSnap(); H.lastLabel = '';
    S.dirty = true; setSave('Unsaved…'); clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 300);
    $('#chunkList').dataset.for = '';
    renderAll(); renderUndo();
    keyFeedback(`${verb}: ${e.label}`);
    return;
  }
  renderUndo();
  keyFeedback(`Nothing to ${verb === 'Undone' ? 'undo' : 'redo'}`);
}
const undo = () => stepHistory(H.past, H.future, 'Undone');
const redo = () => stepHistory(H.future, H.past, 'Redone');
function renderUndo() {
  const u = $('#btnUndo'), r = $('#btnRedo');
  const pu = H.past[H.past.length - 1], pr = H.future[H.future.length - 1];
  u.disabled = !pu; r.disabled = !pr;
  u.title = pu ? `Undo ${pu.label} (Ctrl+Z)` : 'Nothing to undo';
  r.title = pr ? `Redo ${pr.label} (Ctrl+Y)` : 'Nothing to redo';
  u.setAttribute('aria-label', u.title); r.setAttribute('aria-label', r.title);
}
$('#btnUndo').addEventListener('click', () => undo());
$('#btnRedo').addEventListener('click', () => redo());

let saving = null;
async function saveNow(force = false) {
  clearTimeout(saveTimer);
  while (saving) await saving.catch(() => {}); // one save at a time, so each one is based on the latest revision
  if (!S.dirty || !S.p || (S.conflict && !force)) return;
  S.dirty = false; setSave('Saving…');
  saving = (async () => {
    try {
      const p = await api('/api/project', { method: 'POST', body: { slug: S.p.slug, project: S.p, force } });
      S.p.rev = p.rev;
      for (const c of p.clips) { const l = S.p.clips.find(x => x.id === c.id); if (l) { l.output = c.output; l.renderedAt = c.renderedAt; l.renderSig = c.renderSig; l.num = c.num; } }
      if (S.conflict) { S.conflict = false; hideBanner('conflict'); }
      setSave(S.dirty ? 'Unsaved…' : 'Saved ✓');
      bcPost({ type: 'saved', video: S.p.video, rev: p.rev });
    } catch (e) {
      S.dirty = true;
      if (e.status === 409) { S.conflict = true; setSave('Not saved'); showConflict(); }
      else { setSave(S.offline ? 'Not saved (app stopped)' : 'Save failed'); if (!S.offline) toast(e.message, 'err'); }
    }
  })();
  try { await saving; } finally { saving = null; }
}
function showConflict() {
  showBanner('conflict', 'err', 'This video was changed in another tab or window, so your latest edits here were not saved.', [
    { label: 'Load the other version', fn: async () => { S.dirty = false; S.conflict = false; S.p = await api(`/api/project?video=${enc(S.p.video)}`); rebaseHistory(); renderAll(); setSave('Saved ✓'); } },
    { label: 'Keep my version', primary: true, fn: () => saveNow(true) },
  ]);
}
// Tabs showing the same video tell each other about opens and saves.
const TAB = Math.random().toString(36).slice(2);
let bc = null;
try { bc = new BroadcastChannel('stream-to-shorts'); } catch { /* old browser */ }
function bcPost(m) { try { if (bc) bc.postMessage({ ...m, tab: TAB }); } catch { /* ignore */ } }
if (bc) bc.onmessage = async ({ data: m }) => {
  if (!S.p || !m || m.tab === TAB || m.video !== S.p.video) return;
  if (m.type === 'open' || m.type === 'here') {
    if (m.type === 'open') bcPost({ type: 'here', video: S.p.video });
    showBanner('twotabs', 'warn', 'This video is also open in another tab or window. Edit it in one place at a time, otherwise changes can clash.', [{ label: 'OK', fn() {} }]);
  } else if (m.type === 'saved' && m.rev !== S.p.rev && !S.dirty && !saving) {
    // The other tab saved and this one has no pending edits: load its version so both stay in sync.
    S.p = await api(`/api/project?video=${enc(S.p.video)}`).catch(() => S.p);
    rebaseHistory();
    renderAll();
  } else if (m.type === 'closed') hideBanner('twotabs');
};
async function reloadProject() {
  await saveNow();
  const p = await api(`/api/project?video=${enc(S.p.video)}`);
  S.p = p;
  rebaseHistory();
  if (!S.p.clips.some(c => c.id === S.sel)) S.sel = S.p.clips[0]?.id || null;
  renderAll();
}

// ---------------- videos ----------------
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

// ---------------- render all ----------------
// Short checklist for a video that isn't finished yet (hidden once done or dismissed).
function setupSteps() {
  const p = S.p, set = p.setup || {};
  const rendered = p.clips.some(c => c.output);
  const untitled = p.clips.filter(c => !c.title1 && !c.title2);
  return [
    { done: !!p.analyzed, text: 'Analyze the video to find the best moments', btn: 'Analyze', fn: () => $('#btnAnalyze').click() },
    { done: !!(set.layoutChecked || rendered), text: 'Check the layout: place the facecam and gameplay boxes', btn: 'Open Layout', fn: () => switchTab('layout') },
    { done: p.clips.length > 0 && !untitled.length, text: untitled.length ? `Give every clip a title (${untitled.length} untitled)` : 'Give every clip a title', btn: 'Next untitled',
      fn: () => { const c = untitled[0]; if (c) { selectClip(c.id, true); switchTab('edit'); $('#fTitle1').focus(); } } },
    { done: rendered, text: 'Render your first short', btn: 'Render', fn: () => { $('#btnRenderMenu').click(); } },
  ];
}
function renderSetup() {
  const el = $('#setupCard');
  if (!S.p) return;
  const steps = setupSteps();
  const show = !(S.p.setup && S.p.setup.hidden) && steps.some(x => !x.done);
  el.classList.toggle('hidden', !show);
  if (!show) return;
  el.innerHTML = `<div class="row between"><h3>Getting started with this video</h3><button class="btn small ghost" data-setuphide>Hide</button></div>`
    + steps.map((x, i) => `<div class="setup-step ${x.done ? 'done' : ''}"><span class="ic">${x.done ? '✓' : i + 1}</span><span class="t">${esc(x.text)}</span>${x.done ? '' : `<button class="btn small ghost" data-setupstep="${i}">${esc(x.btn)}</button>`}</div>`).join('');
}
$('#setupCard').addEventListener('click', e => {
  if (e.target.closest('[data-setuphide]')) { S.p.setup = { ...(S.p.setup || {}), hidden: true }; scheduleSave(); renderSetup(); return; }
  const b = e.target.closest('[data-setupstep]'); if (b) setupSteps()[+b.dataset.setupstep].fn();
});
function markLayoutChecked() { if (!(S.p.setup && S.p.setup.layoutChecked)) { S.p.setup = { ...(S.p.setup || {}), layoutChecked: true }; renderSetup(); } }

function renderAll() {
  renderClipList(); renderEditor(); renderLayoutTab(); renderStyleTab(); renderCaptionsTab(); renderSetup();
  drawTimeline(); drawPreview(); drawLayoutCanvas();
  $('#btnAnalyze').textContent = S.p.analyzed ? 'Re-analyze' : 'Analyze video';
  if (currentTab() === 'exports') loadExports();
}

// ---------------- clip list ----------------
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
// Moment strength: the auto-detect score, or for clips made by hand, how loud/lively the clip is
// according to the analysis (0-100).
// Why a moment was picked, in plain words. parts are z-scores (how far above a typical moment).
const PART_WORDS = {
  audio: [[2, 'very loud'], [1, 'loud'], [0.3, 'a bit louder than usual'], [-Infinity, 'not especially loud']],
  peak: [[2, 'big sudden spike'], [1, 'sudden spike'], [0.3, 'small spike'], [-Infinity, 'no sudden spike']],
  visual: [[2, 'lots of on-screen action'], [1, 'on-screen action'], [0.3, 'some movement'], [-Infinity, 'calm screen']],
};
const PART_KEYS = ['audio', 'peak', 'visual'];
// Smart detection: five signals, each 0-1 (see app/src/core/smart.js and docs/DETECTION.md).
const SMART_KEYS = ['audio', 'visual', 'semantic', 'emotion', 'context'];
const SMART_WORDS = {
  audio: [[0.6, 'very loud'], [0.3, 'loud'], [0.1, 'a bit louder than usual'], [-Infinity, 'not especially loud']],
  visual: [[0.6, 'lots of on-screen action'], [0.3, 'on-screen action'], [0.1, 'some movement'], [-Infinity, 'calm screen']],
  semantic: [[0.6, 'important things said'], [0.3, 'something worth hearing'], [0.1, 'some talk'], [-Infinity, 'little said']],
  emotion: [[0.6, 'strong emotion'], [0.3, 'some emotion'], [0.1, 'a little emotion'], [-Infinity, 'calm voice']],
  context: [[0.7, 'complete thought'], [0.4, 'mostly complete'], [0.2, 'partly complete'], [-Infinity, 'cut mid-thought']],
};
const REASON_TEXT = {
  quiet: 'Quiet but meaningful', complete: 'Starts and ends on complete sentences', qa: 'A question and its answer',
  punchline: 'A setup, then a reaction', story: 'Tells a story', laughter: 'Laughter', excitement: 'Excitement',
  surprise: 'Surprise', frustration: 'Frustration', enthusiasm: 'Enthusiasm', event: 'Gaming moment', insight: 'Insight or fact',
};
function explainScore(c) {
  if (!c || !c.scoreParts) return null;
  const smart = c.scoreEngine === 'smart';
  const keys = smart ? SMART_KEYS : PART_KEYS, table = smart ? SMART_WORDS : PART_WORDS;
  const w = c.scoreWeights || { audio: 1, peak: 0.5, visual: 0.3 };
  const contrib = keys.map(k => Math.max(0, (Number(w[k]) || 0) * (Number(c.scoreParts[k]) || 0)));
  const total = contrib.reduce((a, b) => a + b, 0);
  const shares = contrib.map(v => total ? Math.round(v / total * 100) : 0);
  const words = keys.map(k => table[k].find(([min]) => (Number(c.scoreParts[k]) || 0) >= min)[1]);
  return { keys, words, shares, smart, reasons: smart && Array.isArray(c.scoreReasons) ? c.scoreReasons : [] };
}
function scoreBarHtml(c) {
  if (c.score == null) return '';
  const ex = explainScore(c);
  const width = clamp(c.score, 3, 100);
  if (!ex) return `<div class="scorebar" title="${esc(tr('Moment strength') + ' ' + c.score + '/100')}"><i style="width:${width}%"></i></div>`;
  const tip = `${tr('Moment strength')} ${c.score}/100 · ` + ex.keys.map((k, i) => `${tr(ex.words[i])} ${ex.shares[i]}%`).join(' · ');
  return `<div class="scorebar parts" title="${esc(tip)}"><span style="width:${width}%">${ex.keys.map((k, i) => ex.shares[i] ? `<i class="p-${k}" style="width:${ex.shares[i]}%"></i>` : '').join('')}</span></div>`;
}
function renderWhy() {
  const c = selClip(), el = $('#whyMoment'); if (!el) return;
  const ex = explainScore(c);
  el.classList.toggle('hidden', !c);
  if (!c) return;
  if (!ex) { el.innerHTML = `<span class="muted small">${esc(tr(c.score != null ? 'This clip was detected before score details were kept. Run Auto-detect again to see why.' : 'Made by hand: no detection details.'))}</span>`; return; }
  const reasons = ex.reasons.filter(r => REASON_TEXT[r.k]).map(r => `<li>${esc(tr(REASON_TEXT[r.k]))}${r.w ? ` <q translate="no">${esc(r.w)}</q>` : ''}${Number.isFinite(r.t) ? ` <button class="linkish mono" data-seek="${Number(r.t)}">${fmt(r.t, false)}</button>` : ''}</li>`).join('');
  el.innerHTML = `<b>${esc(tr('Why this moment?'))}</b> <span class="muted small">${esc(tr('Moment strength'))} ${c.score}/100${ex.smart ? ' · ' + esc(tr('Smart detection')) : ''}</span>
    <div class="why-parts">${ex.keys.map((k, i) => `<span class="why-part"><i class="dot p-${k}"></i>${esc(tr(ex.words[i]))} <span class="muted">${ex.shares[i]}%</span></span>`).join('')}</div>${reasons ? `<ul class="why-reasons">${reasons}</ul>` : ''}`;
}
document.addEventListener('click', e => { const b = e.target.closest('#whyMoment [data-seek]'); if (b) seek(Number(b.dataset.seek)); });
function strengthOf(c) {
  if (c.score != null) return c.score;
  const L = S.loudNorm; if (!L) return -1;
  const a = Math.max(0, Math.floor(c.start)), b = Math.min(L.length, Math.ceil(c.end));
  if (b <= a) return -1;
  let sum = 0; for (let i = a; i < b; i++) sum += L[i];
  return Math.round(sum / (b - a) * 100);
}
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

// auto-detect popover (defaults match the server's DETECT_DEFAULTS)
const DETECT_DEFAULTS = { count: 12, length: 55, wAudio: 1, wPeak: 0.5, wVisual: 0.3, gap: 3, engine: 'fast', wA: 0.2, wV: 0.15, wS: 0.35, wE: 0.2, wC: 0.1 };
const FAST_W = ['wAudio', 'wPeak', 'wVisual'], SMART_W = ['wA', 'wV', 'wS', 'wE', 'wC'];
$('#btnDetect').addEventListener('click', () => {
  if (!S.p.analyzed) return toast('Analyze the video first. Auto-detect uses the loudness and action scan.', 'err');
  let pop = $('#detectPop');
  if (pop) return pop.remove();
  pop = document.createElement('div');
  pop.id = 'detectPop';
  pop.className = 'caption-box';
  const d = { ...DETECT_DEFAULTS, ...(S.p.detect || {}) };
  const slider = (id, key, label, hint, max = 3, step = 0.1) => `<label class="w-row" title="${esc(tr(hint))}"><span><i class="dot p-${key}"></i>${esc(tr(label))} <output id="${id}Out">${Number(d[id]).toFixed(max === 1 ? 2 : 1)}</output></span><input id="${id}" type="range" min="0" max="${max}" step="${step}" value="${Number(d[id])}"></label>`;
  const hasTranscript = !!(S.transcript && S.transcript.words && S.transcript.words.length);
  pop.innerHTML = `<div class="grid2"><label>How many<input id="dCount" type="number" min="1" max="40" value="${d.count}"></label>
    <label>Seconds each<input id="dLen" type="number" min="10" max="60" value="${d.length}"></label></div>
    <div class="engine-pick" role="radiogroup">
      <label><input type="radio" name="dEngine" value="fast"${d.engine !== 'smart' ? ' checked' : ''}> <b>Fast</b> <span class="muted small">sound and action</span></label>
      <label><input type="radio" name="dEngine" value="smart"${d.engine === 'smart' ? ' checked' : ''}> <b>Smart</b> <span class="muted small">also what is said</span></label>
    </div>
    <p class="muted small" data-for="fast">Finds the loudest, most action-packed moments: reactions, hype and big plays.</p>
    <p class="muted small" data-for="smart">Also listens to what is said: jokes and laughter, gaming moments, explanations, questions and answers, even when it is quiet. Clips start and end on complete sentences.</p>
    ${hasTranscript ? '' : '<p class="small warn-text" data-for="smart">Smart detection needs the transcript of the whole stream. <button class="btn small ghost" data-transcribe>Transcribe whole stream</button></p>'}
    <details class="detect-adv"><summary>Advanced: what counts as a great moment</summary>
      <div data-for="fast">
      ${slider('wAudio', 'audio', 'Loudness', 'Sustained loud moments: excitement, shouting, music')}
      ${slider('wPeak', 'peak', 'Sudden spikes', 'Short bursts: a scream, an explosion, a big reaction')}
      ${slider('wVisual', 'visual', 'On-screen action', 'Lots of change on screen: fights, fast moves, scene changes')}
      </div>
      <div data-for="smart">
      ${slider('wA', 'audio', 'Audio excitement', 'Loud and sudden sounds', 1, 0.05)}
      ${slider('wV', 'visual', 'Visual activity', 'Change on screen', 1, 0.05)}
      ${slider('wS', 'semantic', 'What is said', 'Gaming events, explanations and facts, questions, your words to expect', 1, 0.05)}
      ${slider('wE', 'emotion', 'Emotion', 'Laughter, excitement, surprise, frustration, enthusiasm', 1, 0.05)}
      ${slider('wC', 'context', 'Complete moment', 'Whole sentences, a question with its answer, a setup with its punchline', 1, 0.05)}
      <p class="muted small">Starting points, not proven best values: adjust them to your streams.</p>
      </div>
      <label class="w-row">Minimum spacing between moments (s)<input id="dGap" type="number" min="0" max="600" value="${d.gap}"></label>
      <div class="row gap"><button class="btn small ghost" data-reset>Reset to defaults</button><span class="muted small">0 turns a signal off.</span></div>
    </details>
    <div class="row gap"><button class="btn small primary" data-mode="add">Add new moments</button><button class="btn small danger" data-mode="replace">Replace all clips</button></div>`;
  pop.addEventListener('input', e => { const o = pop.querySelector('#' + e.target.id + 'Out'); if (o) o.textContent = Number(e.target.value).toFixed(SMART_W.includes(e.target.id) ? 2 : 1); });
  const engine = () => pop.querySelector('[name=dEngine]:checked').value;
  const showEngine = () => pop.querySelectorAll('[data-for]').forEach(x => x.classList.toggle('hidden', x.dataset.for !== engine()));
  pop.addEventListener('change', e => { if (e.target.name === 'dEngine') showEngine(); });
  showEngine();
  $('.select-row').before(pop);
  pop.addEventListener('click', async e => {
    if (e.target.closest('[data-transcribe]')) { pop.remove(); $('#btnTranscribeFull').click(); return; }
    if (e.target.closest('[data-reset]')) {
      for (const k of FAST_W.concat(SMART_W)) { pop.querySelector('#' + k).value = DETECT_DEFAULTS[k]; pop.querySelector('#' + k + 'Out').textContent = DETECT_DEFAULTS[k].toFixed(SMART_W.includes(k) ? 2 : 1); }
      pop.querySelector('#dGap').value = DETECT_DEFAULTS.gap;
      return;
    }
    const mode = e.target.dataset.mode;
    if (!mode) return;
    if (mode === 'replace' && !confirm('Replace all clips (including your edits) with new suggestions?')) return;
    await saveNow();
    try {
      pushAction(mode === 'replace' ? 'auto-detect (replace)' : 'auto-detect');
      S.p = await api('/api/detect', { method: 'POST', body: { slug: slug(), count: +$('#dCount').value, length: +$('#dLen').value,
        wAudio: +$('#wAudio').value, wPeak: +$('#wPeak').value, wVisual: +$('#wVisual').value, gap: +$('#dGap').value, mode,
        engine: engine(), ...Object.fromEntries(SMART_W.map(k => [k, +$('#' + k).value])) } });
      S.sel = S.p.clips[0]?.id || null;
      rebaseHistory();
      pop.remove(); renderAll(); toast('Moments updated. Ctrl+Z undoes this.', 'ok');
    } catch (err) { toast(err.message, 'err'); }
  });
});

// ---------------- player / transport ----------------
function seek(t) { if (S.p) player.currentTime = clamp(t, 0, S.p.meta.duration - 0.05); }
function togglePlay() { if (player.paused) { S.playUntil = null; player.play(); } else player.pause(); }
$('#btnPlay').addEventListener('click', togglePlay);
$('#btnPlayClip').addEventListener('click', playClip);
function playClip() {
  const c = selClip();
  if (!c) return;
  S.playUntil = c.end;
  seek(c.start); player.play();
}
player.addEventListener('play', () => { $('#btnPlay').textContent = '❚❚'; loop(); });
player.addEventListener('pause', () => { $('#btnPlay').textContent = '▶'; });
player.addEventListener('seeked', onTime);
player.addEventListener('loadeddata', onTime);
function onTime() {
  if (!S.p) return;
  $('#timeLabel').textContent = `${fmt(player.currentTime)} / ${fmt(S.p.meta.duration, false)}`;
  drawTimeline(); drawPreview(); markChunk();
  if (currentTab() === 'layout') drawLayoutCanvas();
}
function loop() {
  if (player.paused) return;
  if (S.playUntil != null && player.currentTime >= S.playUntil) {
    const c = selClip();
    if ($('#loopClip').checked && c) seek(c.start); else { player.pause(); S.playUntil = null; }
  }
  const t = player.currentTime, [v0, v1] = S.view;
  if (t > v1 && !tl.drag) { const w = v1 - v0; S.view = [t - w * 0.1, t + w * 0.9]; }
  onTime();
  requestAnimationFrame(loop);
}

// ---------------- timeline ----------------
const tl = { cv: $('#timeline'), drag: null, hover: null };
tl.cv.tabIndex = 0;
tl.cv.setAttribute('role', 'application');
tl.cv.setAttribute('aria-label', 'Timeline. Left and right arrows seek, I and O set the clip start and end, comma and period move the selected clip, plus and minus zoom.');
function tlSize() {
  const r = tl.cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  if (tl.cv.width !== Math.round(r.width * dpr)) { tl.cv.width = Math.round(r.width * dpr); tl.cv.height = Math.round(r.height * dpr); }
  return { w: r.width, h: r.height, dpr };
}
const t2x = (t, w) => (t - S.view[0]) / (S.view[1] - S.view[0]) * w;
const x2t = (x, w) => S.view[0] + x / w * (S.view[1] - S.view[0]);
function drawTimeline() {
  if (!S.p) return;
  const { w, h, dpr } = tlSize();
  const ctx = tl.cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const [v0, v1] = S.view, span = v1 - v0;
  // ticks
  const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800];
  const step = steps.find(s => s / span * w >= 70) || 3600;
  ctx.fillStyle = '#5c6170'; ctx.font = '10px Segoe UI'; ctx.textBaseline = 'top';
  for (let t = Math.ceil(v0 / step) * step; t <= v1; t += step) {
    const x = t2x(t, w);
    ctx.fillRect(x, 0, 1, 6);
    ctx.fillText(fmt(t, false), x + 3, 1);
  }
  // loudness
  const top = 16, bh = h - top - 4;
  if (S.loudNorm) {
    const L = S.loudNorm, sc = S.analysis.scene;
    ctx.fillStyle = '#3b4252';
    for (let x = 0; x < w; x++) {
      const a = Math.floor(x2t(x, w)), b = Math.max(a + 1, Math.floor(x2t(x + 1, w)));
      let m = 0; for (let i = a; i < b && i < L.length; i++) if (L[i] > m) m = L[i];
      const y = bh * m;
      ctx.fillRect(x, top + bh - y, 1, y);
    }
    ctx.strokeStyle = 'rgba(90,169,255,.55)'; ctx.lineWidth = 1; ctx.beginPath();
    for (let x = 0; x < w; x += 2) {
      const i = Math.floor(x2t(x, w));
      const y = top + bh - clamp((sc[i] || 0) * 3, 0, 1) * bh * 0.6;
      x ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();
  } else {
    ctx.fillStyle = '#5c6170'; ctx.font = '12px Segoe UI';
    ctx.fillText(tr('Analyze the video to see loudness and action here'), 10, h / 2 - 6);
  }
  // ruler strip (drag it to pan)
  ctx.fillStyle = 'rgba(255,255,255,.035)'; ctx.fillRect(0, 0, w, 15);
  // clips
  S.p.clips.forEach(c => {
    const x0 = t2x(c.start, w), x1 = t2x(c.end, w);
    if (x1 < 0 || x0 > w) return;
    const active = c.id === S.sel;
    ctx.fillStyle = active ? 'rgba(255,212,0,.22)' : 'rgba(255,212,0,.09)';
    ctx.fillRect(x0, top, x1 - x0, bh);
    ctx.fillStyle = active ? '#ffd400' : 'rgba(255,212,0,.5)';
    ctx.fillRect(x0, top, x1 - x0, 2);
    ctx.font = 'bold 10px Segoe UI'; ctx.fillText('#' + clipNo(c), x0 + 4, top + 4);
    if (active) { ctx.fillRect(x0 - 2, top, 4, bh); ctx.fillRect(x1 - 2, top, 4, bh); }
    else { ctx.fillStyle = 'rgba(255,212,0,.35)'; ctx.fillRect(x0, top, 1.5, bh); ctx.fillRect(x1 - 1.5, top, 1.5, bh); }
  });
  // overlapping footage (red)
  const cs = [...S.p.clips].sort((a, b) => a.start - b.start);
  ctx.fillStyle = 'rgba(255,93,93,.55)';
  for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length && cs[j].start < cs[i].end; j++) {
    const a = t2x(Math.max(cs[i].start, cs[j].start), w), b = t2x(Math.min(cs[i].end, cs[j].end), w);
    ctx.fillRect(a, top, Math.max(1, b - a), bh);
  }
  // new clip being drawn
  const g = tl.drag && tl.drag.ghost;
  if (g) {
    const a = t2x(g[0], w), b = t2x(g[1], w);
    ctx.fillStyle = 'rgba(90,169,255,.25)'; ctx.fillRect(a, top, b - a, bh);
    ctx.strokeStyle = '#5aa9ff'; ctx.lineWidth = 1; ctx.strokeRect(a + 0.5, top + 0.5, b - a - 1, bh - 1);
    ctx.fillStyle = '#5aa9ff'; ctx.font = 'bold 11px Segoe UI'; ctx.fillText(`${tr('new clip')} · ${(g[1] - g[0]).toFixed(1)} s`, a + 4, top + 4);
  }
  // playhead
  // speech (blue line at the bottom)
  const sp = speechSegs();
  if (sp.length) {
    ctx.fillStyle = 'rgba(90,169,255,.85)';
    for (const g of sp) {
      if (g[1] < v0 || g[0] > v1) continue;
      const a = t2x(g[0], w), b = t2x(g[1], w);
      ctx.fillRect(a, h - 4, Math.max(1, b - a), 3);
    }
  }
  const px = t2x(player.currentTime || 0, w);
  ctx.fillStyle = '#fff'; ctx.fillRect(px - 0.5, 0, 1.5, h);
}
const EDGE = 7;
function tlHit(x, y, w) {
  if (y < 15) return { kind: 'ruler' };
  const sel = selClip();
  const order = sel ? [sel, ...S.p.clips.filter(c => c !== sel)] : S.p.clips;
  for (const c of order) {
    if (Math.abs(x - t2x(c.start, w)) < EDGE) return { kind: 'start', c };
    if (Math.abs(x - t2x(c.end, w)) < EDGE) return { kind: 'end', c };
  }
  const t = x2t(x, w);
  const inside = sel && t >= sel.start && t <= sel.end ? sel : S.p.clips.find(k => t >= k.start && t <= k.end);
  return { kind: inside ? 'clip' : 'bg', c: inside };
}
const TL_CURSOR = { ruler: 'grab', start: 'ew-resize', end: 'ew-resize', clip: 'move', bg: 'crosshair' };
tl.cv.addEventListener('mousedown', e => {
  if (!S.p || e.button !== 0) return;
  const { w } = tlSize(); const x = e.offsetX;
  const hit = e.shiftKey ? { kind: 'ruler' } : tlHit(x, e.offsetY, w);
  if (hit.c && hit.c.id !== S.sel) selectClip(hit.c.id, false);
  tl.drag = { ...hit, x0: x, t0: x2t(x, w), view0: [...S.view], moved: false, orig: hit.c ? { start: hit.c.start, end: hit.c.end } : null };
  if (hit.kind === 'ruler') tl.cv.style.cursor = 'grabbing';
});
window.addEventListener('mousemove', e => {
  if (!S.p) return;
  const r = tl.cv.getBoundingClientRect(); const w = r.width; const x = e.clientX - r.left;
  const d = tl.drag;
  if (!d) {
    if (e.target !== tl.cv) { $('#tlTip').classList.add('hidden'); return; }
    tl.cv.style.cursor = e.shiftKey ? 'grab' : TL_CURSOR[tlHit(x, e.clientY - r.top, w).kind];
    const tip = $('#tlTip'); tip.classList.remove('hidden'); tip.style.left = x + 'px'; tip.textContent = fmt(x2t(x, w));
    return;
  }
  if (Math.abs(x - d.x0) > 3) d.moved = true;
  if (!d.moved) return;
  const dur = S.p.meta.duration;
  const t = clamp(x2t(x, w), 0, dur);
  if (d.kind === 'start' || d.kind === 'end') {
    const sn = e.altKey ? { t: r1(t) } : snapEdge(r1(t), d.kind);
    const v = sn.t;
    Object.assign(d.c, Timing.setEdge(d.c, d.kind, v, dur));
    seek(d.kind === 'start' ? d.c.start : d.c.end);
    const tip = $('#tlTip'); tip.classList.remove('hidden'); tip.style.left = x + 'px';
    tip.textContent = fmt(d.kind === 'start' ? d.c.start : d.c.end) + (sn.how ? ' · ' + tr(sn.how) : '');
    renderEditor(); drawTimeline(); drawPreview();
  } else if (d.kind === 'clip') {
    const len = d.orig.end - d.orig.start;
    const ns = r1(clamp(d.orig.start + (t - d.t0), 0, Math.max(0, dur - len)));
    d.c.start = ns; d.c.end = r1(ns + len);
    seek(d.c.start); renderEditor(); drawTimeline(); drawPreview();
    const tip = $('#tlTip'); tip.classList.remove('hidden'); tip.style.left = x + 'px'; tip.textContent = `${fmt(d.c.start)} → ${fmt(d.c.end)}`;
  } else if (d.kind === 'ruler') {
    const span = d.view0[1] - d.view0[0];
    const s0 = clamp(d.view0[0] - (x - d.x0) / w * span, 0, dur - span);
    S.view = [s0, s0 + span]; drawTimeline();
  } else if (d.kind === 'bg') {
    d.ghost = [r1(Math.min(d.t0, t)), r1(Math.max(d.t0, t))];
    const tip = $('#tlTip'); tip.classList.remove('hidden'); tip.style.left = x + 'px'; tip.textContent = `${(d.ghost[1] - d.ghost[0]).toFixed(1)} s`;
    drawTimeline();
  }
});
window.addEventListener('mouseup', e => {
  const d = tl.drag; tl.drag = null;
  if (!d) return;
  const { w } = tlSize();
  if (d.moved && ['start', 'end', 'clip'].includes(d.kind)) {
    S.p.clips.sort((a, b) => a.start - b.start);
    scheduleSave(); renderClipList(); renderEditor(); drawTimeline(); return;
  }
  if (d.moved && d.kind === 'bg' && d.ghost) {
    const [a, b] = d.ghost;
    drawTimeline();
    if (b - a >= 2) return addClipAt(a, Math.min(b, a + 60));
    toast('Drag at least 2 seconds to create a clip', '', 2000);
  }
  if (!d.moved) { S.playUntil = null; seek(x2t(e.clientX - tl.cv.getBoundingClientRect().left, w)); }
  if (d.kind === 'ruler') tl.cv.style.cursor = 'grab';
});
tl.cv.addEventListener('mouseleave', () => $('#tlTip').classList.add('hidden'));
tl.cv.addEventListener('wheel', e => {
  if (!S.p) return;
  e.preventDefault();
  const { w } = tlSize();
  const dur = S.p.meta.duration, span0 = S.view[1] - S.view[0];
  if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
    // pan
    const s0 = clamp(S.view[0] + (e.deltaX || e.deltaY) / w * span0, 0, dur - span0);
    S.view = [s0, s0 + span0]; drawTimeline(); return;
  }
  const t = x2t(e.offsetX, w);
  const span = clamp(span0 * (e.deltaY > 0 ? 1.25 : 0.8), 10, dur);
  const f = e.offsetX / w;
  const s0 = clamp(t - span * f, 0, dur - span);
  S.view = [s0, s0 + span]; drawTimeline();
}, { passive: false });
tl.cv.addEventListener('dblclick', () => { S.view = [0, S.p.meta.duration]; drawTimeline(); });
window.addEventListener('resize', () => { drawTimeline(); drawLayoutCanvas(); });

// ---------------- speech-aware trimming ----------------
// Speech comes from clip captions and (if made) the whole-stream transcript. Gaps between words
// are where a clip can start or end without cutting someone off.
let speechCache = { key: '', segs: [] };
function speechSegs() {
  if (!S.p) return [];
  const key = S.p.slug + ':' + (S.transcript ? S.transcript.words.length : 0) + ':' + S.p.clips.map(c => (c.captions ? c.captions.length : 0) + '/' + (c.captionsVer || 0) + '/' + (c.captionsRange || []).join('-')).join(',');
  if (speechCache.key === key) return speechCache.segs;
  let words = S.transcript ? S.transcript.words.slice() : [];
  for (const c of S.p.clips) for (const ch of c.captions || []) for (const w of ch.words || []) words.push(w);
  const segs = Timing.speechSegments(words); // [start, end, last word]
  speechCache = { key, segs };
  return segs;
}
// Clip edges stick to pauses in speech (rules in timing.js); Alt while dragging turns it off.
function snapEdge(t, which) {
  if (!S.snap || !S.p) return { t };
  return Timing.snapEdge(t, which, { segs: speechSegs(), duration: S.p.meta.duration, loudNorm: S.loudNorm });
}
S.snap = store.get('snapSpeech') !== '0';
$('#snapSpeech').checked = S.snap;
$('#snapSpeech').addEventListener('change', e => { S.snap = e.target.checked; store.set('snapSpeech', S.snap ? '1' : '0'); });

// ---------------- video size (more room for the editor on small screens) ----------------
const SIZES = ['s', 'm', 'l'];
function setPlayerSize(sz) {
  document.body.classList.remove('player-s', 'player-m', 'player-l');
  document.body.classList.add('player-' + sz);
  store.set('playerSize', sz);
  $('#btnPlayerSize').textContent = tr('Video size') + ': ' + sz.toUpperCase();
  requestAnimationFrame(() => { drawTimeline(); drawLayoutCanvas(); });
}
setPlayerSize(SIZES.includes(store.get('playerSize')) ? store.get('playerSize') : (window.innerHeight < 820 ? 's' : 'm'));
$('#btnPlayerSize').addEventListener('click', () => {
  const cur = SIZES.find(z => document.body.classList.contains('player-' + z)) || 'm';
  setPlayerSize(SIZES[(SIZES.indexOf(cur) + 1) % SIZES.length]);
});

// ---------------- safe zones ----------------
S.safe = store.get('safeZones') === '1';
$('#safeZones').checked = S.safe;
$('#safeZones').addEventListener('change', e => { S.safe = e.target.checked; store.set('safeZones', S.safe ? '1' : '0'); drawPreview(); });
const SAFE_TEXT = {
  title: ['The title is under the apps\' top bar.', 'Move the title down'],
  captionsLow: ['Captions are under the description at the bottom.', 'Move captions up'],
  captionsHigh: ['Captions are under the apps\' top bar.', 'Move captions down'],
};
let safeKey = '';
function renderSafeWarn(issues) {
  const key = issues.join(',') + ':' + (S.sel || '');
  if (key === safeKey) return;
  safeKey = key;
  const el = $('#safeWarn');
  el.classList.toggle('hidden', !issues.length);
  el.innerHTML = issues.map(k => `<div class="row gap between"><span>⚠ ${esc(tr(SAFE_TEXT[k][0]))}</span><button class="btn small ghost" data-safefix="${k}">${esc(tr(SAFE_TEXT[k][1]))}</button></div>`).join('')
    + (issues.length && !S.safe ? `<button class="btn small ghost" data-safeshow>${esc(tr('Show the covered areas'))}</button>` : '');
}
$('#safeWarn').addEventListener('click', e => {
  if (e.target.closest('[data-safeshow]')) { S.safe = true; $('#safeZones').checked = true; store.set('safeZones', '1'); safeKey = ''; drawPreview(); return; }
  const k = e.target.dataset.safefix; if (!k) return;
  const c = selClip();
  const st = c && c.style ? c.style : S.p.style; // fix the style this clip actually uses
  if (k === 'title') st.titleSafe = true;
  else { const E = c ? eff(c) : S.p; st.captionAuto = false; st.captionPos = k === 'captionsLow' ? 70 : 20; if (E.style.captionAuto) st.captionAuto = false; }
  safeKey = ''; scheduleSave(); renderStyleTab(); renderClipList(); drawPreview();
  toast(tr(k === 'title' ? 'Title moved below the top bar' : 'Captions moved into the visible area'), 'ok');
});

// ---------------- edit tab ----------------
function setVal(el, v) { if (document.activeElement !== el) el.value = v; }
function renderEditor() {
  const c = selClip();
  $('#editEmpty').classList.toggle('hidden', !!c);
  $('#editForm').classList.toggle('hidden', !c);
  if (!c) return;
  setVal($('#fTitle1'), c.title1 || '');
  setVal($('#fTitle2'), c.title2 || '');
  setVal($('#fStart'), fmt(c.start));
  setVal($('#fEnd'), fmt(c.end));
  const d = c.end - c.start;
  const dl = $('#durLabel');
  dl.textContent = `${d.toFixed(1)}s${d > 60 ? ': too long for Shorts (max 60s)' : ''}`;
  dl.classList.toggle('warn', d > 60);
  $('#btnTrim60').classList.toggle('hidden', d <= 60.05);
  setVal($('#fDesc'), c.description || '');
  $('#fCaptionsOn').checked = c.captionsOn !== false;
  $('#fLayoutMode').value = c.layoutMode || '';
  renderWhy();
  if ($('#titleIdeas').dataset.for !== c.id) { $('#titleIdeas').innerHTML = ''; $('#titleIdeas').dataset.for = c.id; }
  renderClipStyleSelect();
  renderTitleFit();
  renderCaptionStatus();
}
// Title ideas from the clip's captions: short punchy sentences, preferring exclamations, questions,
// numbers and the video's own key words (hint words and word fixes). Runs on this PC, no online AI.
const FILLER = /^(yeah|yes|yep|no|so|and|but|okay|ok|uh|um|oh|well|like|right|bro|guys|now|then|just|alright|hmm|ah|i mean|exactly|wait)$/i;
const NOISE = /^(uh|um|hmm|ah|er|erm|mm)$/i; // removed anywhere
const WEAK_END = /^(the|a|an|to|of|and|or|but|so|if|i|you|he|she|we|they|its|this|that|these|those|some|my|his|her|your|our|their|is|are|was|were|be|can|will|would|gonna|just|in|on|at|for|with|from|by|as|than|there's|what's|i'm|i'll|he's|she's|let's|don't|not|very|really|pretty|kinda)$/i;
const WEAK_START = /^(and|or|but|so|to|of|then|because|that|which|than)$/i;
const HYPE = /\b(mate|checkmate|win|won|winning|lose|lost|insane|crazy|wow|never|blunder|brilliant|trap|sacrifice|queen|king|clutch|seconds|last|best|worst|impossible|unbelievable|finally|no way|save|resign|time|minute|dead|over|gg)\b/i;
function splitTitle(text) {
  const w = text.split(' ');
  if (text.length <= 16 || w.length < 2) return [text, ''];
  let best = 1, bestLen = Infinity;
  for (let k = 1; k < w.length; k++) {
    const a = w.slice(0, k).join(' ').length, b = w.slice(k).join(' ').length;
    const m = Math.max(a, b) + (b < a ? 0 : 1); // slightly prefer a longer first line
    if (m < bestLen) { bestLen = m; best = k; }
  }
  return [w.slice(0, best).join(' '), w.slice(best).join(' ')];
}
// Candidates are whole sentences, clauses (between commas) and 5-7 word windows of long sentences,
// with filler words removed and no weak first/last word. Scored for exclamations, questions,
// the video's key words, numbers and hype words. Near-duplicates are skipped.
function suggestTitles(c) {
  const raw = (c.captions || []).flatMap(ch => (ch.words || []).map(w => String(w.w)));
  if (!raw.length) return null;
  const hints = new Set(String(S.p.whisper.prompt || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(x => x.length > 3)
    .concat((S.p.whisper.fixes || []).flatMap(f => String(f.to || '').toLowerCase().split(/\s+/)).filter(x => x.length > 3)));
  const sents = []; let cur = [];
  for (const w of raw) { cur.push(w); if (/[.!?…]["»”]?$/.test(w)) { sents.push(cur); cur = []; } }
  if (cur.length) sents.push(cur);
  const units = [];
  for (const sw of sents) {
    const end = (sw[sw.length - 1].match(/[!?]/) || [''])[0];
    units.push({ words: sw, end, whole: true });
    let part = [];
    for (const w of sw) { part.push(w); if (/[,;:]$/.test(w)) { units.push({ words: part, end: '', whole: false }); part = []; } }
    if (part.length && part.length < sw.length) units.push({ words: part, end, whole: false });
  }
  const clean = w => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}']+$/gu, '');
  const trim = ws => {
    for (let changed = true; changed && ws.length;) {
      changed = false;
      if (FILLER.test(ws[0]) || WEAK_START.test(ws[0])) { ws.shift(); changed = true; }
      const last = ws[ws.length - 1], keep = /^you$/i.test(last || '') && /^thank$/i.test(ws[ws.length - 2] || ''); // 'thank you' stays whole
      if (ws.length && !keep && (FILLER.test(last) || WEAK_END.test(last))) { ws.pop(); changed = true; }
    }
    return ws;
  };
  const cands = [];
  const add = (list, end, whole, atEnd) => {
    const ws = trim(list.slice());
    if (ws.length < 2) return;
    const text = ws.join(' '), low = text.toLowerCase();
    let score = whole ? 1.5 : atEnd ? 0.8 : 0;
    if (end === '!') score += 3; else if (end === '?') score += 2;
    for (const h of hints) if (low.includes(h)) score += 2;
    if (/\d/.test(text)) score += 1;
    if (HYPE.test(low)) score += 1.5;
    score -= Math.abs(ws.length - 5) * 0.35;
    const out = (text + end).toUpperCase();
    if (out.length <= 40) cands.push({ score, text: out });
  };
  for (const u of units) {
    let ws = u.words.map(clean).filter(w => w && !NOISE.test(w));
    ws = ws.filter((w, i) => !(i >= 2 && w.toLowerCase() === ws[i - 1].toLowerCase() && w.toLowerCase() === ws[i - 2].toLowerCase()));
    if (ws.length <= 8) add(ws, u.end, u.whole);
    else for (let i = 0; i + 4 <= ws.length; i++) for (const n of [5, 6, 7]) if (i + n <= ws.length) add(ws.slice(i, i + n), i + n >= ws.length ? u.end : '', false, i + n >= ws.length);
  }
  const seen = [], out = [];
  for (const x of cands.sort((p, q) => q.score - p.score)) {
    const tk = new Set(x.text.split(' '));
    if (seen.some(t => { const sw = t.split(' '); return sw.filter(w => tk.has(w)).length / Math.min(tk.size, sw.length) > 0.5; })) continue;
    seen.push(x.text);
    out.push(splitTitle(x.text));
    if (out.length === 3) break;
  }
  return out;
}
function showIdeas() {
  const c = selClip(), el = $('#titleIdeas'); if (!c) return;
  const ideas = suggestTitles(c);
  if (ideas === null) { el.innerHTML = `<span class="muted">${esc(tr('Generate captions first: ideas come from what was said in the clip.'))}</span>`; return; }
  if (!ideas.length) { el.innerHTML = `<span class="muted">${esc(tr('No good phrase found in this clip. Try writing your own.'))}</span>`; return; }
  el.innerHTML = ideas.map(([a, b]) => `<button class="idea" data-t1="${esc(a)}" data-t2="${esc(b)}" title="${esc(tr('Use this title'))}">${esc(a)}${b ? ` <i>${esc(b)}</i>` : ''}</button>`).join('');
}
$('#btnSuggest').addEventListener('click', showIdeas);
$('#titleIdeas').addEventListener('click', e => {
  const b = e.target.closest('.idea'); const c = selClip(); if (!b || !c) return;
  c.title1 = b.dataset.t1; c.title2 = b.dataset.t2;
  $('#fTitle1').value = c.title1; $('#fTitle2').value = c.title2;
  scheduleSave(); renderClipList(); renderTitleFit(); renderSetup(); drawPreview();
  keyFeedback(tr('Title set. Edit it freely; Ctrl+Z undoes this.'));
});
function renderTitleFit() {
  const c = selClip(), el = $('#titleFit');
  if (!c) return;
  const st = eff(c).style;
  const size = Layout.titleSize(st, c.title1, c.title2);
  const show = (c.title1 || c.title2) && size < st.titleSize;
  el.classList.toggle('hidden', !show);
  if (show) el.textContent = `This title is long, so it's shrunk to ${size} px (style size ${st.titleSize} px) to fit the width. Shorter lines stay bigger.`;
}
function renderClipStyleSelect() {
  const c = selClip(); if (!c) return;
  const sel = $('#fStylePreset');
  const names = S.presets.map(p => p.name);
  const own = c.style && c.styleName && !names.includes(c.styleName) ? [c.styleName] : [];
  sel.innerHTML = '<option value="">Project style</option>' + names.concat(own).map(n => `<option value="${esc(n)}">${esc(n)}${own.includes(n) ? ' (deleted preset)' : ''}</option>`).join('');
  sel.value = c.style ? (c.styleName || '') : '';
}
$('#fLayoutMode').addEventListener('change', e => {
  const c = selClip(); if (!c) return;
  if (e.target.value) c.layoutMode = e.target.value; else delete c.layoutMode;
  scheduleSave(); renderClipList(); drawPreview();
});
$('#fStylePreset').addEventListener('change', e => {
  const c = selClip(); if (!c) return;
  const pr = S.presets.find(p => p.name === e.target.value);
  if (pr) { c.style = { ...pr.style }; c.styleName = pr.name; } else if (!e.target.value) { delete c.style; delete c.styleName; }
  scheduleSave(); renderClipList(); renderTitleFit(); drawPreview(); renderStyleTab();
});
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

// ---------------- tabs ----------------
const currentTab = () => $('.tabs button.active').dataset.tab;
function switchTab(name) {
  $$('.tabs button').forEach(b => { b.classList.toggle('active', b.dataset.tab === name); b.setAttribute('aria-selected', String(b.dataset.tab === name)); b.tabIndex = b.dataset.tab === name ? 0 : -1; });
  $$('.tab').forEach(t => t.classList.toggle('hidden', t.dataset.tab !== name));
  if (name === 'layout') requestAnimationFrame(drawLayoutCanvas);
  if (name === 'exports') loadExports();
}
$$('.tabs button').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));
// Arrow keys move between tabs (standard tab-list behaviour).
$('.tabs').addEventListener('keydown', e => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  e.preventDefault(); e.stopPropagation();
  const bs = $$('.tabs button'), i = bs.findIndex(b => b.classList.contains('active'));
  const n = bs[(i + (e.key === 'ArrowRight' ? 1 : -1) + bs.length) % bs.length];
  switchTab(n.dataset.tab); n.focus();
});

// ---------------- layout tab ----------------
const lc = { cv: $('#layoutCanvas'), drag: null, active: 'game' };
lc.cv.tabIndex = 0;
lc.cv.setAttribute('role', 'application');
lc.cv.setAttribute('aria-label', 'Layout editor. Enter switches between the facecam and gameplay boxes. Arrow keys move the box, Shift plus arrow keys resize it, hold Alt for fine steps.');
lc.cv.addEventListener('focus', () => drawLayoutCanvas());
lc.cv.addEventListener('blur', () => drawLayoutCanvas());
lc.cv.addEventListener('keydown', e => {
  const keys = layoutRects().map(r => r[0]);
  if (!keys.includes(lc.active)) lc.active = keys[0];
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault(); e.stopPropagation();
    lc.active = keys[(keys.indexOf(lc.active) + 1) % keys.length];
    drawLayoutCanvas(); toast(`${lc.active === 'cam' ? 'Facecam' : 'Gameplay'} box selected`, '', 1200); return;
  }
  const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
  if (!dir) return;
  e.preventDefault(); e.stopPropagation();
  const M = S.p.meta, step = e.altKey ? 2 : 16, q = { ...S.p.layout[lc.active] };
  if (e.shiftKey) {
    q.w = clamp(q.w + dir[0] * step, 40, M.width - q.x);
    q.h = clamp(q.h + dir[1] * step, 40, M.height - q.y);
  } else {
    q.x = clamp(q.x + dir[0] * step, 0, M.width - q.w);
    q.y = clamp(q.y + dir[1] * step, 0, M.height - q.h);
  }
  S.p.layout[lc.active] = q;
  markLayoutChecked();
  scheduleSave(); drawLayoutCanvas(); drawPreview(); renderLayoutTab();
});
function renderLayoutTab() {
  const L = S.p.layout;
  $$('#layoutMode button').forEach(b => b.classList.toggle('active', b.dataset.mode === L.mode));
  $('#camOnTop').checked = L.camOnTop !== false;
  $('#camOnTop').closest('label').classList.toggle('hidden', L.mode !== 'split');
  const r = k => { const x = L[k]; return `${k === 'cam' ? 'Facecam' : 'Gameplay'}: ${Math.round(x.w)}×${Math.round(x.h)} at ${Math.round(x.x)},${Math.round(x.y)}`; };
  $('#rectInfo').innerHTML = [L.mode !== 'gameplay' ? r('cam') : '', L.mode !== 'cam' ? r('game') : ''].filter(Boolean).map(s => `<span>${s}</span>`).join('');
}
$('#layoutMode').addEventListener('click', e => {
  const m = e.target.dataset.mode; if (!m) return;
  S.p.layout.mode = m; markLayoutChecked(); scheduleSave(); renderLayoutTab(); drawLayoutCanvas(); drawPreview();
});
$('#camOnTop').addEventListener('change', e => { S.p.layout.camOnTop = e.target.checked; scheduleSave(); drawPreview(); });
$('#btnResetGame').addEventListener('click', () => { S.p.layout.game = { x: 0, y: 0, w: S.p.meta.width, h: S.p.meta.height }; scheduleSave(); renderLayoutTab(); drawLayoutCanvas(); drawPreview(); });
function layoutRects() {
  const m = S.p.layout.mode;
  return [m !== 'cam' && ['game', '#5aa9ff', 'GAMEPLAY'], m !== 'gameplay' && ['cam', '#ffd400', 'FACECAM']].filter(Boolean);
}
function drawLayoutCanvas() {
  if (!S.p || currentTab() !== 'layout') return;
  const cv = lc.cv, r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  const w = r.width, h = w * S.p.meta.height / S.p.meta.width;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); cv.style.height = h + 'px'; }
  const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const k = w / S.p.meta.width;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
  if (player.readyState >= 2) ctx.drawImage(player, 0, 0, w, h);
  ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(0, 0, w, h);
  for (const [key, color, label] of layoutRects()) {
    const q = S.p.layout[key];
    const x = q.x * k, y = q.y * k, rw = q.w * k, rh = q.h * k;
    if (player.readyState >= 2) ctx.drawImage(player, q.x * player.videoWidth / S.p.meta.width, q.y * player.videoHeight / S.p.meta.height, q.w * player.videoWidth / S.p.meta.width, q.h * player.videoHeight / S.p.meta.height, x, y, rw, rh);
    ctx.strokeStyle = color; ctx.lineWidth = document.activeElement === cv && lc.active === key ? 5 : 2; ctx.strokeRect(x, y, rw, rh);
    ctx.fillStyle = color; ctx.font = 'bold 12px Segoe UI'; ctx.textBaseline = 'top';
    const tw = ctx.measureText(label).width + 10;
    ctx.fillRect(x, y, tw, 18); ctx.fillStyle = '#000'; ctx.fillText(label, x + 5, y + 3);
    ctx.fillStyle = color;
    for (const [hx, hy] of [[x, y], [x + rw, y], [x, y + rh], [x + rw, y + rh]]) ctx.fillRect(hx - 5, hy - 5, 10, 10);
  }
}
function lcHit(mx, my) {
  const k = lc.cv.getBoundingClientRect().width / S.p.meta.width;
  for (const [key] of layoutRects().reverse()) {
    const q = S.p.layout[key];
    const corners = { nw: [q.x, q.y], ne: [q.x + q.w, q.y], sw: [q.x, q.y + q.h], se: [q.x + q.w, q.y + q.h] };
    for (const [name, [cx, cy]] of Object.entries(corners)) if (Math.abs(mx - cx * k) < 9 && Math.abs(my - cy * k) < 9) return { key, mode: name };
    if (mx >= q.x * k && mx <= (q.x + q.w) * k && my >= q.y * k && my <= (q.y + q.h) * k) return { key, mode: 'move' };
  }
  return null;
}
lc.cv.addEventListener('mousedown', e => {
  const hit = lcHit(e.offsetX, e.offsetY); if (!hit) return;
  lc.drag = { ...hit, mx: e.offsetX, my: e.offsetY, orig: { ...S.p.layout[hit.key] } };
});
lc.cv.addEventListener('mousemove', e => {
  if (!lc.drag) {
    const hit = lcHit(e.offsetX, e.offsetY);
    lc.cv.style.cursor = !hit ? 'default' : hit.mode === 'move' ? 'move' : (hit.mode === 'nw' || hit.mode === 'se') ? 'nwse-resize' : 'nesw-resize';
    return;
  }
  const d = lc.drag, M = S.p.meta;
  const k = lc.cv.getBoundingClientRect().width / M.width;
  const dx = (e.offsetX - d.mx) / k, dy = (e.offsetY - d.my) / k;
  const o = d.orig; let { x, y, w, h } = o;
  if (d.mode === 'move') { x = clamp(o.x + dx, 0, M.width - o.w); y = clamp(o.y + dy, 0, M.height - o.h); }
  else {
    if (d.mode.includes('w')) { x = clamp(o.x + dx, 0, o.x + o.w - 40); w = o.x + o.w - x; }
    if (d.mode.includes('e')) { w = clamp(o.w + dx, 40, M.width - o.x); }
    if (d.mode.includes('n')) { y = clamp(o.y + dy, 0, o.y + o.h - 40); h = o.y + o.h - y; }
    if (d.mode.includes('s')) { h = clamp(o.h + dy, 40, M.height - o.y); }
  }
  S.p.layout[d.key] = { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
  drawLayoutCanvas(); drawPreview(); renderLayoutTab();
});
window.addEventListener('mouseup', () => { if (lc.drag) { lc.drag = null; markLayoutChecked(); scheduleSave(); } });
$('#btnLayoutOk').addEventListener('click', () => { markLayoutChecked(); scheduleSave(); toast(tr('Layout marked as checked'), 'ok', 2000); });

// ---------------- style tab ----------------
const FONTS = ['Impact', 'Arial Black', 'Bahnschrift', 'Segoe UI Black', 'Arial', 'Tahoma', 'Verdana'];
$$('.font-select').forEach(s => { s.innerHTML = FONTS.map(f => `<option style="font-family:'${f}'">${f}</option>`).join(''); });
function renderStyleTab() {
  const st = S.p.style;
  $$('[data-style]').forEach(el => {
    const v = st[el.dataset.style];
    if (el.type === 'checkbox') el.checked = !!v; else el.value = v;
  });
  $$('[data-out]').forEach(o => { o.textContent = st[o.dataset.out]; });
  const encSel = $('[data-style="encoder"]');
  encSel.value = st.encoder === 'gpu' && S.status?.gpu ? 'gpu' : 'cpu';
  encSel.querySelector('option[value="gpu"]').disabled = !S.status?.gpu;
  $('#gpuNote').textContent = S.status?.gpu
    ? `${tr('Graphics card')}: ${S.status.gpu}. ${tr('A little faster and smaller files, with slightly lower quality. If it fails, the processor is used automatically.')}`
    : tr('No compatible graphics encoder was found on this PC.');
  $('[data-style="captionPos"]').disabled = st.captionAuto;
  renderPresets();
}
async function loadPresets() {
  S.presets = await api('/api/presets').catch(() => []);
  renderPresets(); renderClipStyleSelect();
}
function renderPresets() {
  if (!S.p) return;
  const sel = $('#presetSelect'), cur = sel.value;
  sel.innerHTML = '<option value="">Choose a preset…</option>' + S.presets.map(p => `<option value="${esc(p.name)}">${esc(p.name)}${p.builtin ? ' (built-in)' : ''}</option>`).join('');
  if (S.presets.some(p => p.name === cur)) sel.value = cur;
  const pr = S.presets.find(p => p.name === sel.value);
  $('#btnApplyPreset').disabled = !pr;
  $('#btnDeletePreset').disabled = !pr || pr.builtin;
  const own = S.p.clips.filter(c => c.style).length;
  $('#presetInfo').textContent = own ? `${own} clip${own > 1 ? 's use their' : ' uses its'} own style (Edit clip), so changes here don't affect ${own > 1 ? 'them' : 'it'}.` : '';
}
$('#presetSelect').addEventListener('change', renderPresets);
$('#btnApplyPreset').addEventListener('click', () => {
  const pr = S.presets.find(p => p.name === $('#presetSelect').value); if (!pr) return;
  Object.assign(S.p.style, pr.style);
  scheduleSave(); renderStyleTab(); renderClipList(); renderTitleFit(); drawPreview();
  toast(`Preset "${pr.name}" applied to the project`, 'ok');
});
$('#btnSavePreset').addEventListener('click', async () => {
  const name = prompt('Name for this preset (it will be available for every video):');
  if (!name || !name.trim()) return;
  try {
    S.presets = await api('/api/presets', { method: 'POST', body: { name: name.trim(), style: S.p.style } });
    renderPresets(); $('#presetSelect').value = name.trim(); renderPresets(); renderClipStyleSelect();
    toast(`Preset "${name.trim()}" saved`, 'ok');
  } catch (e) { toast(e.message, 'err'); }
});
$('#btnDeletePreset').addEventListener('click', async () => {
  const name = $('#presetSelect').value;
  if (!name || !confirm(`Delete the preset "${name}"? Clips already using it keep their look.`)) return;
  S.presets = await api('/api/presets/delete', { method: 'POST', body: { name } });
  $('#presetSelect').value = ''; renderPresets(); renderClipStyleSelect();
});
$$('[data-style]').forEach(el => el.addEventListener('input', () => {
  const k = el.dataset.style;
  let v = el.type === 'checkbox' ? el.checked : el.value;
  if (el.type === 'range' || k === 'fps') v = Number(v);
  S.p.style[k] = v;
  $$(`[data-out="${k}"]`).forEach(o => { o.textContent = v; });
  $('[data-style="captionPos"]').disabled = S.p.style.captionAuto;
  scheduleSave(); drawPreview(); renderCaptionStatus(); renderTitleFit(); renderClipList();
}));

// ---------------- captions & AI tab ----------------
function renderCaptionsTab() {
  const st = S.status || {};
  $('#whisperMissing').classList.toggle('hidden', !!(st.whisper && st.models?.length));
  $('#wModel').innerHTML = (st.models || []).map(m => `<option>${esc(m)}</option>`).join('') || '<option value="">(no model found)</option>';
  $('#wModel').value = S.p.whisper.model;
  $('#wLang').value = S.p.whisper.language;
  $('#wTranslate').checked = !!S.p.whisper.translate;
  setVal($('#wPrompt'), S.p.whisper.prompt || '');
  renderFixes();
  $('#searchTranscript').classList.toggle('hidden', !S.transcript);
  $('#btnTranscribeFull').textContent = S.transcript ? 'Re-transcribe whole stream' : 'Transcribe whole stream';
}
$('#wModel').addEventListener('change', e => { S.p.whisper.model = e.target.value; scheduleSave(); });
$('#wLang').addEventListener('change', e => { S.p.whisper.language = e.target.value; scheduleSave(); });
$('#wTranslate').addEventListener('change', e => { S.p.whisper.translate = e.target.checked; scheduleSave(); });
$('#wPrompt').addEventListener('input', e => { S.p.whisper.prompt = e.target.value; scheduleSave(); });

// word fixes
const fixes = () => (S.p.whisper.fixes = Array.isArray(S.p.whisper.fixes) ? S.p.whisper.fixes : []);
function renderFixes() {
  const list = fixes();
  $('#fixList').innerHTML = list.length
    ? list.map((f, i) => `<div class="fix"><span>${esc(f.from)}</span><span class="muted">→</span><b>${esc(f.to)}</b><button class="icon" data-rmfix="${i}" title="Remove this fix">✕</button></div>`).join('')
    : '<div class="muted small">No fixes yet.</div>';
}
function addFix(from, to) {
  from = String(from || '').trim(); to = String(to || '').trim();
  if (!from || !to) { toast('Type both the wrong word and the correct one', 'err'); return false; }
  const list = fixes();
  const old = list.find(f => f.from.toLowerCase() === from.toLowerCase());
  if (old) old.to = to; else list.push({ from, to });
  scheduleSave(); renderFixes();
  return true;
}
async function applyFixesEverywhere() {
  await saveNow();
  try {
    const r = await api('/api/fix-words', { method: 'POST', body: { slug: slug() } });
    if (r.count || r.echo) pushAction('word fixes');
    S.p = r.project;
    rebaseHistory();
    $('#chunkList').dataset.for = '';
    renderAll();
    const msg = r.count || r.echo ? `Fixed ${r.count + (r.echo || 0)} place${r.count + (r.echo || 0) > 1 ? 's' : ''} in your captions. Render again to update finished videos.` : 'Nothing to fix in the existing captions.';
    $('#fixInfo').textContent = msg; toast(msg, r.count ? 'ok' : '');
  } catch (e) { toast(e.message, 'err'); }
}
$('#btnAddFix').addEventListener('click', () => { if (addFix($('#fixFrom').value, $('#fixTo').value)) { $('#fixFrom').value = ''; $('#fixTo').value = ''; $('#fixFrom').focus(); } });
['fixFrom', 'fixTo'].forEach(id => $('#' + id).addEventListener('keydown', e => { if (e.key === 'Enter') $('#btnAddFix').click(); }));
$('#fixList').addEventListener('click', e => {
  const i = e.target.dataset.rmfix; if (i == null) return;
  fixes().splice(+i, 1); scheduleSave(); renderFixes();
});
$('#btnApplyFixes').addEventListener('click', applyFixesEverywhere);
$('#btnFixWord').addEventListener('click', async () => {
  const from = prompt('Which word or phrase is wrong in the captions? (e.g. made)');
  if (!from || !from.trim()) return;
  const to = prompt(`Replace "${from.trim()}" with:`);
  if (to == null || !addFix(from, to)) return;
  await applyFixesEverywhere();
});
$('#btnTranscribeFull').addEventListener('click', async () => {
  await saveNow();
  try { await api('/api/transcribe-full', { method: 'POST', body: { slug: slug() } }); toast('Transcribing the whole stream. This can take a while.'); pollSoon(); }
  catch (e) { toast(e.message, 'err'); }
});
$('#searchTranscript').addEventListener('input', e => {
  const q = e.target.value.trim().toLowerCase();
  const out = $('#searchResults');
  if (!q || !S.transcript) { out.innerHTML = ''; return; }
  const W = S.transcript.words, res = [];
  for (let i = 0; i < W.length && res.length < 50; i++) {
    const win = W.slice(i, i + 10).map(w => w.w).join(' ');
    if (win.toLowerCase().startsWith(q) || W[i].w.toLowerCase().includes(q)) {
      res.push({ t: W[i].s, text: W.slice(Math.max(0, i - 4), i + 10).map(w => w.w).join(' ') });
      i += 8;
    }
  }
  const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig');
  out.innerHTML = res.map(r => `<div data-t="${r.t}"><b class="mono">${fmt(r.t, false)}</b><span>${esc(r.text).replace(re, m => `<mark>${m}</mark>`)}</span><button class="btn small ghost" data-mkclip="${r.t}" title="${esc(tr('Make a 30 s clip starting just before this'))}">${esc(tr('＋ Clip'))}</button></div>`).join('') || `<span class="muted small">${esc(tr('No matches'))}</span>`;
});
$('#searchResults').addEventListener('click', e => {
  const mk = e.target.closest('[data-mkclip]');
  if (mk) {
    const t = +mk.dataset.mkclip, dur = S.p.meta.duration;
    const a = snapEdge(Math.max(0, t - 2), 'start').t;
    const b = snapEdge(Math.min(dur, a + 30), 'end').t;
    addClipAt(a, Math.max(b, Math.min(dur, a + 5)));
    return;
  }
  const d = e.target.closest('[data-t]'); if (d) seek(+d.dataset.t);
});

// ---------------- exports ----------------
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
function openVideoModal(src, name) {
  $('#modalVideo').src = src + (src.includes('?') ? '&' : '?') + 'v=' + Date.now();
  $('#modalName').textContent = name;
  $('#modal').classList.remove('hidden');
  $('#modalClose').focus();
  $('#modalVideo').play().catch(() => {});
}
function closeModal() { $('#modal').classList.add('hidden'); $('#modalVideo').pause(); $('#modalVideo').removeAttribute('src'); }
$('#modalClose').addEventListener('click', closeModal);
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
$('#btnOpenOutput').addEventListener('click', () => api('/api/open', { method: 'POST', body: { what: 'output', slug: slug() } }));

// ---------------- live 9:16 preview ----------------
const pv = $('#preview');
function wrapWords(ctx, words, maxW, hiIdx, scale) {
  const lines = [[]]; let lw = 0; const space = ctx.measureText(' ').width;
  words.forEach((w, i) => {
    const ww = ctx.measureText(w).width * (i === hiIdx ? scale : 1);
    if (lines[lines.length - 1].length && lw + space + ww > maxW) { lines.push([]); lw = 0; }
    lines[lines.length - 1].push({ w, i, ww }); lw += (lw ? space : 0) + ww;
  });
  return { lines, space };
}
function drawPreview() {
  const ctx = pv.getContext('2d');
  const W = pv.width, H = pv.height, k = W / 1080;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#0e0e12'; ctx.fillRect(0, 0, W, H);
  if (!S.p) return;
  const c = selClip(), E = c ? eff(c) : S.p, st = E.style;
  const up = t => st.uppercase ? String(t).toLocaleUpperCase() : String(t);
  const hasTitle = !!(c && (c.title1 || c.title2));
  const L = Layout.compute(E.layout, S.p.meta, st, hasTitle);
  const ready = player.readyState >= 2 && player.videoWidth;
  const sx = ready ? player.videoWidth / S.p.meta.width : 1;
  if (ready && st.background !== 'dark') {
    ctx.save(); ctx.filter = 'blur(10px) brightness(0.7) saturate(1.15)';
    const s = Math.max(W / player.videoWidth, H / player.videoHeight);
    const dw = player.videoWidth * s, dh = player.videoHeight * s;
    ctx.drawImage(player, (W - dw) / 2, (H - dh) / 2, dw, dh); ctx.restore();
  }
  for (const it of L.items) {
    const { src, dst } = it;
    if (ready) {
      ctx.save();
      if (it.key === 'cam' && st.camBoost) ctx.filter = 'brightness(1.08) contrast(1.08)';
      ctx.drawImage(player, src.x * sx, src.y * sx, src.w * sx, src.h * sx, dst.x * k, dst.y * k, dst.w * k, dst.h * k);
      ctx.restore();
    } else {
      ctx.fillStyle = '#1d2029'; ctx.fillRect(dst.x * k, dst.y * k, dst.w * k, dst.h * k);
    }
    if (it.key === 'cam' && st.camBorder && E.layout.mode === 'split') {
      ctx.strokeStyle = st.accent; ctx.lineWidth = 6 * k; ctx.strokeRect(dst.x * k + 3 * k, dst.y * k + 3 * k, dst.w * k - 6 * k, dst.h * k - 6 * k);
    }
  }
  ctx.lineJoin = 'round'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  if (hasTitle) {
    const t1 = up(c.title1 || ''), t2 = up(c.title2 || '');
    const size = Layout.titleSize(st, t1, t2);
    ctx.font = `${size * k}px "${st.titleFont}"`;
    let y = (L.titleTop || 26) * k;
    for (const [t, col] of [[t1, st.titleColor1], [t2, st.titleColor2]]) {
      if (!t) continue;
      ctx.lineWidth = 12 * k; ctx.strokeStyle = '#000'; ctx.strokeText(t, W / 2, y);
      ctx.fillStyle = col; ctx.fillText(t, W / 2, y);
      y += size * 1.12 * k;
    }
  }
  // captions
  if (st.captions && c && c.captionsOn !== false) {
    const t = player.currentTime;
    let words = null, hi = -1;
    if (Array.isArray(c.captions) && c.captions.length) {
      const ch = c.captions.find(x => t >= x.s && t < x.e);
      if (ch) { words = ch.words.map(w => up(w.w)); hi = st.highlightMode === 'word' ? Math.max(0, ch.words.findIndex((w, i) => t >= w.s && (i === ch.words.length - 1 || t < ch.words[i + 1].s))) : -1; }
    } else {
      words = tr('CAPTIONS APPEAR HERE').split(' ').slice(0, Math.max(1, Math.min(3, st.wordsPerChunk))).map(up);
      hi = st.highlightMode === 'word' ? Math.min(1, words.length - 1) : -1;
    }
    if (words && words.length) {
      const size = st.captionSize * k;
      ctx.font = `${size}px "${st.captionFont}"`; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
      const { lines, space } = wrapWords(ctx, words, W - 140 * k, hi, 1.1);
      const lh = size * 1.15;
      let y = L.captionY * k - (lines.length - 1) * lh / 2;
      for (const line of lines) {
        const total = line.reduce((a, w) => a + w.ww, 0) + space * (line.length - 1);
        let x = (W - total) / 2;
        for (const w of line) {
          const isHi = w.i === hi;
          ctx.save();
          if (isHi) { ctx.translate(x + w.ww / 2, y); ctx.scale(1.1, 1.1); ctx.translate(-(x + w.ww / 2), -y); x += (w.ww - w.ww / 1.1) / 2; }
          ctx.lineWidth = 14 * k; ctx.strokeStyle = '#000'; ctx.strokeText(w.w, x, y);
          ctx.fillStyle = isHi ? st.captionHighlight : st.captionColor; ctx.fillText(w.w, x, y);
          ctx.restore();
          x += (isHi ? w.ww / 1.1 + (w.ww - w.ww / 1.1) / 2 : w.ww) + space;
        }
        y += lh;
      }
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    }
  }
  if (st.progressBar && c) {
    const f = clamp((player.currentTime - c.start) / (c.end - c.start), 0, 1);
    ctx.fillStyle = st.accent; ctx.fillRect(0, 1906 * k, W * f, 14 * k);
  }
  if (c && (player.currentTime < c.start - 0.05 || player.currentTime > c.end + 0.05)) {
    ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(0, H - 34, W, 34);
    ctx.fillStyle = '#c9ccd6'; ctx.font = '13px Segoe UI'; ctx.textBaseline = 'middle';
    ctx.fillText(tr('Playhead is outside this clip'), W / 2, H - 17);
  }
  // what the apps' interface covers
  const SZ = Layout.SAFE;
  if (S.safe) {
    ctx.save();
    ctx.fillStyle = 'rgba(255,70,70,.30)';
    ctx.fillRect(0, 0, W, SZ.top * k);
    ctx.fillRect(0, SZ.bottom * k, W, H - SZ.bottom * k);
    ctx.fillRect(SZ.right * k, SZ.rightTop * k, W - SZ.right * k, (SZ.bottom - SZ.rightTop) * k);
    ctx.setLineDash([6, 5]); ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = 1;
    ctx.strokeRect(SZ.left * k, SZ.top * k, (SZ.right - SZ.left) * k, (SZ.bottom - SZ.top) * k);
    ctx.setLineDash([]);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 12px Segoe UI'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(tr('App top bar'), W / 2, SZ.top * k / 2);
    ctx.fillText(tr('Description, music, buttons'), W / 2, (SZ.bottom + (1920 - SZ.bottom) / 2) * k);
    ctx.save(); ctx.translate((SZ.right + (1080 - SZ.right) / 2) * k, (SZ.rightTop + SZ.bottom) / 2 * k); ctx.rotate(-Math.PI / 2);
    ctx.fillText(tr('Like / comment / share'), 0, 0); ctx.restore();
    ctx.restore();
  }
  renderSafeWarn(c ? Layout.safeIssues(L, st, hasTitle) : []);
}

// ---------------- jobs ----------------
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

// ---------------- top bar ----------------
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
  if (!VIDEO_RE.test(f.name)) return toast(tr('Only video files can be imported') + ' (.mkv, .mp4, .mov, .webm, .flv, .avi, .ts, .m4v)', 'err');
  const t = toast(`Importing ${f.name}… 0%`, '', 0);
  const xhr = new XMLHttpRequest();
  xhr.open('PUT', `/api/upload?name=${enc(f.name)}`);
  xhr.upload.onprogress = ev => { if (ev.lengthComputable) t.textContent = `Importing ${f.name}… ${Math.round(ev.loaded / ev.total * 100)}%`; };
  xhr.onload = async () => {
    t.remove();
    if (xhr.status !== 200) { let m = 'Import failed'; try { m = JSON.parse(xhr.responseText).error; } catch { /* ignore */ } return toast(m, 'err'); }
    await loadVideos(); openVideo(f.name);
  };
  xhr.onerror = () => { t.remove(); toast('Import failed', 'err'); };
  xhr.send(f);
}
// drop a video anywhere on the window
let dragDepth = 0;
const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
window.addEventListener('dragenter', e => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; $('#dropOverlay').classList.remove('hidden'); });
window.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
window.addEventListener('dragleave', e => { if (!hasFiles(e)) return; if (--dragDepth <= 0) { dragDepth = 0; $('#dropOverlay').classList.add('hidden'); } });
window.addEventListener('drop', e => {
  if (!hasFiles(e)) return;
  e.preventDefault(); dragDepth = 0; $('#dropOverlay').classList.add('hidden');
  const f = e.dataTransfer.files[0]; if (f) importFile(f);
});

// keyboard shortcuts
const help = $('#help');
const toggleHelp = show => {
  help.classList.toggle('hidden', show === undefined ? !help.classList.contains('hidden') : !show);
  if (!help.classList.contains('hidden')) $('#helpClose').focus();
};
$('#btnHelp').addEventListener('click', () => toggleHelp(true));
$('#tlHelp').addEventListener('click', e => { e.preventDefault(); toggleHelp(true); });
$('#helpClose').addEventListener('click', () => toggleHelp(false));
help.addEventListener('click', e => { if (e.target === help) toggleHelp(false); });
let keyToast = null;
function keyFeedback(msg) { if (keyToast) keyToast.remove(); keyToast = toast(msg, '', 1800); }
window.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeModal(); toggleHelp(false); setMenu(false); setVideoMenu(false); $('#jobsDrawer').classList.add('hidden'); return; }
  const zy = (e.ctrlKey || e.metaKey) && !e.altKey ? e.key.toLowerCase() : '';
  if (zy === 'z' || zy === 'y') {
    if (e.target.matches('input, textarea')) return; // text fields undo their own typing
    e.preventDefault();
    if (zy === 'y' || e.shiftKey) redo(); else undo();
    return;
  }
  if (e.target.matches('input, select, textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
  // Space/Enter on a focused button or link should press it, not also control playback.
  if ((e.code === 'Space' || e.key === 'Enter') && e.target.closest('button, a, summary, [role="button"]')) return;
  if (e.key === '?') { e.preventDefault(); toggleHelp(); return; }
  if (!S.p) return;
  const c = selClip(), k = e.key.toLowerCase();
  if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); seek(player.currentTime - (e.shiftKey ? 5 : 1)); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); seek(player.currentTime + (e.shiftKey ? 5 : 1)); }
  else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    e.preventDefault();
    const vis = visibleClips(), i = vis.indexOf(c), n = vis[i + (e.key === 'ArrowUp' ? -1 : 1)] || (i < 0 ? vis[0] : null);
    if (n) { selectClip(n.id, true); $(`.clip[data-id="${n.id}"]`)?.scrollIntoView({ block: 'nearest' }); }
  } else if (k === 'i' || k === 'o') {
    if (!c) return keyFeedback('Select a clip first');
    const which = k === 'i' ? 'start' : 'end', before = c[which];
    const how = setClipTime(which, player.currentTime, true);
    keyFeedback(c[which] === before ? `${which === 'start' ? 'Start' : 'End'} unchanged (a clip must be at least 2 s)` : `#${clipNo(c)} ${which} set to ${fmt(c[which])} · now ${(c.end - c.start).toFixed(1)} s${how ? ` (${how})` : ''}`);
  } else if (e.key === ',' || e.key === '.' || e.key === '<' || e.key === '>') {
    // move the selected clip without changing its length
    if (!c) return keyFeedback('Select a clip first');
    const len = c.end - c.start, dt = (e.key === ',' || e.key === '<' ? -1 : 1) * (e.shiftKey ? 5 : 1);
    c.start = r1(clamp(c.start + dt, 0, S.p.meta.duration - len)); c.end = r1(c.start + len);
    S.p.clips.sort((a, b) => a.start - b.start);
    scheduleSave(); renderEditor(); renderClipList(); drawTimeline(); drawPreview(); seek(c.start);
    keyFeedback(`#${clipNo(c)} moved to ${fmt(c.start)} → ${fmt(c.end)}`);
  } else if (e.key === '+' || e.key === '=' || e.key === '-' || e.key === '_') {
    const dur = S.p.meta.duration, t = player.currentTime;
    const span = clamp((S.view[1] - S.view[0]) * (e.key === '-' || e.key === '_' ? 1.5 : 1 / 1.5), 10, dur);
    const s0 = clamp(t - span / 2, 0, dur - span);
    S.view = [s0, s0 + span]; drawTimeline();
  } else if (k === 'p') playClip();
  else if (k === 'd') quickDraft();
});
window.addEventListener('beforeunload', e => {
  rememberUi();
  if (S.p) bcPost({ type: 'closed', video: S.p.video });
  if (!S.dirty || S.conflict || !S.p) return;
  // Small projects: hand the save to the browser so it completes even as the tab closes.
  const body = JSON.stringify({ slug: S.p.slug, project: S.p });
  try {
    if (body.length < 60000 && navigator.sendBeacon('/api/project', new Blob([body], { type: 'application/json' }))) { S.dirty = false; return; }
  } catch { /* fall through */ }
  // Otherwise save now and ask the browser to confirm leaving, which gives the save time to finish.
  saveNow(); e.preventDefault(); e.returnValue = '';
});

async function checkInterrupted() {
  const list = await api('/api/interrupted').catch(() => []);
  if (!list.length) { hideBanner('interrupted'); return; }
  const names = list.slice(0, 3).map(x => x.label || x.type).join(', ') + (list.length > 3 ? ` and ${list.length - 3} more` : '');
  showBanner('interrupted', 'warn', `${list.length} task${list.length > 1 ? 's were' : ' was'} stopped when the app was closed: ${names}.`, [
    { label: 'Resume', primary: true, fn: async () => { const r = await api('/api/interrupted', { method: 'POST', body: { action: 'resume' } }); toast(`${r.length} task${r.length === 1 ? '' : 's'} added back to the queue`, 'ok'); askNotify(); pollSoon(); } },
    { label: 'Dismiss', fn: () => api('/api/interrupted', { method: 'POST', body: { action: 'dismiss' } }) },
  ]);
}

// ---------------- video options ----------------
const vmenu = $('#videoMenu');
function setVideoMenu(open) {
  vmenu.classList.toggle('hidden', !open);
  $('#btnVideoMenu').setAttribute('aria-expanded', String(open));
  if (!open) return;
  const r = $('#btnVideoMenu').getBoundingClientRect(), mw = Math.min(320, window.innerWidth - 16);
  vmenu.style.width = mw + 'px';
  vmenu.style.left = clamp(r.left, 8, window.innerWidth - mw - 8) + 'px';
  vmenu.style.top = (r.bottom + 6) + 'px';
  vmenu.querySelectorAll('[data-vm]').forEach(b => { b.disabled = !S.p; });
  if (S.p) {
    const sharp = Number(S.p.proxyHeight) === 720;
    $('#vmProxyTitle').textContent = tr(sharp ? 'Faster preview (360p)' : 'Sharper preview (720p)');
    $('#vmProxyNote').textContent = tr(sharp ? 'lighter preview copy, smoother on slow PCs; rendered shorts are not affected'
      : 'sharper player and 9:16 preview; rebuilding takes a few minutes; rendered shorts are not affected');
  }
}
$('#btnVideoMenu').addEventListener('click', e => { e.stopPropagation(); const open = vmenu.classList.contains('hidden'); setVideoMenu(open); if (open && e.detail === 0) vmenu.querySelector('[data-vm]:not(:disabled)')?.focus(); });
document.addEventListener('click', e => { if (!e.target.closest('#videoMenu') && !e.target.closest('#btnVideoMenu')) setVideoMenu(false); });
vmenu.addEventListener('click', async e => {
  const b = e.target.closest('[data-vm]'); if (!b || b.disabled || !S.p) return;
  setVideoMenu(false);
  if (b.dataset.vm === 'proxy') {
    const h = Number(S.p.proxyHeight) === 720 ? 360 : 720;
    try { await api('/api/proxy', { method: 'POST', body: { slug: slug(), height: h } }); S.p.proxyHeight = h; toast(`Building the ${h}p preview… you can keep working meanwhile.`); pollSoon(); }
    catch (err) { toast(err.message, 'err'); }
    return;
  }
  if (b.dataset.vm === 'project' || b.dataset.vm === 'output') { api('/api/open', { method: 'POST', body: { what: b.dataset.vm, slug: slug() } }).catch(err => toast(err.message, 'err')); return; }
  const file = S.p.video, sl = S.p.slug;
  if (!confirm(`Start "${file}" over?\nIts clips, titles, captions, word fixes and analysis go to the Recycle Bin. Finished shorts in the output folder are kept.`)) return;
  try {
    await saveNow();
    await api('/api/project/reset', { method: 'POST', body: { slug: sl } });
    HIST.delete(sl); try { localStorage.removeItem('ui:' + sl); } catch { /* ignore */ }
    S.p = null; S.dirty = false; S.sel = null;
    await openVideo(file);
    toast(tr('This video starts fresh. The old project is in the Recycle Bin.'), 'ok', 6000);
  } catch (err) { toast(err.message, 'err'); }
});

// ---------------- language ----------------
$('#langSelect').value = I18N.lang;
$('#langSelect').addEventListener('change', async e => { await saveNow(); rememberUi(); I18N.set(e.target.value); });

// ---------------- boot ----------------
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
