'use strict';
// Unit: very long recordings. A 4-hour stream means 14,400 seconds of signals, ~50,000 transcript words
// and hundreds of clips: the pure logic must stay fast (generous time limits, for slow CI machines).
const test = require('node:test');
const assert = require('node:assert/strict');
const { findCandidates, DETECT_DEFAULTS } = require('../../app/src/core/detection');
const { findSmartCandidates, SMART_DEFAULTS } = require('../../app/src/core/smart');
const { sanitizeProject, mergeClientSave } = require('../../app/src/core/project');
const { buildTimeline, compileTimeline, pauseCuts } = require('../../app/src/core/timeline');
const { STYLE_DEFAULTS } = require('../../app/src/core/project');
const Timing = require('../../app/public/timing.js');
const Layout = require('../../app/public/layout.js');

const HOURS = 4, N = HOURS * 3600;
function rng(seed) { return () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }; }
const rnd = rng(1);
const rms = Array.from({ length: N }, (_, i) => -40 + rnd() * 10 + (i % 1800 < 30 ? 20 : 0));
const scene = Array.from({ length: N }, () => rnd() * 0.1);
const words = [];
// speech with a pause of 1.5 s every 20 words or so, like real talking
for (let t = 0; t < N - 1 && words.length < 50000; t += 0.4 + rnd() * 0.6 + (words.length % 20 === 0 ? 1.5 : 0)) words.push({ w: ['so', 'clutch', 'haha', 'the', 'trick', 'is', 'wait', 'GG!'][Math.floor(rnd() * 8)], s: Math.round(t * 100) / 100, e: Math.round((t + 0.3) * 100) / 100 });
const ms = fn => { const t0 = process.hrtime.bigint(); const r = fn(); return [r, Number(process.hrtime.bigint() - t0) / 1e6]; };

test(`${HOURS} h stream: fast detection`, () => {
  const [c, t] = ms(() => findCandidates(rms, scene, { ...DETECT_DEFAULTS, count: 40 }));
  assert.equal(c.length, 40);
  assert.ok(t < 4000, `${Math.round(t)} ms`);
});

test(`${HOURS} h stream, ${words.length} words: smart detection`, () => {
  const [c, t] = ms(() => findSmartCandidates({ rms, scene, words }, { ...DETECT_DEFAULTS, ...SMART_DEFAULTS, count: 40 }));
  assert.equal(c.length, 40);
  for (const x of c) assert.ok(x.start >= 0 && x.end <= N && x.start < x.end);
  assert.ok(t < 20000, `${Math.round(t)} ms`);
});

test('speech snapping over the whole transcript stays instant', () => {
  const [segs, t1] = ms(() => Timing.speechSegments(words));
  assert.ok(segs.length > 1000 && t1 < 2000, `${segs.length} segments in ${Math.round(t1)} ms`);
  const [, t2] = ms(() => { for (let i = 0; i < 300; i++) Timing.snapEdge(i * 47.3, i % 2 ? 'start' : 'end', { segs, duration: N }); });
  assert.ok(t2 < 3000, `300 snaps in ${Math.round(t2)} ms`);
});

test('a project with 500 clips and their captions: validation, saving, fingerprints, timelines', () => {
  const clips = Array.from({ length: 500 }, (_, i) => ({ id: 'c' + i, num: i + 1, start: i * 28, end: i * 28 + 25, title1: 'CLIP ' + i, captionsOn: true,
    captions: Array.from({ length: 20 }, (_, k) => ({ s: i * 28 + k, e: i * 28 + k + 0.9, words: [{ w: 'word', s: i * 28 + k, e: i * 28 + k + 0.4 }] })),
    cuts: [{ start: i * 28 + 5, end: i * 28 + 6 }], texts: [{ text: 'HI', start: 1, end: 3 }] }));
  const p = { video: 'long.mp4', slug: 'long', meta: { duration: N, width: 1920, height: 1080, hasAudio: true }, style: { ...STYLE_DEFAULTS },
    layout: { mode: 'split', camOnTop: true, cam: { x: 1400, y: 680, w: 520, h: 390 }, game: { x: 0, y: 0, w: 1920, h: 1080 } }, clips, rev: 0 };
  const [, t1] = ms(() => sanitizeProject(p));
  const [, t2] = ms(() => mergeClientSave(p, { rev: 0, clips: structuredClone(clips) }));
  const [, t3] = ms(() => p.clips.forEach(c => Layout.renderSig(p, c)));
  const [, t4] = ms(() => p.clips.forEach(c => compileTimeline(p, c, buildTimeline(p, c))));
  const [cuts, t5] = ms(() => pauseCuts(words, 0, N));
  assert.ok(cuts.length > 100);
  for (const [name, t, limit] of [['validate', t1, 2000], ['merge a save', t2, 2000], ['fingerprints', t3, 3000], ['compile 500 timelines', t4, 5000], ['pauses of 4 h', t5, 2000]]) {
    assert.ok(t < limit, `${name}: ${Math.round(t)} ms`);
  }
});
