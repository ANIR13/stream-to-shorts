'use strict';
// Small file and path helpers shared by every layer.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const exists = p => fsp.access(p).then(() => true, () => false);

async function readJSON(p, def) { try { return JSON.parse(await fsp.readFile(p, 'utf8')); } catch { return def; } }

// Atomic write: a crash never leaves a half-written JSON file.
async function writeJSON(p, obj) {
  await fsp.mkdir(path.dirname(p), { recursive: true });
  const tmp = p + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(obj, null, 2));
  await fsp.rename(tmp, p);
}

// Fill missing keys (recursively for plain objects) without touching existing values.
function deepDefaults(target, defs) {
  for (const [k, v] of Object.entries(defs)) {
    if (target[k] === undefined) target[k] = v;
    else if (v && typeof v === 'object' && !Array.isArray(v) && typeof target[k] === 'object') deepDefaults(target[k], v);
  }
  return target;
}

// True when p is strictly inside base (protects against "../" paths).
const inside = (base, p) => { const r = path.relative(base, p); return !!r && !r.startsWith('..') && !path.isAbsolute(r); };

const slugify = s => String(s).replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'video';

const round1 = v => Math.round(v * 10) / 10;

module.exports = { exists, readJSON, writeJSON, deepDefaults, inside, slugify, round1 };
