'use strict';
// The page state (S) and saving the open project.

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

let saveTimer = null;
function setSave(t) { $('#saveState').textContent = t; }
function scheduleSave() {
  recordHistory();
  S.dirty = true; setSave('Unsaved…');
  clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 500);
}
