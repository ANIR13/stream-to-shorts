'use strict';
// Unit: clip times. Start is always before end, edges stay inside the video, and speech snapping
// never puts an edge in the middle of a word.
const test = require('node:test');
const assert = require('node:assert/strict');
const Timing = require('../../app/public/timing.js');
const { findCandidates, candidatesToClips, mergeDetected, DETECT_DEFAULTS } = require('../../app/src/core/detection');
const { mergeClientSave } = require('../../app/src/core/project');

// deterministic pseudo-random numbers, so a failure can be reproduced
function rng(seed) { return () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }; }

// Spoken words with short gaps inside sentences and real pauses (>= 0.25 s) between them.
function speech(rnd, seconds) {
  const words = [];
  let t = rnd() * 2;
  while (t < seconds) {
    const n = 1 + Math.floor(rnd() * 8);
    for (let k = 0; k < n && t < seconds; k++) {
      const len = 0.12 + rnd() * 0.5;
      const last = k === n - 1;
      words.push({ w: 'w' + words.length + (last && rnd() < 0.4 ? '.' : ''), s: Math.round(t * 100) / 100, e: Math.round((t + len) * 100) / 100 });
      t += len + rnd() * 0.2;                                       // gap inside a phrase (< 0.25 s)
    }
    t += 0.25 + rnd() * 1.6;                                        // pause between phrases
  }
  return words;
}
const insideWord = (t, words) => words.find(w => t > w.s + 1e-9 && t < w.e - 1e-9);

test('clip times: detected clips always start before they end, inside the video, without overlapping', () => {
  const rnd = rng(7);
  for (let run = 0; run < 200; run++) {
    const n = 20 + Math.floor(rnd() * 3000);
    const rms = Array.from({ length: n }, () => -60 + rnd() * 50);
    const scene = Array.from({ length: n }, () => rnd() * rnd());
    const opts = { count: 1 + Math.floor(rnd() * 40), length: 5 + Math.floor(rnd() * 70), gap: Math.floor(rnd() * 30), wAudio: rnd() * 3, wPeak: rnd() * 3, wVisual: rnd() * 3 };
    const clips = candidatesToClips(findCandidates(rms, scene, opts), 1);
    for (const c of clips) {
      assert.ok(c.start >= 0 && c.start < c.end && c.end <= n, `run ${run}: ${c.start}-${c.end} in ${n} s`);
    }
    const merged = mergeDetected(clips.slice(0, 3), clips, 'add');
    for (let i = 1; i < merged.length; i++) assert.ok(merged[i - 1].start <= merged[i].start, 'sorted by start');
  }
  // degenerate inputs
  assert.deepEqual(findCandidates([], [], DETECT_DEFAULTS), []);
  for (const c of findCandidates([-20, -10, -30], [0, 0, 0], DETECT_DEFAULTS)) assert.ok(c.start < c.end);
});

test('clip times: moving an edge keeps start < end, at least 2 s, inside the video', () => {
  const rnd = rng(11);
  for (let run = 0; run < 5000; run++) {
    const dur = rnd() < 0.05 ? rnd() * 3 : 1 + rnd() * 4000;          // includes videos shorter than 2 s
    let c = Timing.normalize({ start: rnd() * dur, end: rnd() * dur }, dur);
    for (let k = 0; k < 5; k++) {
      const which = rnd() < 0.5 ? 'start' : 'end';
      const t = (rnd() * 1.4 - 0.2) * dur;                              // sometimes before 0 or after the end
      c = Timing.setEdge(c, which, t, dur);
      assert.ok(c.start >= 0 && c.end <= dur + 1e-9, `inside: ${JSON.stringify(c)} / ${dur}`);
      assert.ok(c.start < c.end, `start before end: ${JSON.stringify(c)}`);
      assert.ok(c.end - c.start >= Math.min(Timing.MIN_CLIP, dur) - 0.051, `long enough: ${JSON.stringify(c)} / ${dur}`);
    }
  }
});

