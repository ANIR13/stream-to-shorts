'use strict';
// Services with fake ffmpeg / whisper, on a temporary folder, without the HTTP server.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const B = require('../fixtures/baseline.json');
const Layout = require('../../app/public/layout.js');
const { buildASS, buildFilter } = require('../../app/src/core/render');
const { createProjectRepository } = require('../../app/src/repository/projectRepository');
const { createDetectionService } = require('../../app/src/services/detectionService');
const { createRenderingService } = require('../../app/src/services/renderingService');
const { createExportService } = require('../../app/src/services/exportService');
const { createJobQueue } = require('../../app/src/services/jobQueue');

const quiet = { log() {}, error() {} };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 's2s-svc-'));
  const dirs = { sourceDir: path.join(root, 'source'), projectsDir: path.join(root, 'projects'), outputDir: path.join(root, 'output') };
  Object.values(dirs).forEach(d => fs.mkdirSync(d));
  fs.writeFileSync(path.join(dirs.sourceDir, 'demo.mp4'), '');
  const repo = createProjectRepository({ projectsDir: dirs.projectsDir, sourceDir: dirs.sourceDir, probe: async () => ({ duration: 1800, width: 1920, height: 1080, fps: 30, hasAudio: true, size: 1 }) });
  // fake ffmpeg: records calls and creates the output file (last argument) like the real one would
  const calls = [];
  const ffmpeg = {
    filterArg: '-/filter_complex',
    run: async (job, args, opts) => { calls.push({ args, opts }); const out = args[args.length - 1]; if (/\.mp4$/.test(out)) fs.writeFileSync(path.isAbsolute(out) ? out : path.join(opts.cwd, out), 'video'); },
    detectHardware: async () => {}, gpuArgs: () => null,
  };
  return { root, ...dirs, repo, ffmpeg, calls };
}

test('detection service: suggests the baseline clips from an analysis, settings are saved', async () => {
  const { repo, ffmpeg, sourceDir } = setup();
  const p = await repo.open('demo.mp4');
  await repo.writeAnalysis(p.slug, { rms: B.input.rms, scene: B.input.scene });
  const detection = createDetectionService({ repo, ffmpeg, sourceDir });
  const q = await detection.detect(p.slug, { count: 5, length: 30 }, 'replace');
  const expected = B.detect[JSON.stringify({ count: 5, length: 30 })].slice().sort((a, b) => a.start - b.start);
  assert.deepEqual(q.clips.map(c => [c.start, c.end, c.score]), expected.map(c => [c.start, c.end, c.score]));
  assert.deepEqual(q.clips[0].scoreParts, expected[0].parts);
  assert.equal(q.detect.count, 5);
  assert.deepEqual(q.clips.map(c => c.num), [1, 2, 3, 4, 5]);
  await assert.rejects(createDetectionService({ repo, ffmpeg, sourceDir }).detect('nope', {}, 'add'));
});

test('rendering service: writes the exact subtitle file and filter graph, records the short, writes its upload text', async () => {
  const { repo, ffmpeg, calls, sourceDir, outputDir } = setup();
  let p = await repo.open('demo.mp4');
  p.layout = { mode: 'split', camOnTop: true, cam: { x: 1384, y: 674, w: 512, h: 382 }, game: { x: 0, y: 120, w: 1360, h: 765 } };
  p.publish = { hashtags: '#shorts #test' };
  p.clips = [{ id: 'c1', start: 100, end: 130, title1: 'THE COMEBACK', title2: 'NOBODY SAW COMING', captionsOn: true, captions: B.captions, captionsRange: [100, 130] }];
  p = await repo.saveFromClient(p.slug, p);
  const transcription = { available: false, captionClip: async () => { throw new Error('should not transcribe'); } };
  const rendering = createRenderingService({ repo, ffmpeg, transcription, outputDir, sourceDir, log: quiet });
  const job = { id: 1 };
  await rendering.render(job, p.slug, 'c1');
  const work = repo.fileIn(p.slug, 'render', 'c1');
  const ep = Layout.effective(p, p.clips[0]);
  const L = Layout.compute(ep.layout, p.meta, ep.style, true);
  assert.equal(fs.readFileSync(path.join(work, 'subs.ass'), 'utf8'), '﻿' + buildASS(ep, p.clips[0], L, 30));
  assert.equal(fs.readFileSync(path.join(work, 'filter.txt'), 'utf8'), buildFilter(ep, L, 30));
  const args = calls[0].args;
  assert.deepEqual(args.slice(args.indexOf('-ss'), args.indexOf('-ss') + 4), ['-ss', '100', '-t', '30']);
  assert.ok(args.includes('-/filter_complex') && args.includes('libx264'));
  const after = await repo.load(p.slug);
  assert.equal(after.clips[0].output, 'short_01_the_comeback_nobody_saw_coming.mp4');
  assert.equal(after.clips[0].renderSig, Layout.renderSig(p, p.clips[0]));
  assert.ok(fs.existsSync(path.join(outputDir, p.slug, after.clips[0].output)));
  assert.match(fs.readFileSync(path.join(outputDir, p.slug, 'short_01_the_comeback_nobody_saw_coming.txt'), 'utf8'), /^TITLE\r\nThe comeback nobody saw coming/);
  // exports see it
  const exporting = createExportService({ repo, outputDir, trash: { recycle: async f => fs.unlinkSync(f) }, rendering });
  assert.deepEqual((await exporting.list(p.slug)).files.map(f => f.name), ['short_01_the_comeback_nobody_saw_coming.mp4']);
  await exporting.remove(p.slug, 'short_01_the_comeback_nobody_saw_coming.mp4', false);
  assert.equal((await repo.load(p.slug)).clips[0].output, undefined);
  await assert.rejects(exporting.remove(p.slug, '../../secret.mp4', true), e => e.code === 403 || e.code === 404);
});

