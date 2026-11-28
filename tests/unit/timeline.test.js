'use strict';
// Unit: the timeline engine (model + compiler to ffmpeg inputs).
const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('../fixtures/baseline.json');
const { variants, clip: baseClip, meta } = require('../fixtures/make-baseline.js');
const Layout = require('../../app/public/layout.js');
const { STYLE_DEFAULTS, sanitizeProject } = require('../../app/src/core/project');
const { keptParts, mapTime, remapCaptions, buildTimeline, compileTimeline, inputArgs, pauseCuts } = require('../../app/src/core/timeline');

const project = (extra = {}) => ({ video: 'demo.mp4', meta: { duration: 600, width: 1920, height: 1080, fps: 30, hasAudio: true }, style: { ...STYLE_DEFAULTS },
  layout: { mode: 'split', camOnTop: true, cam: { x: 1400, y: 680, w: 520, h: 390 }, game: { x: 0, y: 0, w: 1920, h: 1080 } }, ...extra });
const words = (t0, n) => Array.from({ length: n }, (_, i) => ({ w: 'w' + i, s: t0 + i * 0.5, e: t0 + i * 0.5 + 0.4 }));

test('a plain clip compiles to exactly what the renderer always made (every baseline layout)', () => {
  for (const [name, v] of Object.entries(variants)) {
    const p = { video: 'demo.mp4', meta: v.meta || meta, layout: v.layout, style: v.style, whisper: { prompt: '', fixes: [] }, publish: { hashtags: '#shorts #test' } };
    const out = compileTimeline(p, baseClip, buildTimeline(p, baseClip));
    assert.equal(out.filter, B.render[name].filter, name);
    assert.equal(out.ass, B.render[name].ass, name);
    assert.deepEqual(out.inputs, []);
    assert.deepEqual(out.seek, { start: baseClip.start, length: baseClip.end - baseClip.start });
    assert.equal(Layout.renderSig(p, baseClip), B.render[name].sig, 'fingerprints of existing shorts are unchanged');
  }
});

test('cuts: kept parts, time mapping, lengths', () => {
  assert.deepEqual(keptParts(100, 130, []), [{ start: 100, end: 130 }]);
  assert.deepEqual(keptParts(100, 130, [{ start: 105, end: 110 }, { start: 120, end: 125 }]), [{ start: 100, end: 105 }, { start: 110, end: 120 }, { start: 125, end: 130 }]);
  assert.deepEqual(keptParts(100, 130, [{ start: 90, end: 102 }, { start: 128, end: 200 }]), [{ start: 102, end: 128 }], 'cuts beyond the clip are clipped');
  assert.deepEqual(keptParts(100, 130, [{ start: 104, end: 112 }, { start: 108, end: 115 }]), [{ start: 100, end: 104 }, { start: 115, end: 130 }], 'overlapping cuts merge');
  const parts = keptParts(100, 130, [{ start: 105, end: 110 }]);
  assert.equal(mapTime(parts, 100), 0);
  assert.equal(mapTime(parts, 104), 4);
  assert.equal(mapTime(parts, 107), null, 'cut out');
  assert.equal(mapTime(parts, 112), 7);
});

test('cuts: the short gets shorter, the graph joins the parts, captions move with the speech', () => {
  const p = project();
  const clip = { id: 'c', start: 100, end: 130, title1: 'HI', captionsOn: true,
    captions: [{ s: 101, e: 103, words: words(101, 4) }, { s: 106, e: 108, words: words(106, 4) }, { s: 112, e: 114, words: words(112, 4) }],
    cuts: [{ start: 105, end: 110 }] };
  const tl = buildTimeline(p, clip);
  assert.equal(tl.duration, 25);
  const out = compileTimeline(p, clip, tl);
  assert.match(out.filter, /\[0:v\]trim=start=0:end=5,setpts=PTS-STARTPTS\[cv0\]/);
  assert.match(out.filter, /\[0:v\]trim=start=10:end=30,setpts=PTS-STARTPTS\[cv1\]/);
  assert.match(out.filter, /concat=n=2:v=1:a=1\[vcut\]\[acut\]/);
  assert.match(out.filter, /\[vcut\]fps=30/);
  assert.match(out.filter, /^\[0:a\]loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000,asplit=2\[la0\]\[la1\]/m, 'normalized before cutting');
  assert.match(out.filter, /^\[acut\]aresample=48000,afade/m, 'not normalized twice');
  assert.match(out.filter, /fade=t=out:st=24\.50/, 'fades use the new length');
  // the line spoken inside the cut is gone; the one after it moved 5 s earlier
  const ev = out.ass.split('\n').filter(l => l.startsWith('Dialogue: 2,')).map(l => l.split(',')[1]);
  assert.ok(ev.includes('0:00:01.00'), 'first line unchanged');
  assert.ok(!ev.some(t => t.startsWith('0:00:06')), 'line inside the cut dropped');
  assert.ok(ev.includes('0:00:07.00'), 'line after the cut at 112 - 5 = 107 -> 7 s');
  assert.deepEqual(out.seek, { start: 100, length: 30 });
});

