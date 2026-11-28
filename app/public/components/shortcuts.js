'use strict';
// Keyboard shortcuts and the help overlay.

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