test('rendering service: quick draft is 10 s at half size and does not touch the short', async () => {
  const { repo, ffmpeg, calls, sourceDir, outputDir } = setup();
  let p = await repo.open('demo.mp4');
  p.clips = [{ id: 'c1', start: 100, end: 160, title1: 'X', captionsOn: false }];
  p = await repo.saveFromClient(p.slug, p);
  const rendering = createRenderingService({ repo, ffmpeg, transcription: { available: false }, outputDir, sourceDir, log: quiet });
  const job = { id: 2 };
  await rendering.render(job, p.slug, 'c1', { from: 155 });
  assert.match(fs.readFileSync(repo.fileIn(p.slug, 'drafts', 'c1', 'filter.txt'), 'utf8'), /scale=540:960/);
  const args = calls[0].args;
  assert.deepEqual(args.slice(args.indexOf('-ss'), args.indexOf('-ss') + 4), ['-ss', '150', '-t', '10']);
  assert.deepEqual(job.draft.from, 150);
  assert.equal((await repo.load(p.slug)).clips[0].output, undefined);
  assert.ok(fs.existsSync(rendering.draftFile(p.slug, 'c1')));
});

test('rendering service: generates missing captions first, fails clearly without speech recognition', async () => {
  const { repo, ffmpeg, sourceDir, outputDir } = setup();
  let p = await repo.open('demo.mp4');
  p.clips = [{ id: 'c1', start: 10, end: 20, captionsOn: true }];
  p = await repo.saveFromClient(p.slug, p);
  const none = createRenderingService({ repo, ffmpeg, transcription: { available: false }, outputDir, sourceDir, log: quiet });
  await assert.rejects(none.render({ id: 3 }, p.slug, 'c1'), /whisper is missing/);
  let asked = 0;
  const transcription = { available: true, captionClip: async (job, slug, id) => { asked++; await repo.update(slug, q => { const c = q.clips.find(x => x.id === id); c.captions = []; c.captionsRange = [10, 20]; }); } };
  await createRenderingService({ repo, ffmpeg, transcription, outputDir, sourceDir, log: quiet }).render({ id: 4 }, p.slug, 'c1');
  assert.equal(asked, 1);
});

test('job queue: one at a time, cancel, retry, friendly errors, resume after a restart', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 's2s-q-'));
  const queueFile = path.join(root, '.queue.json');
  const order = [];
  // 'a' runs until the test releases it, so the waiting tasks are known when the saved queue is checked
  let releaseA;
  const aGate = new Promise(r => { releaseA = r; });
  const specFn = spec => async job => { order.push(spec.clipId); if (spec.clipId === 'a') await aGate; if (spec.clipId === 'bad') throw new Error('ENOSPC: no space left'); await sleep(20); };
  const q = createJobQueue({ queueFile, specFn, log: quiet });
  const a = q.addSpec({ type: 'render', slug: 's', clipId: 'a' }, 'A');
  const b = q.addSpec({ type: 'render', slug: 's', clipId: 'bad' }, 'B');
  const c = q.addSpec({ type: 'render', slug: 's', clipId: 'c' }, 'C');
  q.cancel(c);
  assert.equal(c.status, 'cancelled');
  // saved for resume while waiting: many saves in a row still leave a valid, up-to-date file
  for (let i = 0; i < 25; i++) q.addSpec({ type: 'captions', slug: 's', clipId: 'x' + i }, 'X' + i);
  await q.saved();
  const saved = JSON.parse(fs.readFileSync(queueFile, 'utf8'));
  assert.ok(saved.some(x => x.clipId === 'bad') && saved.some(x => x.clipId === 'x24'));
  q.active().filter(j => /^x/.test(j.clipId)).forEach(q.cancel);
  releaseA();
  await sleep(150);
  assert.deepEqual(order, ['a', 'bad']);
  assert.equal(a.status, 'done');
  assert.equal(b.status, 'error');
  assert.match(b.hint, /disk is full/);
  const again = q.retry(c);
  await sleep(60);
  assert.equal(again.status, 'done');
  // a new queue (app restarted) offers what was still waiting
  fs.writeFileSync(queueFile, JSON.stringify([{ type: 'render', slug: 's', clipId: 'z', label: 'Z' }]));
  const q2 = createJobQueue({ queueFile, specFn, log: quiet });
  assert.equal(q2.interrupted.length, 1);
  const resumed = q2.takeInterrupted(true);
  assert.equal(resumed[0].label, 'Z');
  await sleep(60);
  assert.equal(resumed[0].status, 'done');
});