test('a cut at the very start: the source is read from the first kept moment', () => {
  const p = project();
  const clip = { id: 'c', start: 100, end: 130, captionsOn: false, cuts: [{ start: 100, end: 103 }] };
  const out = compileTimeline(p, clip, buildTimeline(p, clip));
  assert.deepEqual(out.seek, { start: 103, length: 27 });
  assert.equal(out.duration, 27);
  assert.doesNotMatch(out.filter, /trim=/, 'one part: no joining needed');
});

test('text and image overlays, music with ducking, hidden tracks', () => {
  const p = project();
  const clip = { id: 'c', start: 100, end: 130, title1: 'TITLE', captionsOn: true, captions: [{ s: 101, e: 103, words: words(101, 3) }],
    texts: [{ text: 'WAIT FOR IT', start: 2, end: 6, pos: 'top', size: 80, color: '#FFD400' }],
    images: [{ file: 'logo.png', start: 0, end: 30, pos: 'top-right', size: 0.2, opacity: 0.8 }],
    music: { file: 'beat.mp3', volume: 0.3, from: 12, fadeIn: 1, fadeOut: 2, duck: true } };
  let out = compileTimeline(p, clip, buildTimeline(p, clip));
  assert.match(out.ass, /^Style: Overlay,/m);
  assert.match(out.ass, /Dialogue: 3,0:00:02\.00,0:00:06\.00,Overlay,.*\\pos\(540,330\)\\fs80\\c&H0000D4FF&.*WAIT FOR IT/);
  assert.deepEqual(out.inputs, [{ kind: 'image', file: 'logo.png' }, { kind: 'audio', file: 'beat.mp3', from: 12, loop: true }]);
  assert.match(out.filter, /\[1:v\]scale=216:-2,format=rgba,colorchannelmixer=aa=0\.8\[im0\]/);
  assert.match(out.filter, /overlay=824:200:enable='between\(t,0,30\)'/);
  assert.match(out.filter, /\[2:a\]aresample=48000.*volume=0\.3.*\[mu\]/);
  assert.match(out.filter, /sidechaincompress/);
  assert.match(out.filter, /amix=inputs=2:duration=first:normalize=0\[a\]/);
  assert.deepEqual(inputArgs(out.inputs, 'S', 30, 30, (a, b) => a + '/' + b),
    ['-loop', '1', '-framerate', '30', '-t', '30', '-i', 'S/logo.png', '-stream_loop', '-1', '-ss', '12', '-i', 'S/beat.mp3']);
  // hidden tracks are left out; locked ones are only an editor setting
  out = compileTimeline(p, { ...clip, tracks: { title: { hidden: true }, captions: { hidden: true }, images: { hidden: true }, music: { hidden: true }, stream: { hidden: true }, texts: { locked: true } } },
    buildTimeline(p, { ...clip, tracks: { title: { hidden: true }, captions: { hidden: true }, images: { hidden: true }, music: { hidden: true }, stream: { hidden: true }, texts: { locked: true } } }));
  assert.doesNotMatch(out.ass, /Dialogue: [12],/, 'no title, no captions');
  assert.match(out.ass, /WAIT FOR IT/, 'locked text is still rendered');
  assert.deepEqual(out.inputs, []);
  assert.match(out.filter, /anullsrc=r=48000:cl=stereo,atrim=0:30\[a\]/, 'stream muted');
});

