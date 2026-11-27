'use strict';
// Project model: defaults, clip numbering, and merging a save from the browser. Pure functions.
const { DETECT_DEFAULTS } = require('./detection');
const { httpError } = require('../shared/errors');

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
    detect: { ...DETECT_DEFAULTS },
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

module.exports = { STYLE_DEFAULTS, whisperDefaults, defaultProject, ensureNums, clipName, SERVER_FIELDS, mergeClientSave };
