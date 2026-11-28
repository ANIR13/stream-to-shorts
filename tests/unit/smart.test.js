'use strict';
// Unit: smart detection (multi-signal scoring). Synthetic streams where the right answer is known.
const test = require('node:test');
const assert = require('node:assert/strict');
const { findCandidates, DETECT_DEFAULTS } = require('../../app/src/core/detection');
const { findSmartCandidates, smartSettings, tagWords, contextOf, SMART_DEFAULTS } = require('../../app/src/core/smart');
const Timing = require('../../app/public/timing.js');

function rng(seed) { return () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }; }

// Words of a sentence spoken from t, about 3 words per second.
function say(t, text) {
  return text.split(' ').map((w, i) => ({ w, s: Math.round((t + i * 0.33) * 100) / 100, e: Math.round((t + i * 0.33 + 0.28) * 100) / 100 }));
}

// A 10-minute stream: steady background talk and sound, plus
//   100-130 s  very loud, busy screen, nobody says anything meaningful (music / noise)
//   300-330 s  quiet voice explaining something ("the trick is…"), a question and its answer
//   450-480 s  a joke: a setup, then laughter and "let's go!" (moderately loud)
//   200-215 s  gaming: "clutch", "GG", "let's go"
function stream() {
  const rnd = rng(9);
  const n = 600;
  const rms = Array.from({ length: n }, () => -38 + rnd() * 4);
  const scene = Array.from({ length: n }, () => 0.02 + rnd() * 0.02);
  for (let i = 100; i < 130; i++) { rms[i] = -12 + rnd() * 2; scene[i] = 0.6; }
  for (let i = 455; i < 470; i++) rms[i] = -26;
  for (let i = 200; i < 212; i++) rms[i] = -28;
  let words = [];
  for (let t = 5; t < 590; t += 12) if (!(t > 95 && t < 135) && !(t > 290 && t < 335) && !(t > 440 && t < 495) && !(t > 190 && t < 220)) words = words.concat(say(t, 'okay so we go there and we look around a little bit.'));
  words = words.concat(
    say(300, 'Did you know the trick is to wait for the second wave?'),
    say(305, 'Because the boss resets its shield after exactly ten seconds, and most people never notice it.'),
    say(313, 'That is the secret of every fast run.'),
    say(318, 'Remember it, it changes everything.'),
    say(450, 'So my friend tells me he can do it blindfolded, and he puts the scarf on and starts the level.'),
    say(460, 'And he walks straight into the lava.'),
    say(463, 'HAHAHA no way! haha'),
    say(466, "let's goooo!"),
    say(200, 'one versus three, clutch clutch!'),
    say(204, "GG let's go! headshot!"),
  );
  words.sort((a, b) => a.s - b.s);
  return { rms, scene, words, n };
}
const overlaps = (c, a, b) => c.start < b && c.end > a;

test('fast engine unchanged: still finds only the loud moment first', () => {
  const s = stream();
  const fast = findCandidates(s.rms, s.scene, { ...DETECT_DEFAULTS, count: 3, length: 30 });
  assert.ok(overlaps(fast[0], 100, 130), 'loudest first');
  assert.ok(!fast.some(c => overlaps(c, 300, 330)), 'the quiet explanation is invisible to sound and action');
});

test('smart engine: finds the quiet explanation, the joke and the gaming moment', () => {
  const s = stream();
  const smart = findSmartCandidates({ rms: s.rms, scene: s.scene, words: s.words }, { ...DETECT_DEFAULTS, ...SMART_DEFAULTS, engine: 'smart', count: 4, length: 30 });
  const at = (a, b) => smart.find(c => overlaps(c, a, b));
  for (const [a, b, what] of [[300, 330, 'quiet explanation'], [450, 470, 'joke and laughter'], [200, 212, 'gaming clutch'], [100, 130, 'loud moment']]) {
    assert.ok(at(a, b), `${what} found (${smart.map(c => `${c.start}-${c.end}:${c.score}`).join(', ')})`);
  }
  const quiet = at(300, 330);
  assert.ok(quiet.parts.semantic > 0.5, 'semantic importance is high');
  assert.ok(quiet.parts.audio < 0.2, 'and the audio is not');
  assert.ok(quiet.reasons.some(r => r.k === 'quiet'), 'explained as a quiet but meaningful moment');
  assert.ok(quiet.reasons.some(r => r.k === 'insight'));
  assert.ok(quiet.reasons.some(r => r.k === 'qa'), 'question and answer');
  const joke = at(450, 470);
  assert.ok(joke.parts.emotion > 0.5);
  assert.ok(joke.reasons.some(r => r.k === 'laughter'));
  assert.ok(joke.reasons.some(r => r.k === 'punchline'), 'setup then reaction');
  const game = at(200, 212);
  assert.ok(game.reasons.some(r => r.k === 'event' && /clutch|gg|headshot/i.test(r.w)));
  // every reason that points at a time points inside its clip
  for (const c of smart) for (const r of c.reasons) if (r.t != null) assert.ok(r.t >= c.start - 0.05 && r.t <= c.end, JSON.stringify(r));
});