test('overlays follow cuts; music without ducking; no-audio sources', () => {
  const p = project({ meta: { duration: 600, width: 1920, height: 1080, fps: 30, hasAudio: false } });
  const clip = { id: 'c', start: 100, end: 130, captionsOn: false, cuts: [{ start: 105, end: 110 }],
    texts: [{ text: 'A', start: 1, end: 4 }, { text: 'GONE', start: 6, end: 9 }, { text: 'B', start: 12, end: 15 }],
    music: { file: 'm.wav', duck: false } };
  const tl = buildTimeline(p, clip);
  assert.deepEqual(tl.tracks.find(t => t.id === 'texts').items.map(o => [o.text, o.start, o.end]), [['A', 1, 4], ['B', 7, 10]]);
  const out = compileTimeline(p, clip, tl);
  assert.match(out.filter, /concat=n=2:v=1:a=0\[vcut\]/);
  assert.doesNotMatch(out.filter, /\[0:a\]/);
  assert.match(out.filter, /\[st\]\[mu\]amix/);
  assert.doesNotMatch(out.filter, /sidechaincompress/);
});

test('captions remapped across a cut keep their order and never overlap the cut', () => {
  const parts = keptParts(0, 20, [{ start: 5, end: 8 }]);
  const caps = remapCaptions([{ s: 4, e: 6, words: [{ w: 'a', s: 4, e: 4.6 }, { w: 'b', s: 5.2, e: 5.6 }, { w: 'c', s: 7.6, e: 8.4 }] }], parts, 0);
  assert.deepEqual(caps[0].words.map(w => [w.w, w.s, w.e]), [['a', 4, 4.6], ['c', 5, 5.4]]);
});

test('pauses become cuts, keeping a little silence around the words', () => {
  const w = [{ s: 10, e: 11 }, { s: 11.2, e: 12 }, { s: 14, e: 15 }, { s: 15.3, e: 16 }];
  assert.deepEqual(pauseCuts(w, 9, 20, 0.8, 0.15), [{ start: 9.15, end: 9.85 }, { start: 12.15, end: 13.85 }, { start: 16.15, end: 19.85 }]);
  assert.deepEqual(pauseCuts(w, 9, 20, 5), [], 'no pause that long');
});

test('fingerprint: timeline fields mark a short outdated only when used', () => {
  const p = project();
  const clip = { id: 'c', start: 100, end: 130, title1: 'X' };
  const sig = Layout.renderSig(p, clip);
  assert.equal(Layout.renderSig(p, { ...clip, cuts: [], texts: [], tracks: {} }), sig, 'empty fields change nothing');
  assert.equal(Layout.renderSig(p, { ...clip, tracks: { texts: { locked: true } } }), sig, 'locking is not a visible change');
  for (const change of [{ cuts: [{ start: 101, end: 102 }] }, { texts: [{ text: 'A', start: 0, end: 1 }] }, { music: { file: 'm.mp3' } }, { tracks: { title: { hidden: true } } }]) {
    assert.notEqual(Layout.renderSig(p, { ...clip, ...change }), sig, JSON.stringify(change));
  }
});

test('timeline fields from a project file are validated', () => {
  const p = sanitizeProject({ video: 'v.mp4', meta: { duration: 600 }, clips: [{ id: 'a', start: 100, end: 130,
    cuts: [{ start: 105, end: 110 }, { start: 50, end: 60 }, { start: 'x', end: 1 }],
    texts: [{ text: 'Hi {\\pos(0,0)}\nthere', start: 1, end: 3, pos: 'nowhere', size: 9999, color: 'red' }, { text: '', start: 1, end: 2 }],
    images: [{ file: '../../etc/passwd.png', start: 0, end: 1 }, { file: 'logo.png', start: 0, end: 5, pos: 'top-left', size: 0.5 }],
    music: { file: 'C:\\evil.mp3' }, tracks: { title: { hidden: 1 }, bogus: { hidden: true } } }] });
  const c = p.clips[0];
  assert.deepEqual(c.cuts, [{ start: 105, end: 110 }]);
  assert.equal(c.texts.length, 1);
  assert.ok(!/[{}\\\n]/.test(c.texts[0].text));
  assert.deepEqual([c.texts[0].pos, c.texts[0].size, c.texts[0].color], ['middle', 72, '#FFFFFF']);
  assert.deepEqual(c.images.map(i => i.file), ['logo.png']);
  assert.equal(c.music, undefined);
  assert.deepEqual(c.tracks, { title: { hidden: true, locked: false } });
});
