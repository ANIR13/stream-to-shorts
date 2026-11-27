// Records the outputs of the current code on synthetic data, so a refactor can prove it changed nothing.
// Run once from the project folder (before refactoring):  node tests/fixtures/make-baseline.js
// It writes tests/fixtures/baseline.json. All inputs are generated here: no real recording data.
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..', '..');
const srv = require(path.join(root, 'app', 'server.js'));
const Layout = require(path.join(root, 'app', 'public', 'layout.js'));

// deterministic pseudo-random numbers
let seed = 42;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };

// 30 minutes of per-second loudness (dB) and scene scores with a few "highlights"
const n = 1800;
const rms = [], scene = [];
for (let i = 0; i < n; i++) {
  const hype = [300, 610, 905, 1210, 1500].some(c => Math.abs(i - c) < 25) ? 14 : 0;
  rms.push(Math.round((-38 + hype + rnd() * 10 - 5) * 10) / 10);
  scene.push(Math.round((rnd() * 0.05 + ([450, 1100, 1650].some(c => Math.abs(i - c) < 8) ? 0.4 : 0)) * 1000) / 1000);
}

const words = [];
'no way this actually works watch this move right here everyone thought it was over but then he found the trick and that is the game. made in two! check made, wow.'
  .split(' ').forEach((w, i) => words.push({ w, s: Math.round((100 + i * 0.42) * 100) / 100, e: Math.round((100.38 + i * 0.42) * 100) / 100 }));
const captions = srv.chunkWords(words, 3);

const meta = { width: 1920, height: 1080, duration: n, fps: 30, hasAudio: true };
const baseStyle = {
  titleFont: 'Impact', titleSize: 86, titleColor1: '#FFFFFF', titleColor2: '#FFD400', accent: '#FFD400', captions: true,
  captionFont: 'Impact', captionSize: 84, captionColor: '#FFFFFF', captionHighlight: '#FFD400', highlightMode: 'word',
  wordsPerChunk: 3, uppercase: true, captionAuto: true, captionPos: 62, background: 'blur', camBorder: true, camBoost: true,
  progressBar: true, fps: 30, crf: 20, loudnorm: true,
};
const layout = { mode: 'split', camOnTop: true, cam: { x: 1384, y: 674, w: 512, h: 382 }, game: { x: 0, y: 120, w: 1360, h: 765 } };
const clip = { id: 'c1', num: 3, start: 100, end: 130, title1: 'THE COMEBACK', title2: 'NOBODY SAW COMING', captionsOn: true, captions, captionsRange: [100, 130] };

const variants = {
  split: { layout, style: baseStyle },
  splitCamBottom: { layout: { ...layout, camOnTop: false }, style: baseStyle },
  gameplay: { layout: { ...layout, mode: 'gameplay' }, style: { ...baseStyle, background: 'dark', progressBar: false } },
  cam: { layout: { ...layout, mode: 'cam' }, style: { ...baseStyle, highlightMode: 'none', uppercase: false } },
  titleSafe: { layout, style: { ...baseStyle, titleSafe: true, captionAuto: false, captionPos: 70 } },
  noAudio: { layout, style: baseStyle, meta: { ...meta, hasAudio: false } },
};
const render = {};
for (const [name, v] of Object.entries(variants)) {
  const p = { video: 'demo.mp4', meta: v.meta || meta, layout: v.layout, style: v.style, whisper: { prompt: '', fixes: [] }, publish: { hashtags: '#shorts #test' } };
  const hasTitle = true;
  const L = Layout.compute(p.layout, p.meta, p.style, hasTitle);
  const dur = clip.end - clip.start;
  render[name] = { layout: L, ass: srv.buildASS(p, clip, L, dur), filter: srv.buildFilter(p, L, dur), sig: Layout.renderSig(p, clip) };
}

const detect = {};
for (const opts of [{}, { count: 5, length: 30 }, { count: 8, length: 20, wAudio: 0, wPeak: 1, wVisual: 0 }, { count: 6, length: 40, wVisual: 2, gap: 120 }, { count: 40, length: 60 }]) {
  detect[JSON.stringify(opts)] = srv.findCandidates(rms, scene, opts);
}

const fixes = [{ from: 'made in two', to: 'mate in two' }, { from: 'check made', to: 'checkmate' }];
const baseline = {
  input: { rms, scene, words },
  detect,
  detectSettings: [srv.detectSettings({}), srv.detectSettings({ wAudio: 0, wPeak: 0, wVisual: 0, gap: -5, count: 999, length: 3 })],
  captions,
  applyFixes: srv.applyFixes(words, fixes),
  echo: srv.stripEchoChunks(srv.chunkWords([...'Chess stream: checkmate, mate in two, en passant, castling, blunder. Oh so here'.split(' ')].map((w, i) => ({ w, s: i, e: i + 0.9 })), 3), 'Chess stream: checkmate, mate in two, en passant, castling, blunder.'),
  keepChunks: srv.keepChunks(captions, 102, 106.5),
  uploadText: srv.uploadText({ publish: { hashtags: '#shorts #test' } }, clip),
  render,
};
fs.writeFileSync(path.join(__dirname, 'baseline.json'), JSON.stringify(baseline, null, 1));
console.log('baseline written:', Object.keys(baseline).join(', '));
process.exit(0);
