'use strict';
// Project file format versions and migrations.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { SCHEMA_VERSION, MIGRATIONS, schemaVersionOf, migrate } = require('../../app/src/core/schema');
const { createProjectRepository } = require('../../app/src/repository/projectRepository');

// A project as saved by the first releases (format 1): no word fixes, hashtags, setup,
// detection weights or clip numbers, and a stray hasProxy flag.
const v1 = () => ({
  version: 1, video: 'old.mkv', slug: 'old', meta: { duration: 600, width: 1920, height: 1080, fps: 30, hasAudio: true },
  analyzed: true, hasProxy: true,
  layout: { mode: 'split', camOnTop: true, cam: { x: 1400, y: 680, w: 520, h: 390 }, game: { x: 0, y: 0, w: 1920, h: 1080 } },
  style: { titleFont: 'Arial Black', titleSize: 90 },
  whisper: { model: 'ggml-small.bin', language: 'en', translate: false },
  detect: { count: 8, length: 40 },
  clips: [{ id: 'a', start: 10, end: 40, title1: 'HELLO', output: 'short_01_hello.mp4' }, { id: 'b', start: 100, end: 140 }],
});

test('every format below the current one has a migration', () => {
  for (let v = 1; v < SCHEMA_VERSION; v++) assert.equal(typeof MIGRATIONS[v], 'function', `missing migration ${v} -> ${v + 1}`);
});

test('format 1 -> current: new settings get defaults, user values are kept', () => {
  const p = v1();
  assert.deepEqual(migrate(p), { from: 1, to: SCHEMA_VERSION });
  assert.equal(p.version, SCHEMA_VERSION);
  assert.equal(p.style.titleFont, 'Arial Black');     // kept
  assert.equal(p.style.titleSize, 90);                // kept
  assert.equal(p.style.captionFont, 'Impact');        // filled
  assert.equal(p.whisper.language, 'en');             // kept
  assert.deepEqual(p.whisper.fixes, []);              // filled
  assert.equal(p.whisper.prompt, '');
  assert.deepEqual(p.detect, { count: 8, length: 40, wAudio: 1, wPeak: 0.5, wVisual: 0.3, gap: 3, engine: 'fast', wA: 0.2, wV: 0.15, wS: 0.35, wE: 0.2, wC: 0.1 });
  assert.equal(p.publish.hashtags, '#shorts');
  assert.deepEqual(p.setup, {});
  assert.deepEqual(p.clips.map(c => c.num), [1, 2]);
  assert.equal(p.clips[0].output, 'short_01_hello.mp4');
  assert.equal('hasProxy' in p, false);
});

test('projects without a version are format 1; migrating twice changes nothing', () => {
  const p = v1(); delete p.version;
  assert.equal(schemaVersionOf(p), 1);
  migrate(p);
  const once = structuredClone(p);
  assert.deepEqual(migrate(p), { from: SCHEMA_VERSION, to: SCHEMA_VERSION });
  assert.deepEqual(p, once);
});

test('a project from a newer app is refused, not changed', () => {
  const p = { ...v1(), version: SCHEMA_VERSION + 1 };
  const before = structuredClone(p);
  assert.throws(() => migrate(p), e => e.code === 409 && /newer version/.test(e.message));
  assert.deepEqual(p, before);
});

test('repository: opening an old project upgrades the file once and keeps a backup', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 's2s-schema-'));
  const sourceDir = path.join(root, 'source'), projectsDir = path.join(root, 'projects');
  fs.mkdirSync(sourceDir); fs.mkdirSync(path.join(projectsDir, 'old'), { recursive: true });
  fs.writeFileSync(path.join(sourceDir, 'old.mkv'), '');
  const file = path.join(projectsDir, 'old', 'project.json');
  const original = JSON.stringify(v1(), null, 2);
  fs.writeFileSync(file, original);
  const repo = createProjectRepository({ projectsDir, sourceDir, probe: async () => { throw new Error('not needed'); } });

  const p = await repo.open('old.mkv');
  assert.equal(p.version, SCHEMA_VERSION);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).version, SCHEMA_VERSION);    // written
  const backup = path.join(projectsDir, 'old', 'project.v1.backup.json');
  assert.equal(fs.readFileSync(backup, 'utf8'), original);                           // original kept
  const mtime = fs.statSync(backup).mtimeMs;
  await repo.open('old.mkv');
  assert.equal(fs.statSync(backup).mtimeMs, mtime);                                  // not rewritten
});

test('repository: a newer project file is never overwritten', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 's2s-schema-'));
  const sourceDir = path.join(root, 'source'), projectsDir = path.join(root, 'projects');
  fs.mkdirSync(sourceDir); fs.mkdirSync(path.join(projectsDir, 'new'), { recursive: true });
  fs.writeFileSync(path.join(sourceDir, 'new.mkv'), '');
  const file = path.join(projectsDir, 'new', 'project.json');
  const content = JSON.stringify({ ...v1(), video: 'new.mkv', slug: 'new', version: SCHEMA_VERSION + 1, futureField: { x: 1 } });
  fs.writeFileSync(file, content);
  const repo = createProjectRepository({ projectsDir, sourceDir, probe: async () => ({}) });
  await assert.rejects(repo.open('new.mkv'), e => e.code === 409);
  await assert.rejects(repo.update('new', p => { p.analyzed = false; }), e => e.code === 409);
  assert.equal(fs.readFileSync(file, 'utf8'), content);
});

test('new projects start at the current format', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 's2s-schema-'));
  const sourceDir = path.join(root, 'source'), projectsDir = path.join(root, 'projects');
  fs.mkdirSync(sourceDir); fs.mkdirSync(projectsDir);
  fs.writeFileSync(path.join(sourceDir, 'fresh.mp4'), '');
  const repo = createProjectRepository({ projectsDir, sourceDir, probe: async () => ({ duration: 10, width: 1280, height: 720, fps: 30, hasAudio: true, size: 1 }) });
  const p = await repo.open('fresh.mp4');
  assert.equal(p.version, SCHEMA_VERSION);
  assert.equal(JSON.parse(fs.readFileSync(path.join(projectsDir, 'fresh', 'project.json'), 'utf8')).version, SCHEMA_VERSION);
});

test('format 2 -> 3: detection gets the engine (fast by default) and the smart weights, nothing else changes', () => {
  const p = { version: 2, video: 'v.mp4', slug: 'v', meta: { duration: 60 }, detect: { count: 5, length: 30, wAudio: 2, wPeak: 0, wVisual: 1, gap: 10 }, clips: [{ id: 'a', num: 1, start: 0, end: 20, score: 80 }] };
  const before = structuredClone(p);
  migrate(p);
  assert.deepEqual(p.detect, { ...before.detect, engine: 'fast', wA: 0.2, wV: 0.15, wS: 0.35, wE: 0.2, wC: 0.1 });
  assert.deepEqual(p.clips, before.clips);
  assert.equal(p.version, SCHEMA_VERSION);
});
