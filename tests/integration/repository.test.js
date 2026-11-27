'use strict';
// Project repository on a temporary folder (no server, no ffmpeg: probe is faked).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createProjectRepository } = require('../../app/src/repository/projectRepository');

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 's2s-repo-'));
  const sourceDir = path.join(root, 'source'), projectsDir = path.join(root, 'projects');
  fs.mkdirSync(sourceDir); fs.mkdirSync(projectsDir);
  const repo = createProjectRepository({ projectsDir, sourceDir, probe: async () => ({ duration: 600, width: 1920, height: 1080, fps: 30, hasAudio: true, size: 1 }) });
  return { root, sourceDir, projectsDir, repo };
}

test('opening a new video creates its project with defaults', async () => {
  const { sourceDir, repo } = setup();
  fs.writeFileSync(path.join(sourceDir, 'my stream.mkv'), '');
  const p = await repo.open('my stream.mkv');
  assert.equal(p.slug, 'my_stream');
  assert.equal(p.style.titleFont, 'Impact');
  assert.deepEqual(p.detect, { count: 12, length: 55, wAudio: 1, wPeak: 0.5, wVisual: 0.3, gap: 3, engine: 'fast', wA: 0.2, wV: 0.15, wS: 0.35, wE: 0.2, wC: 0.1 });
  assert.equal(p.hasProxy, false);
  await assert.rejects(repo.open('missing.mp4'), e => e.code === 404);
});

test('files whose names clean up to the same folder get separate projects', async () => {
  const { sourceDir, repo } = setup();
  for (const f of ['stream.mkv', 'stream.mp4']) fs.writeFileSync(path.join(sourceDir, f), '');
  const a = await repo.open('stream.mkv'), b = await repo.open('stream.mp4');
  assert.equal(a.slug, 'stream'); assert.equal(b.slug, 'stream_2');
  assert.equal(await repo.slugFor('stream.mkv'), 'stream');
});

test('older projects get new defaults and clip numbers', async () => {
  const { projectsDir, repo } = setup();
  fs.mkdirSync(path.join(projectsDir, 'old'));
  fs.writeFileSync(path.join(projectsDir, 'old', 'project.json'), JSON.stringify({ video: 'old.mp4', slug: 'old', meta: { duration: 10 }, style: { titleFont: 'Arial' }, clips: [{ id: 'x', start: 0, end: 5 }] }));
  const p = await repo.load('old');
  assert.equal(p.style.titleFont, 'Arial');        // kept
  assert.equal(p.style.captionFont, 'Impact');     // filled in
  assert.equal(p.whisper.model, 'ggml-small.bin');
  const q = await repo.update('old', () => {});
  assert.equal(q.clips[0].num, 1);
});

test('browser saves: revisions, conflicts, server-only fields', async () => {
  const { sourceDir, repo } = setup();
  fs.writeFileSync(path.join(sourceDir, 'v.mp4'), '');
  let p = await repo.open('v.mp4');
  p.clips = [{ id: 'c1', start: 0, end: 20 }];
  p = await repo.saveFromClient(p.slug, p);
  assert.equal(p.rev, 1); assert.equal(p.clips[0].num, 1);
  await repo.update(p.slug, q => { q.clips[0].output = 'short_01_clip.mp4'; });
  await assert.rejects(repo.saveFromClient(p.slug, { ...p, rev: 0 }), e => e.code === 409);
  const saved = await repo.saveFromClient(p.slug, { ...p, clips: [{ ...p.clips[0], output: undefined }] });
  assert.equal(saved.clips[0].output, 'short_01_clip.mp4');
  const forced = await repo.saveFromClient(p.slug, { ...p, rev: 0 }, true);
  assert.equal(forced.rev, 3);
});

test('concurrent updates of one project are serialized (no lost writes)', async () => {
  const { sourceDir, repo } = setup();
  fs.writeFileSync(path.join(sourceDir, 'c.mp4'), '');
  const p = await repo.open('c.mp4');
  await Promise.all(Array.from({ length: 20 }, (_, i) => repo.update(p.slug, q => { q.clips.push({ id: 'k' + i, start: i, end: i + 1 }); })));
  const q = await repo.load(p.slug);
  assert.equal(q.clips.length, 20);
  assert.equal(new Set(q.clips.map(c => c.num)).size, 20);
});

test('shorts deleted outside the app are flagged as missing, never stored', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 's2s-repo-'));
  const sourceDir = path.join(root, 'source'), projectsDir = path.join(root, 'projects'), outputDir = path.join(root, 'output');
  fs.mkdirSync(sourceDir); fs.mkdirSync(projectsDir); fs.mkdirSync(path.join(outputDir, 'm'), { recursive: true });
  fs.writeFileSync(path.join(sourceDir, 'm.mp4'), '');
  const repo = createProjectRepository({ projectsDir, sourceDir, outputDir, probe: async () => ({ duration: 60, width: 1920, height: 1080, fps: 30, hasAudio: true, size: 1 }) });
  await repo.open('m.mp4');
  await repo.update('m', p => {
    p.clips = [{ id: 'a', start: 0, end: 5, output: 'short_01.mp4' }, { id: 'b', start: 10, end: 15, output: 'short_02.mp4' }, { id: 'c', start: 20, end: 25 }];
  });
  fs.writeFileSync(path.join(outputDir, 'm', 'short_01.mp4'), 'video');

  let p = await repo.load('m');
  assert.deepEqual(p.clips.map(c => !!c.outputMissing), [false, true, false]);
  assert.equal(p.clips[1].output, 'short_02.mp4');                     // render record kept
  const onDisk = JSON.parse(fs.readFileSync(repo.projFile('m'), 'utf8'));
  assert.equal(onDisk.clips.some(c => 'outputMissing' in c), false);   // computed, not saved

  fs.writeFileSync(path.join(outputDir, 'm', 'short_02.mp4'), 'video'); // file put back
  p = await repo.load('m');
  assert.equal(p.clips.some(c => c.outputMissing), false);
});
