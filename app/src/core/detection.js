'use strict';
// Highlight detection: pure functions on the per-second analysis signals (no files, no ffmpeg).
const { movingAvg, zscore, clampNum } = require('../shared/stats');

// Auto-detect settings. The defaults reproduce the original detection exactly.
const DETECT_DEFAULTS = { count: 12, length: 55, wAudio: 1, wPeak: 0.5, wVisual: 0.3, gap: 3 };

function detectSettings(d = {}) {
  const o = {
    count: Math.round(clampNum(d.count, 1, 40, DETECT_DEFAULTS.count)),
    length: Math.round(clampNum(d.length, 10, 60, DETECT_DEFAULTS.length)),
    wAudio: clampNum(d.wAudio, 0, 3, DETECT_DEFAULTS.wAudio),
    wPeak: clampNum(d.wPeak, 0, 3, DETECT_DEFAULTS.wPeak),
    wVisual: clampNum(d.wVisual, 0, 3, DETECT_DEFAULTS.wVisual),
    gap: clampNum(d.gap, 0, 600, DETECT_DEFAULTS.gap),
  };
  if (!o.wAudio && !o.wPeak && !o.wVisual) Object.assign(o, { wAudio: 1, wPeak: 0.5, wVisual: 0.3 }); // all off makes no sense
  return o;
}

// Three signals per second, each normalized against the whole stream (robust z-score: how far above
// a typical moment, in "typical deviations"):
//   audio  = sustained loudness over ~12 s (excitement, shouting, music)
//   peak   = the loudest instant within ±2 s (sudden spikes: a scream, an explosion)
//   visual = on-screen change over ~8 s (scene score from the analysis), capped at 3
// The moment score is their weighted sum. Picks go from the best down, skipping any clip that would
// come closer than `gap` seconds to one already picked (temporal diversity).
function findCandidates(rms, scene, opts = {}) {
  const { count, length, wAudio, wPeak, wVisual, gap } = detectSettings(opts);
  const n = rms.length;
  if (!n) return [];
  const energy = rms.map(d => Math.pow(10, d / 10));
  const loud = movingAvg(energy, 12).map(v => 10 * Math.log10(v + 1e-12));
  const peak = rms.map((_, i) => Math.max(...rms.slice(Math.max(0, i - 2), i + 3)));
  const act = movingAvg(scene, 8);
  const lz = zscore(loud), pz = zscore(peak), sz = zscore(act).map(v => Math.min(3, v));
  const score = lz.map((v, i) => wAudio * v + wPeak * pz[i] + wVisual * sz[i]);
  const L = Math.min(length, Math.max(10, n - 2));
  // exact ties (e.g. on-screen action alone, which is capped) go to the louder moment, not the earliest one
  const order = score.map((s, i) => [s, i]).sort((a, b) => b[0] - a[0] || lz[b[1]] - lz[a[1]]);
  const picked = [];
  const r2 = v => Math.round(v * 100) / 100;
  for (const [s, i] of order) {
    if (picked.length >= count) break;
    let start = Math.round(i - 0.6 * L);
    start = Math.max(0, Math.min(start, n - L - 1));
    const end = start + L;
    if (picked.some(c => start < c.end + gap && end > c.start - gap)) continue;
    picked.push({ start, end, peak: i, raw: s, parts: { audio: r2(lz[i]), peak: r2(pz[i]), visual: r2(sz[i]) } });
  }
  const max = Math.max(...picked.map(c => c.raw), 1);
  const weights = { audio: wAudio, peak: wPeak, visual: wVisual };
  return picked.map(c => ({ ...c, score: Math.round(100 * Math.max(0, c.raw) / max), weights }));
}

function candidatesToClips(cands, now = Date.now()) {
  return cands.map((c, i) => ({
    id: 'c' + now.toString(36) + i, start: c.start, end: c.end, score: c.score,
    scoreParts: c.parts, scoreWeights: c.weights, scorePeak: c.peak,
    title1: '', title2: '', selected: true, captionsOn: true, captions: null,
  }));
}

// Add detected clips to a project's clip list: replace all, or add only those that don't overlap.
function mergeDetected(clips, fresh, mode) {
  const out = mode === 'replace' ? fresh.slice() : clips.slice();
  if (mode !== 'replace') for (const c of fresh) if (!out.some(o => c.start < o.end && c.end > o.start)) out.push(c);
  return out.sort((x, y) => x.start - y.start);
}

// Values from ffmpeg's "ametadata/metadata print" output: [[time, value], ...]. -inf becomes -90.
function parseMeta(text, key) {
  const out = [];
  let t = 0;
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/pts_time:([\d.]+)/);
    if (m) { t = parseFloat(m[1]); continue; }
    const i = line.indexOf(key + '=');
    if (i >= 0) {
      const raw = line.slice(i + key.length + 1).trim();
      const v = raw.includes('inf') ? -90 : parseFloat(raw);
      if (Number.isFinite(v)) out.push([t, v]);
    }
  }
  return out;
}

module.exports = { DETECT_DEFAULTS, detectSettings, findCandidates, candidatesToClips, mergeDetected, parseMeta };
