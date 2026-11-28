'use strict';
// Project file format versions (the "version" field of project.json) and migrations between them.
//
// To change what project.json contains:
//   1. bump SCHEMA_VERSION,
//   2. add MIGRATIONS[old] that upgrades a project from `old` to `old + 1` in place,
//   3. add a test in tests/schema.test.js.
// Never edit a migration that was released: projects in the wild depend on it. Add a new one instead.
const { httpError } = require('../shared/errors');
const { STYLE_DEFAULTS, whisperDefaults, ensureNums } = require('./project');
const { DETECT_DEFAULTS } = require('./detection');
const { SMART_DEFAULTS } = require('./smart');

const SCHEMA_VERSION = 4;

const MIGRATIONS = {
  // 1 → 2: projects from before versioned migrations. Settings added since then (hint words and
  // word fixes, upload hashtags, setup checklist, detection weights and spacing) get their defaults;
  // clips get permanent numbers; a stale "hasProxy" flag (computed on every load) is dropped.
  1: p => {
    p.style = { ...STYLE_DEFAULTS, ...(p.style || {}) };
    p.whisper = { ...whisperDefaults(), ...(p.whisper || {}) };
    if (!Array.isArray(p.whisper.fixes)) p.whisper.fixes = [];
    p.detect = { ...DETECT_DEFAULTS, ...(p.detect || {}) };
    p.publish = { hashtags: '#shorts', ...(p.publish || {}) };
    p.setup = p.setup || {};
    p.clips = Array.isArray(p.clips) ? p.clips : [];
    ensureNums(p);
    delete p.hasProxy;
  },
  // 2 → 3: smart detection. The detection settings get the engine ("fast" stays the default, so
  // nothing changes for existing projects) and the weights of the five signals.
  2: p => {
    p.detect = { ...SMART_DEFAULTS, ...(p.detect || {}) };
  },
  // 3 → 4: the timeline. Clips may now have cuts, text and image overlays, music and per-track
  // settings (all optional, see core/timeline.js). Nothing to fill in: absent means none.
  3: () => {},
};

// Projects saved before the field existed count as version 1.
function schemaVersionOf(p) {
  const v = Number(p && p.version);
  return Number.isInteger(v) && v >= 1 ? v : 1;
}

const newerError = v => httpError(409, `This project was saved by a newer version of Stream to Shorts (project format ${v}). Update the app to open it.`);

// Upgrade p in place to SCHEMA_VERSION. Returns { from, to }. Refuses projects from a newer app,
// so an older app never overwrites data it does not understand.
function migrate(p) {
  const from = schemaVersionOf(p);
  if (from > SCHEMA_VERSION) throw newerError(from);
  for (let v = from; v < SCHEMA_VERSION; v++) {
    const step = MIGRATIONS[v];
    if (!step) throw new Error(`No migration from project format ${v} to ${v + 1}`);
    step(p);
    p.version = v + 1;
  }
  p.version = SCHEMA_VERSION;
  return { from, to: SCHEMA_VERSION };
}

const needsMigration = p => schemaVersionOf(p) < SCHEMA_VERSION;

module.exports = { SCHEMA_VERSION, MIGRATIONS, schemaVersionOf, migrate, needsMigration };
