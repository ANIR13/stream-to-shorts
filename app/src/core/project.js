'use strict';
// Project model: defaults, clip numbering, and merging a save from the browser. Pure functions.
const { DETECT_DEFAULTS } = require('./detection');
const { SMART_DEFAULTS } = require('./smart');
const { httpError } = require('../shared/errors');
const Timing = require('../../public/timing.js');
const { isSafeFileName, isSafeId, VIDEO_EXT } = require('../shared/validate');

const STYLE_DEFAULTS = {
  titleFont: 'Impact', titleSize: 86, titleColor1: '#FFFFFF', titleColor2: '#FFD400',
  accent: '#FFD400', captions: true, captionFont: 'Impact', captionSize: 84,
  captionColor: '#FFFFFF', captionHighlight: '#FFD400', highlightMode: 'word',
  wordsPerChunk: 3, uppercase: true, captionAuto: true, captionPos: 62,
  background: 'blur', camBorder: true, camBoost: true, progressBar: true,
  fps: 30, crf: 20, loudnorm: true,
};

// prompt: hint words for Whisper; fixes: [{from, to}] word corrections applied to every transcription.
function whisperDefaults() { return { model: 'ggml-small.bin', language: 'auto', translate: false, prompt: '', fixes: [] }; }

function defaultProject(file, meta, slug) {
  const cw = Math.round(meta.width * 0.27), ch = Math.round(cw * 0.75);
  return {
    video: file, slug, meta, analyzed: false, // "version" (file format) is added by the repository, see core/schema.js
    layout: {
      mode: 'gameplay', camOnTop: true,
      cam: { x: meta.width - cw, y: meta.height - ch, w: cw, h: ch },
      game: { x: 0, y: 0, w: meta.width, h: meta.height },
    },
    style: { ...STYLE_DEFAULTS },
    whisper: whisperDefaults(),
    publish: { hashtags: '#shorts' },
    detect: { ...DETECT_DEFAULTS, ...SMART_DEFAULTS },
    clips: [],
  };
}

// Every clip gets a permanent number (used in file names and labels) so names don't shift
// when clips are added, removed or moved.
function ensureNums(p) {
  let max = p.clips.reduce((m, c) => Math.max(m, Number(c.num) || 0), 0);
  const seen = new Set();
  for (const c of p.clips) {
    if (!c.num || seen.has(c.num)) c.num = ++max;
    seen.add(c.num);
  }
}

const clipName = c => `#${c.num || '?'}${[c.title1, c.title2].filter(Boolean).length ? ' ' + [c.title1, c.title2].filter(Boolean).join(' ') : ''}`;

// Fields only the server writes (render results).
const SERVER_FIELDS = ['output', 'renderedAt', 'renderSig'];
// Settings the browser may change.
const CLIENT_KEYS = ['layout', 'style', 'whisper', 'detect', 'publish', 'setup'];

// Apply a save from the browser to the stored project p (in place).
// rev counts saves made from the browser. A save based on an older rev means another tab or
// window saved in between; it is refused (409) unless the user chose to overwrite (force).
function mergeClientSave(p, incoming, force) {
  if (!force && (Number(incoming.rev) || 0) !== (Number(p.rev) || 0)) {
    throw httpError(409, 'This project was changed in another tab or window.');
  }
  p.rev = (Number(p.rev) || 0) + 1;
  const old = new Map(p.clips.map(c => [c.id, c]));
  for (const k of CLIENT_KEYS) if (incoming[k]) p[k] = incoming[k];
  if (Array.isArray(incoming.clips)) {
    p.clips = incoming.clips.map(c => {
      const o = old.get(c.id);
      if (o) for (const f of SERVER_FIELDS) c[f] = o[f];
      if (o && o.num) c.num = o.num;
      // Never store a clip that ends before it starts or lies outside the video.
      const t = Timing.normalize(c, p.meta && p.meta.duration);
      if (t.start !== c.start || t.end !== c.end) { c.start = t.start; c.end = t.end; }
      // The server regenerated captions after the browser loaded them: keep the newer server copy
      // instead of letting a stale autosave wipe them.
      if (o && (o.captionsVer || 0) > (c.captionsVer || 0)) {
        c.captions = o.captions; c.captionsRange = o.captionsRange; c.captionsVer = o.captionsVer;
      }
      return c;
    });
  }
  return p;
}

// ---- untrusted input ----
// A project file may come from another computer, and browser saves are only as trustworthy as the
// page. Before anything uses a project, values that reach file paths, programs or the subtitle file
// are checked: harmful ones are refused (the video name) or replaced by safe defaults. Valid values
// are never changed, so a normal project is untouched.
const fnv = s => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(36); };
const STYLE_NUMBERS = { titleSize: [10, 300], captionSize: [10, 300], fps: [10, 60], crf: [0, 51], captionPos: [0, 100], wordsPerChunk: [1, 12] };
const FONT_KEYS = ['titleFont', 'captionFont'];
const num = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi);

