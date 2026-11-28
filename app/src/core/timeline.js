'use strict';
// Timeline engine: what a short is made of, as data, and how that data becomes ffmpeg inputs.
// Pure functions (no files, no programs).
//
//   clip (project data)  --buildTimeline-->  timeline (tracks)  --compileTimeline-->  { ass, filter, inputs, duration }
//
// The timeline is the single description of a short. The renderer, the live preview and the editor read
// it instead of each interpreting clip fields their own way, and new kinds of content are added as tracks.
//
// Tracks (top to bottom of the picture, then sound):
//   video    background, gameplay, facecam   the layers of the layout (core/../public/layout.js)
//   image    picture overlays                files from the source folder (logo, emoji, screenshot)
//   text     title, captions, text overlays  rendered with the subtitle renderer (libass)
//   audio    stream sound, music             music can duck under speech
// Every track has `hidden` (left out of the render) and `locked` (the editor won't change it).
// Cuts remove parts of a clip; the remaining parts are joined (jump cuts) and every timed item is
// moved to the new times. Fades in and out are the transitions at the clip edges.
const Layout = require('../../public/layout.js');
const { buildASS, buildFilter } = require('./render');

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const AUDIO_EXT = new Set(['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac', '.opus']);
// Track ids a user can hide or lock (video layers follow the layout mode instead).
const TRACK_IDS = ['title', 'captions', 'texts', 'images', 'stream', 'music', 'timing'];
const TEXT_POS = { top: 330, middle: 960, bottom: 1450 };
const r2 = v => Math.round(v * 100) / 100;

// ---- cuts ----
// The parts of [start, end] kept after removing `cuts` (absolute source times), in order.
function keptParts(start, end, cuts = []) {
  const removed = (cuts || []).map(c => [Math.max(start, Number(c.start)), Math.min(end, Number(c.end))])
    .filter(([a, b]) => b - a >= 0.05).sort((x, y) => x[0] - y[0]);
  const out = [];
  let t = start;
  for (const [a, b] of removed) {
    if (a > t) out.push({ start: t, end: a });
    t = Math.max(t, b);
  }
  if (end > t) out.push({ start: t, end });
  return out.filter(p => p.end - p.start >= 0.05).map(p => ({ start: r2(p.start), end: r2(p.end) }));
}
// Source time -> time in the short (null when that moment was cut out).
function mapTime(parts, t) {
  let acc = 0;
  for (const p of parts) {
    if (t >= p.start && t <= p.end) return acc + (t - p.start);
    acc += p.end - p.start;
  }
  return null;
}
const lengthOf = parts => parts.reduce((n, p) => n + p.end - p.start, 0);

// Caption lines moved to the short's times, written as `base` + short time so the subtitle builder
// keeps measuring from the start it is given. A word is kept when its middle was kept; words that
// were cut out are dropped, and so are lines left without words.
function remapCaptions(captions, parts, base) {
  if (!Array.isArray(captions)) return captions;
  if (parts.length === 1 && parts[0].start === base) return captions;   // nothing moves
  const out = [];
  for (const ch of captions) {
    const words = (ch.words || []).map(w => {
      const mid = (w.s + w.e) / 2;
      const q = parts.find(p => mid >= p.start && mid <= p.end);
      if (!q) return null;
      return { ...w, s: r2(base + mapTime(parts, Math.max(w.s, q.start))), e: r2(base + mapTime(parts, Math.min(w.e, q.end))) };
    }).filter(Boolean);
    if (!words.length) continue;
    const lastE = words[words.length - 1].e;
    const hold = mapTime(parts, ch.e);   // the line stays up after its last word, unless that time was cut
    out.push({ ...ch, s: words[0].s, e: hold != null && base + hold >= lastE ? r2(base + hold) : lastE, words });
  }
  return out;
}

// ---- the model ----
// p: the project as seen by the clip (Layout.effective). window (optional): { start, end } to build only
// part of the clip (quick drafts). Returns the timeline.
function buildTimeline(p, clip, window = null) {
  const tracks = clip.tracks || {};
  const hidden = id => !!(tracks[id] && tracks[id].hidden);
  const locked = id => !!(tracks[id] && tracks[id].locked);
  const from = window ? Math.max(clip.start, window.start) : clip.start;
  const to = window ? Math.min(clip.end, window.end) : clip.end;
  const parts = keptParts(from, to, clip.cuts);
  const duration = r2(lengthOf(parts));
  const hasTitle = !!(clip.title1 || clip.title2) && !hidden('title');
  const L = Layout.compute(p.layout, p.meta, p.style, hasTitle);
  const at = t => mapTime(parts, t);   // clip-relative times of overlays are converted below
  // overlays are timed relative to the clip start (before cuts); convert to the short's time
  const timed = list => (Array.isArray(list) ? list : []).map(o => {
    const a = at(clip.start + Number(o.start)), b = at(clip.start + Number(o.end));
    const s = a == null ? firstAfter(parts, clip.start + Number(o.start)) : a;
    const e = b == null ? lastBefore(parts, clip.start + Number(o.end)) : b;
    return e > s ? { ...o, start: r2(s), end: r2(e) } : null;
  }).filter(Boolean);
  return {
    width: Layout.W, height: Layout.H, fps: Number(p.style.fps) || 30,
    source: { file: p.video, start: from, end: to }, parts, duration, layout: L,
    transitions: { fadeIn: 0.3, fadeOut: 0.5 },
    tracks: [
      { id: 'video', kind: 'video', layers: L.items.map(it => it.key), background: p.style.background !== 'dark' ? 'blur' : 'dark', locked: locked('timing') },
      { id: 'images', kind: 'image', hidden: hidden('images'), locked: locked('images'), items: timed(clip.images) },
      { id: 'title', kind: 'text', hidden: hidden('title'), locked: locked('title') },
      { id: 'captions', kind: 'text', hidden: hidden('captions'), locked: locked('captions'),
        items: remapCaptions(clip.captions, parts, from) },
      { id: 'texts', kind: 'text', hidden: hidden('texts'), locked: locked('texts'), items: timed(clip.texts) },
      { id: 'stream', kind: 'audio', hidden: hidden('stream'), locked: locked('stream') },
      { id: 'music', kind: 'audio', hidden: hidden('music') || !clip.music || !clip.music.file, locked: locked('music'), item: clip.music || null },
    ],
  };
}
const firstAfter = (parts, t) => { let acc = 0; for (const p of parts) { if (p.start >= t) return acc; acc += p.end - p.start; } return acc; };
const lastBefore = (parts, t) => { let acc = 0, last = 0; for (const p of parts) { if (p.end <= t) { acc += p.end - p.start; last = acc; } else break; } return last; };
const track = (tl, id) => tl.tracks.find(t => t.id === id);

