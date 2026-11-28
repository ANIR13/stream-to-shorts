'use strict';
// Undo / redo of edits, per video.

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