function sanitizeProject(p) {
  if (!p || typeof p !== 'object') throw httpError(422, 'This project file is not valid.');
  if (!isSafeFileName(p.video, VIDEO_EXT)) throw httpError(422, 'This project file is not valid: its video name points outside the source folder.');
  const meta = p.meta = p.meta && typeof p.meta === 'object' ? p.meta : {};
  for (const k of ['duration', 'width', 'height', 'fps']) if (meta[k] != null && !num(meta[k], 0, 1e7)) meta[k] = Number(meta[k]) > 0 ? Number(meta[k]) : 0;
  // missing sections get their defaults (a hand-made or truncated file)
  if (!p.style || typeof p.style !== 'object') p.style = { ...STYLE_DEFAULTS };
  if (!p.whisper || typeof p.whisper !== 'object') p.whisper = whisperDefaults();
  if (!p.layout || typeof p.layout !== 'object') p.layout = defaultProject(p.video, { width: Number(meta.width) || 1920, height: Number(meta.height) || 1080 }, p.slug).layout;
  // style values written into the subtitle file and the ffmpeg filter graph
  const st = p.style;
  if (st && typeof st === 'object') {
    for (const k of FONT_KEYS) if (st[k] != null && (typeof st[k] !== 'string' || /[,\r\n{}\\]/.test(st[k]) || st[k].length > 64)) st[k] = STYLE_DEFAULTS[k];
    for (const [k, [lo, hi]] of Object.entries(STYLE_NUMBERS)) if (st[k] != null && !num(st[k], lo, hi)) st[k] = STYLE_DEFAULTS[k];
  }
  // whisper settings become program arguments and a model path
  const w = p.whisper;
  if (w && typeof w === 'object') {
    if (w.model != null && !(typeof w.model === 'string' && /^ggml-[A-Za-z0-9._-]+\.bin$/.test(w.model))) w.model = whisperDefaults().model;
    if (w.language != null && !(typeof w.language === 'string' && /^(auto|[a-z]{2,3})$/.test(w.language))) w.language = 'auto';
  }
  // detection settings are shown in the page: numbers only
  if (p.detect && typeof p.detect === 'object') {
    for (const k of Object.keys(DETECT_DEFAULTS)) if (p.detect[k] != null && !num(p.detect[k], -1e6, 1e6)) p.detect[k] = DETECT_DEFAULTS[k];
    for (const k of ['wA', 'wV', 'wS', 'wE', 'wC']) if (p.detect[k] != null && !num(p.detect[k], 0, 1)) p.detect[k] = SMART_DEFAULTS[k];
    if (p.detect.engine != null && p.detect.engine !== 'fast' && p.detect.engine !== 'smart') p.detect.engine = 'fast';
  }
  // layout boxes are numbers
  if (p.layout && typeof p.layout === 'object') {
    for (const box of [p.layout.cam, p.layout.game]) if (box && typeof box === 'object') for (const k of ['x', 'y', 'w', 'h']) if (!num(box[k], -1e6, 1e6)) box[k] = 0;
  }
  if (!Array.isArray(p.clips)) p.clips = [];
  p.clips = p.clips.filter(c => c && typeof c === 'object');
  for (const c of p.clips) {
    // ids become folder and file names; outputs are files in output/<video>/ that a new render replaces
    if (!isSafeId(c.id)) c.id = 'x' + fnv(String(c.id));
    if (c.output != null && !isSafeFileName(c.output, new Set(['.mp4']))) { delete c.output; delete c.renderSig; delete c.renderedAt; }
    // detection details are shown in the page: known reason kinds, numbers, short plain words
    if (c.scoreReasons != null) {
      c.scoreReasons = Array.isArray(c.scoreReasons) ? c.scoreReasons.filter(r => r && typeof r.k === 'string' && /^[a-z]{2,12}$/.test(r.k)).slice(0, 8)
        .map(r => ({ k: r.k, ...(typeof r.w === 'string' ? { w: r.w.replace(/[<>"&]/g, '').slice(0, 30) } : {}), ...(num(r.t, 0, 1e7) ? { t: r.t } : {}) })) : undefined;
    }
    if (c.scoreEngine != null && c.scoreEngine !== 'smart') delete c.scoreEngine;
    if (typeof c.start !== 'number' || typeof c.end !== 'number' || !(c.start < c.end) || c.start < 0 || (meta.duration && c.end > meta.duration)) {
      const t = Timing.normalize(c, meta.duration);
      c.start = t.start; c.end = t.end;
    }
  }
  return p;
}

module.exports = { sanitizeProject, STYLE_DEFAULTS, whisperDefaults, defaultProject, ensureNums, clipName, SERVER_FIELDS, mergeClientSave };