test('smart engine: the formula, the weights and the 0-100 score', () => {
  const s = stream();
  const opts = { ...DETECT_DEFAULTS, ...SMART_DEFAULTS, count: 6, length: 30 };
  for (const c of findSmartCandidates({ rms: s.rms, scene: s.scene, words: s.words }, opts)) {
    const w = c.weights, p = c.parts;
    const sum = w.audio + w.visual + w.semantic + w.emotion + w.context;
    const expected = Math.round(100 * (w.audio * p.audio + w.visual * p.visual + w.semantic * p.semantic + w.emotion * p.emotion + w.context * p.context) / sum);
    assert.ok(Math.abs(c.score - expected) <= 1, `score ${c.score} = Σ w·signal (${expected})`);
    for (const v of Object.values(p)) assert.ok(v >= 0 && v <= 1);
  }
  // only sound and action: the words don't matter any more
  const av = findSmartCandidates({ rms: s.rms, scene: s.scene, words: s.words }, { ...opts, wS: 0, wE: 0, wC: 0, count: 1 });
  assert.ok(overlaps(av[0], 100, 130));
  // only meaning: the loud empty moment is not first
  const sem = findSmartCandidates({ rms: s.rms, scene: s.scene, words: s.words }, { ...opts, wA: 0, wV: 0, wE: 0, wC: 0, wS: 1, count: 1 });
  assert.ok(!overlaps(sem[0], 100, 130));
  // all weights 0 is not allowed: defaults come back
  assert.deepEqual(smartSettings({ wA: 0, wV: 0, wS: 0, wE: 0, wC: 0 }), { ...SMART_DEFAULTS, engine: 'fast' });
  assert.equal(smartSettings({ engine: 'smart', wA: 7, wS: -1 }).wA, 1);
});

test('smart engine: clips are valid and start and end on pauses, never mid-word', () => {
  const s = stream();
  const clips = findSmartCandidates({ rms: s.rms, scene: s.scene, words: s.words }, { ...DETECT_DEFAULTS, ...SMART_DEFAULTS, count: 12, length: 40, gap: 3 });
  assert.ok(clips.length >= 8);
  const sorted = [...clips].sort((a, b) => a.start - b.start);
  sorted.forEach((c, i) => {
    assert.ok(c.start >= 0 && c.start < c.end && c.end <= s.n, `${c.start}-${c.end}`);
    assert.ok(c.end - c.start >= 10 && c.end - c.start <= 60);
    if (i) assert.ok(sorted[i - 1].end + 3 <= c.start + 1e-9, 'spacing between moments');
    for (const t of [c.start, c.end]) assert.ok(!s.words.some(w => t > w.s + 1e-9 && t < w.e - 1e-9), `edge ${t} cuts a word`);
  });
  // same input, same result
  assert.deepEqual(findSmartCandidates({ rms: s.rms, scene: s.scene, words: s.words }, { ...DETECT_DEFAULTS, ...SMART_DEFAULTS }),
    findSmartCandidates({ rms: s.rms, scene: s.scene, words: s.words }, { ...DETECT_DEFAULTS, ...SMART_DEFAULTS }));
});

test('smart engine without a transcript follows sound and action only', () => {
  const s = stream();
  const clips = findSmartCandidates({ rms: s.rms, scene: s.scene, words: [] }, { ...DETECT_DEFAULTS, ...SMART_DEFAULTS, count: 2, length: 30 });
  assert.ok(overlaps(clips[0], 100, 130));
  for (const c of clips) { assert.equal(c.parts.semantic, 0); assert.equal(c.parts.emotion, 0); assert.equal(c.parts.context, 0); }
  assert.deepEqual(findSmartCandidates({ rms: [], scene: [], words: [] }, { ...DETECT_DEFAULTS }), []);
});

test('words: English and French cues, accents, stretched words, capitals, laughter tags', () => {
  const t = tagWords([
    { w: 'MDR', s: 0, e: 1 }, { w: "c'est", s: 1, e: 1.2 }, { w: 'ouf!', s: 1.2, e: 1.5 }, { w: 'Génial', s: 2, e: 2.4 },
    { w: 'nooooon', s: 3, e: 3.5 }, { w: '(rires)', s: 4, e: 5 }, { w: 'en', s: 5, e: 5.1 }, { w: 'fait', s: 5.1, e: 5.3 },
    { w: 'Pourquoi?', s: 6, e: 6.4 }, { w: 'killed', s: 7, e: 7.3 }, { w: 'LAUGHING', s: 8, e: 8.4 },
  ]);
  const kinds = i => t[i].tags.map(x => x.kind);
  assert.ok(kinds(0).includes('laughter'));
  assert.ok(kinds(1).includes('excitement'), "c'est ouf");
  assert.ok(t[2].exclaim);
  assert.ok(kinds(3).includes('excitement'), 'génial without accent');
  assert.ok(t[4].stretched);
  assert.ok(kinds(5).includes('laughter'), 'whisper tag (rires)');
  assert.ok(kinds(6).includes('insight'), 'en fait');
  assert.ok(t[8].ask && kinds(8).includes('question'));
  assert.ok(kinds(9).includes('event'), 'kill* matches killed');
  assert.ok(t[10].caps);
});

test('context: complete sentences, question and answer, setup and punchline', () => {
  const words = tagWords([].concat(
    say(10, 'Why does it always break here?'),
    say(13, 'Because the wall is thin and the bullets go through it, every single time we play.'),
    say(20, 'And then he jumps and everybody laughs haha.'),
  ));
  const full = contextOf(words, 9.5, 24);
  assert.ok(full.value >= 0.9, JSON.stringify(full));
  assert.deepEqual(full.reasons.map(r => r.k).sort(), ['complete', 'punchline', 'qa'].sort());
  const cut = contextOf(words, 11.1, 17);
  assert.ok(cut.value < full.value);
  assert.ok(!cut.reasons.some(r => r.k === 'complete'), 'starting mid-sentence is not complete');
  assert.deepEqual(contextOf(words, 100, 120), { value: 0, reasons: [] });
  // snapping is consistent with the editor's rules
  const segs = Timing.speechSegments(words);
  assert.ok(segs.length >= 2);
});