// ---- the compiler ----
// Returns { ass, filter, inputs, duration, seek }: inputs are the extra ffmpeg inputs after the
// source (input 0), in order: [{ kind: 'image' | 'audio', file, from?, loop? }].
// The source input is read from seek.start for seek.length seconds.
function compileTimeline(p, clip, tl) {
  const L = tl.layout;
  const inputs = [];
  const images = track(tl, 'images');
  const imgs = images.hidden ? [] : images.items.map(im => {
    inputs.push({ kind: 'image', file: im.file });
    const w = Math.round(1080 * Math.min(1, Math.max(0.05, Number(im.size) || 0.3)));
    const pos = im.pos || 'top-right';
    const x = /left/.test(pos) ? 40 : /right/.test(pos) ? 1080 - 40 - w : (1080 - w) / 2;
    const y = /^top/.test(pos) ? 200 : /^bottom/.test(pos) ? 1450 : 800;
    return { input: inputs.length, x, y, w, start: im.start, end: im.end, opacity: im.opacity == null ? 1 : Number(im.opacity) };
  });
  const music = track(tl, 'music');
  let m = null;
  if (!music.hidden) {
    const mu = music.item;
    inputs.push({ kind: 'audio', file: mu.file, from: Number(mu.from) || 0, loop: mu.loop !== false });
    m = { input: inputs.length, gain: Number(mu.volume == null ? 0.25 : mu.volume), fadeIn: Number(mu.fadeIn == null ? 1 : mu.fadeIn), fadeOut: Number(mu.fadeOut == null ? 1.5 : mu.fadeOut), duck: mu.duck !== false };
  }
  const texts = track(tl, 'texts');
  const s0 = tl.parts[0] ? tl.parts[0].start : tl.source.start;   // the source is read from here
  const x = {
    cuts: tl.parts.length > 1 ? tl.parts.map(q => ({ a: q.start - s0, b: q.end - s0 })) : null,
    images: imgs, music: m, muteStream: track(tl, 'stream').hidden,
    texts: texts.hidden ? [] : texts.items.map(o => ({ text: o.text, start: o.start, end: o.end, y: TEXT_POS[o.pos] || TEXT_POS.middle, size: Number(o.size) || 72, color: o.color || '#FFFFFF' })),
    hideTitle: track(tl, 'title').hidden, hideCaptions: track(tl, 'captions').hidden,
  };
  const viewClip = { ...clip, start: tl.source.start, captions: track(tl, 'captions').items };
  const plain = !x.cuts && !imgs.length && !m && !x.muteStream && !x.texts.length && !x.hideTitle && !x.hideCaptions;
  const last = tl.parts[tl.parts.length - 1];
  return {
    ass: plain ? buildASS(p, viewClip, L, tl.duration) : buildASS(p, viewClip, L, tl.duration, x),
    filter: plain ? buildFilter(p, L, tl.duration) : buildFilter(p, L, tl.duration, x),
    inputs, duration: tl.duration,
    seek: { start: tl.parts[0] ? tl.parts[0].start : tl.source.start, length: r2((last ? last.end : tl.source.end) - (tl.parts[0] ? tl.parts[0].start : tl.source.start)) },
  };
}

// ffmpeg arguments for the extra inputs (after the source). dir: the folder the files are in.
function inputArgs(inputs, dir, duration, fps, join) {
  const out = [];
  for (const i of inputs) {
    if (i.kind === 'image') out.push('-loop', '1', '-framerate', String(fps), '-t', String(duration), '-i', join(dir, i.file));
    else out.push(...(i.loop ? ['-stream_loop', '-1'] : []), '-ss', String(i.from || 0), '-i', join(dir, i.file));
  }
  return out;
}

// Pauses in speech longer than minGap seconds inside [start, end], as cuts (keeping `pad` seconds of
// silence on each side so the joins don't sound clipped). words: [{ s, e }] with source times.
function pauseCuts(words, start, end, minGap = 0.8, pad = 0.15) {
  const w = (words || []).filter(x => x.e > start && x.s < end).sort((a, b) => a.s - b.s);
  const cuts = [];
  let prev = start;
  for (const x of w) {
    if (x.s - prev >= minGap) cuts.push({ start: r2(prev + pad), end: r2(x.s - pad) });
    prev = Math.max(prev, x.e);
  }
  if (end - prev >= minGap && w.length) cuts.push({ start: r2(prev + pad), end: r2(end - pad) });
  return cuts.filter(c => c.end - c.start >= 0.3);
}

module.exports = { IMAGE_EXT, AUDIO_EXT, TRACK_IDS, TEXT_POS, keptParts, mapTime, remapCaptions, buildTimeline, compileTimeline, inputArgs, pauseCuts };