test('clip times: invalid values are repaired', () => {
  assert.deepEqual(Timing.normalize({ start: 30, end: 10 }, 100), { start: 10, end: 30 });      // reversed
  assert.deepEqual(Timing.normalize({ start: 50, end: 50 }, 100), { start: 50, end: 52 });      // empty
  assert.deepEqual(Timing.normalize({ start: 99.5, end: 99.5 }, 100), { start: 98, end: 100 }); // empty at the end
  assert.deepEqual(Timing.normalize({ start: -5, end: 500 }, 100), { start: 0, end: 100 });     // outside
  assert.deepEqual(Timing.normalize({ start: 'x', end: null }, 100), { start: 0, end: 2 });     // not numbers
  assert.deepEqual(Timing.normalize({ start: 0, end: 0 }, 1.5), { start: 0, end: 1.5 });        // video shorter than 2 s
});

test('clip times: a project saved from the browser never stores a clip that ends before it starts', () => {
  const p = { rev: 0, meta: { duration: 600 }, clips: [] };
  mergeClientSave(p, { rev: 0, clips: [{ id: 'a', start: 300, end: 120 }, { id: 'b', start: 590, end: 900 }, { id: 'c', start: 10, end: 40 }] });
  assert.deepEqual(p.clips.map(c => [c.start, c.end]), [[120, 300], [590, 600], [10, 40]]);
});

test('speech snapping: an edge never lands in the middle of a word', () => {
  const rnd = rng(3);
  let snapped = 0;
  for (let run = 0; run < 300; run++) {
    const words = speech(rnd, 120);
    const segs = Timing.speechSegments(words);
    for (let k = 0; k < 60; k++) {
      const t = Math.round(rnd() * 1200) / 10;
      for (const which of ['start', 'end']) {
        const r = Timing.snapEdge(t, which, { segs, duration: 130 });
        if (!r.how) continue;                                           // nothing to snap to: edge kept as is
        snapped++;
        const w = insideWord(r.t, words);
        assert.ok(!w, `${which} ${t} -> ${r.t} cuts "${w && w.w}" (${w && w.s}-${w && w.e})`);
        assert.ok(Math.abs(r.t - t) <= Timing.SNAP_RANGE + 0.051, 'moves at most 1.5 s');
      }
    }
  }
  assert.ok(snapped > 10000, 'the property was really exercised');
});

test('speech snapping: a nearby pause is always used, sentence ends are preferred', () => {
  const words = [{ w: 'so', s: 10, e: 10.3 }, { w: 'yes.', s: 10.4, e: 10.8 }, { w: 'and', s: 12.0, e: 12.3 }, { w: 'then', s: 12.35, e: 12.7 }];
  const segs = Timing.speechSegments(words);
  assert.deepEqual(segs.map(s => [s[0], s[1]]), [[10, 10.8], [12, 12.7]]);   // 0.1 s and 0.05 s gaps don't split
  const end = Timing.snapEdge(10.6, 'end', { segs, duration: 60 });
  assert.equal(end.how, 'end of a sentence');
  assert.ok(end.t >= 10.8 && end.t <= 12.0);
  const start = Timing.snapEdge(12.5, 'start', { segs, duration: 60 });
  assert.ok(start.t >= 10.8 && start.t <= 12.0 && start.how);
  // in the middle of a long monologue (no pause within 1.5 s) the edge is left where the user put it
  const talk = Array.from({ length: 100 }, (_, i) => ({ w: 'w', s: i * 0.3, e: i * 0.3 + 0.28 }));
  assert.deepEqual(Timing.snapEdge(15.05, 'end', { segs: Timing.speechSegments(talk), duration: 60 }), { t: 15.05 });
});

test('speech snapping: with no words, quiet moments are used, and snapping can be off', () => {
  const loud = Array.from({ length: 30 }, (_, i) => (i === 12 ? 0.05 : 0.8));
  assert.deepEqual(Timing.snapEdge(11.2, 'end', { segs: [], duration: 30, loudNorm: loud }), { t: 12.5, how: 'quiet moment' });
  assert.deepEqual(Timing.snapEdge(11.2, 'end', { segs: [], duration: 30 }), { t: 11.2 });
});
