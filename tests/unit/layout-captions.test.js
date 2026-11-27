'use strict';
// Unit: the 9:16 frame and caption timing. Every layout fits a 1080 x 1920 frame, and captions are
// timed from the words' own timestamps, so they stay in sync with the audio.
const test = require('node:test');
const assert = require('node:assert/strict');
const Layout = require('../../app/public/layout.js');
const { STYLE_DEFAULTS } = require('../../app/src/core/project');
const { parseWhisper, chunkWords } = require('../../app/src/core/captions');
const { buildASS, buildFilter, draftFilter } = require('../../app/src/core/render');

function rng(seed) { return () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }; }
const SOURCES = [[1920, 1080], [1280, 720], [2560, 1440], [3840, 2160], [1080, 1920], [720, 480], [640, 360]];

test('layout: every mode, source size and box fits inside the 1080 x 1920 frame', () => {
  const rnd = rng(5);
  for (let run = 0; run < 3000; run++) {
    const [width, height] = SOURCES[run % SOURCES.length];
    const meta = { width, height };
    const box = () => ({ x: rnd() * width * 1.2 - 50, y: rnd() * height * 1.2 - 50, w: rnd() * width, h: rnd() * height });
    const layout = { mode: ['split', 'gameplay', 'cam'][run % 3], camOnTop: rnd() < 0.5, cam: box(), game: box() };
    const style = { ...STYLE_DEFAULTS, titleSafe: rnd() < 0.5, captionAuto: rnd() < 0.7, captionPos: rnd() * 100 };
    const L = Layout.compute(layout, meta, style, rnd() < 0.5);
    assert.equal(L.W, 1080); assert.equal(L.H, 1920);
    for (const it of L.items) {
      const { src, dst } = it;
      assert.ok(dst.x >= 0 && dst.y >= 0 && dst.x + dst.w <= 1080 && dst.y + dst.h <= 1920, `${layout.mode} ${width}x${height}: ${JSON.stringify(dst)}`);
      assert.ok(dst.w % 2 === 0 && dst.h % 2 === 0, 'even sizes (required by the video encoder)');
      assert.ok(src.x >= 0 && src.y >= 0 && src.x + src.w <= width && src.y + src.h <= height, `crop inside the source: ${JSON.stringify(src)}`);
    }
    assert.ok(L.captionY >= 0 && L.captionY <= 1920);
  }
});

test('render graph: the finished short is 1080 x 1920 (drafts 540 x 960)', () => {
  for (const mode of ['split', 'gameplay', 'cam']) {
    for (const background of ['blur', 'dark']) {
      const p = { meta: { width: 1920, height: 1080, hasAudio: true }, layout: { mode, cam: { x: 1400, y: 700, w: 500, h: 360 }, game: { x: 0, y: 0, w: 1920, h: 1080 } }, style: { ...STYLE_DEFAULTS, background } };
      const L = Layout.compute(p.layout, p.meta, p.style, true);
      const f = buildFilter(p, L, 30);
      // the background every layer is drawn on is the full frame
      assert.match(f, background === 'blur' ? /scale=1080:1920,setsar=1\[bg\]/ : /s=1080x1920:.*\[bg\]/);
      assert.match(f, /format=yuv420p\[v\]/);
      assert.match(draftFilter(f), /scale=540:960,format=yuv420p\[v\]/);
    }
  }
});

// Caption events of an ASS file: [{ start, end, text }] in seconds.
function captionEvents(ass) {
  const sec = t => { const [h, m, s] = t.split(':'); return Number(h) * 3600 + Number(m) * 60 + Number(s); };
  return ass.split('\n').filter(l => l.startsWith('Dialogue: 2,')).map(l => {
    const [, start, end] = l.split(',');
    return { start: sec(start), end: sec(end), text: l };
  });
}

test('captions sync: whisper timestamps -> caption lines -> subtitle events, relative to the clip start', () => {
  // whisper.cpp output for the audio of [100 s, 110 s] (offsets in ms from the start of that range)
  const spoken = [['Wait', 1200, 1500], ['for', 1550, 1700], ['it.', 1750, 2100], ['Here', 4000, 4300], ['it', 4350, 4500], ['comes!', 4550, 5200]];
  const j = { transcription: spoken.map(([text, from, to]) => ({ text: ' ' + text, offsets: { from, to } })) };
  const clip = { start: 100, end: 110 };
  const words = parseWhisper(j, clip.start);
  assert.deepEqual(words.map(w => [w.w, w.s, w.e]), spoken.map(([w, a, b]) => [w, 100 + a / 1000, 100 + b / 1000]));
  const captions = chunkWords(words, 3);
  const p = { style: { ...STYLE_DEFAULTS }, meta: { width: 1920, height: 1080 } };
  const L = { captionY: 1200, titleTop: 26 };
  const events = captionEvents(buildASS(p, { ...clip, captions, captionsOn: true }, L, 10));
  // word-by-word highlight: the event that highlights a word starts when that word is spoken
  // (the first word of a line: when the line appears) and lasts until the next word starts
  assert.equal(events.length, spoken.length);
  spoken.forEach(([w, from], i) => {
    const ev = events[i];
    assert.match(ev.text, new RegExp(`\\\\fscy110\\}${w.toUpperCase().replace(/[.!]/g, '\\$&')}`));
    assert.ok(Math.abs(ev.start - from / 1000) < 0.011, `${w}: shown at ${ev.start}s, spoken at ${from / 1000}s`);
    assert.ok(ev.end > ev.start);
  });
  // static lines: each line is on screen exactly while it is spoken (plus the short hold chunkWords adds)
  const lines = captionEvents(buildASS({ ...p, style: { ...p.style, highlightMode: 'line' } }, { ...clip, captions, captionsOn: true }, L, 10));
  captions.forEach((ch, i) => {
    assert.ok(Math.abs(lines[i].start - (ch.s - clip.start)) < 0.011);
    assert.ok(Math.abs(lines[i].end - (ch.e - clip.start)) < 0.011);
    assert.ok(ch.e >= ch.words[ch.words.length - 1].e, 'a line stays until its last word is spoken');
  });
});

test('captions sync: words outside the clip are not shown, partial lines are cut at the clip edges', () => {
  const p = { style: { ...STYLE_DEFAULTS, highlightMode: 'line' }, meta: { width: 1920, height: 1080 } };
  const captions = [
    { s: 95, e: 99, words: [{ w: 'before', s: 95, e: 99 }] },
    { s: 99.5, e: 100.8, words: [{ w: 'edge', s: 99.5, e: 100.8 }] },
    { s: 109.5, e: 111, words: [{ w: 'after', s: 109.5, e: 111 }] },
    { s: 112, e: 113, words: [{ w: 'gone', s: 112, e: 113 }] },
  ];
  const ev = captionEvents(buildASS(p, { start: 100, end: 110, captions, captionsOn: true }, { captionY: 1200 }, 10));
  assert.deepEqual(ev.map(e => [e.start, e.end]), [[0, 0.8], [9.5, 11]]);
});
