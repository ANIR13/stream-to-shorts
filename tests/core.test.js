'use strict';
// Core logic must produce exactly the outputs recorded in tests/fixtures/baseline.json
// (made with the code before the modular refactor, on synthetic data).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const B = require('./fixtures/baseline.json');
const Layout = require('../app/public/layout.js');
const detection = require('../app/src/core/detection');
const captions = require('../app/src/core/captions');
const render = require('../app/src/core/render');
const upload = require('../app/src/core/upload');
const project = require('../app/src/core/project');

const { rms, scene, words } = B.input;

test('detection: every recorded setting gives the same clips and scores', () => {
  for (const [opts, expected] of Object.entries(B.detect)) {
    assert.deepEqual(detection.findCandidates(rms, scene, JSON.parse(opts)), expected, opts);
  }
});

test('detection: settings are sanitized the same way', () => {
  assert.deepEqual(detection.detectSettings({}), B.detectSettings[0]);
  assert.deepEqual(detection.detectSettings({ wAudio: 0, wPeak: 0, wVisual: 0, gap: -5, count: 999, length: 3 }), B.detectSettings[1]);
});

test('detection: replace / add modes', () => {
  const old = [{ start: 0, end: 10 }, { start: 50, end: 60 }];
  const fresh = [{ start: 5, end: 15 }, { start: 30, end: 40 }];
  assert.deepEqual(detection.mergeDetected(old, fresh, 'replace'), fresh);
  assert.deepEqual(detection.mergeDetected(old, fresh, 'add').map(c => c.start), [0, 30, 50]);
});

test('detection: ffmpeg metadata parsing', () => {
  const text = 'frame:0 pts:0 pts_time:0\nlavfi.astats.Overall.RMS_level=-23.5\nframe:1 pts:8000 pts_time:1\nlavfi.astats.Overall.RMS_level=-inf\n';
  assert.deepEqual(detection.parseMeta(text, 'lavfi.astats.Overall.RMS_level'), [[0, -23.5], [1, -90]]);
});

test('captions: chunking, word fixes, hint-word echo, trimming', () => {
  assert.deepEqual(captions.chunkWords(words, 3), B.captions);
  assert.deepEqual(captions.applyFixes(words, [{ from: 'made in two', to: 'mate in two' }, { from: 'check made', to: 'checkmate' }]), B.applyFixes);
  const echoWords = 'Chess stream: checkmate, mate in two, en passant, castling, blunder. Oh so here'.split(' ').map((w, i) => ({ w, s: i, e: i + 0.9 }));
  assert.deepEqual(captions.stripEchoChunks(captions.chunkWords(echoWords, 3), 'Chess stream: checkmate, mate in two, en passant, castling, blunder.'), B.echo);
  assert.deepEqual(captions.keepChunks(B.captions, 102, 106.5), B.keepChunks);
});

test('captions: whisper output parsing', () => {
  const j = { transcription: [{ text: ' Hello', offsets: { from: 0, to: 500 } }, { text: ' [MUSIC]', offsets: { from: 500, to: 900 } }, { text: ' world!', offsets: { from: 900, to: 1400 } }] };
  assert.deepEqual(captions.parseWhisper(j, 10), [{ w: 'Hello', s: 10, e: 10.5 }, { w: 'world!', s: 10.9, e: 11.4 }]);
});

test('render: subtitle file, filter graph and render signature are unchanged for every layout', () => {
  const clip = { id: 'c1', num: 3, start: 100, end: 130, title1: 'THE COMEBACK', title2: 'NOBODY SAW COMING', captionsOn: true, captions: B.captions, captionsRange: [100, 130] };
  for (const [name, exp] of Object.entries(B.render)) {
    const meta = name === 'noAudio' ? { width: 1920, height: 1080, duration: 1800, fps: 30, hasAudio: false } : { width: 1920, height: 1080, duration: 1800, fps: 30, hasAudio: true };
    const v = { split: [exp.layout] }; void v;
    const p = { video: 'demo.mp4', meta, layout: null, style: null, whisper: { prompt: '', fixes: [] }, publish: { hashtags: '#shorts #test' } };
    // rebuild the variant's project from what the baseline recorded
    Object.assign(p, variantOf(name));
    const L = Layout.compute(p.layout, p.meta, p.style, true);
    assert.deepEqual(L, exp.layout, name + ' layout');
    assert.equal(render.buildASS(p, clip, L, 30), exp.ass, name + ' ass');
    assert.equal(render.buildFilter(p, L, 30), exp.filter, name + ' filter');
    assert.equal(Layout.renderSig(p, clip), exp.sig, name + ' signature');
  }
});

test('render: names, drafts and encoder arguments', () => {
  assert.equal(render.shortName({ num: 7, title1: 'THE COMEBACK', title2: '' }), 'short_07_the_comeback.mp4');
  assert.match(render.draftFilter('x,format=yuv420p[v];y'), /scale=540:960,format=yuv420p\[v\]/);
  assert.deepEqual(render.cpuEncoderArgs(false, 18).slice(0, 6), ['-c:v', 'libx264', '-preset', 'medium', '-crf', '18']);
  assert.equal(render.cpuEncoderArgs(true, 18)[3], 'ultrafast');
});

test('upload text', () => {
  const clip = { id: 'c1', num: 3, start: 100, end: 130, title1: 'THE COMEBACK', title2: 'NOBODY SAW COMING', captions: B.captions };
  assert.deepEqual(upload.uploadText({ publish: { hashtags: '#shorts #test' } }, clip), B.uploadText);
  assert.equal(upload.sentence('11 SECONDS LEFT'), '11 seconds left');
  assert.equal(upload.txtName('short_01_a.mp4'), 'short_01_a.txt');
});

test('project: clip numbers and browser saves', () => {
  const p = { clips: [{ id: 'a', num: 2 }, { id: 'b' }, { id: 'c', num: 2 }] };
  project.ensureNums(p);
  assert.deepEqual(p.clips.map(c => c.num), [2, 3, 4]);
  const stored = { rev: 1, clips: [{ id: 'a', num: 5, output: 'x.mp4', captionsVer: 2, captions: ['server'] }] };
  assert.throws(() => project.mergeClientSave(structuredClone(stored), { rev: 0, clips: [] }), e => e.code === 409);
  const merged = project.mergeClientSave(structuredClone(stored), { rev: 1, clips: [{ id: 'a', output: 'hacked', captionsVer: 1, captions: ['stale'] }] });
  assert.equal(merged.rev, 2);
  assert.equal(merged.clips[0].output, 'x.mp4');          // server-only field kept
  assert.equal(merged.clips[0].num, 5);                    // permanent number kept
  assert.deepEqual(merged.clips[0].captions, ['server']);  // newer server captions win over a stale save
});

// The six layouts recorded in the baseline (same definitions as tests/fixtures/make-baseline.js).
function variantOf(name) {
  const baseStyle = {
    titleFont: 'Impact', titleSize: 86, titleColor1: '#FFFFFF', titleColor2: '#FFD400', accent: '#FFD400', captions: true,
    captionFont: 'Impact', captionSize: 84, captionColor: '#FFFFFF', captionHighlight: '#FFD400', highlightMode: 'word',
    wordsPerChunk: 3, uppercase: true, captionAuto: true, captionPos: 62, background: 'blur', camBorder: true, camBoost: true,
    progressBar: true, fps: 30, crf: 20, loudnorm: true,
  };
  const layout = { mode: 'split', camOnTop: true, cam: { x: 1384, y: 674, w: 512, h: 382 }, game: { x: 0, y: 120, w: 1360, h: 765 } };
  return {
    split: { layout, style: baseStyle },
    splitCamBottom: { layout: { ...layout, camOnTop: false }, style: baseStyle },
    gameplay: { layout: { ...layout, mode: 'gameplay' }, style: { ...baseStyle, background: 'dark', progressBar: false } },
    cam: { layout: { ...layout, mode: 'cam' }, style: { ...baseStyle, highlightMode: 'none', uppercase: false } },
    titleSafe: { layout, style: { ...baseStyle, titleSafe: true, captionAuto: false, captionPos: 70 } },
    noAudio: { layout, style: baseStyle },
  }[name];
}
void path;
