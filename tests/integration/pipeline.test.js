'use strict';
// Integration: the render pipeline with a fake ffmpeg: profiles, output validation, failure logs,
// out-of-memory retry, metadata updates without re-encoding, clean-up, process monitoring.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { app, quiet, tmpApp, fakeFfmpeg } = require('../helpers');
const { createProjectRepository } = require(app('src/repository/projectRepository'));
const { createRenderingService } = require(app('src/services/renderingService'));
const { createExportService } = require(app('src/services/exportService'));
const monitor = require(app('src/infrastructure/monitor'));

const META = { duration: 600, width: 1920, height: 1080, fps: 30, hasAudio: true, size: 1 };
async function setup(ffmpeg = fakeFfmpeg()) {
  const dirs = tmpApp('s2s-pipe-');
  fs.writeFileSync(path.join(dirs.sourceDir, 'v.mp4'), '');
  const repo = createProjectRepository({ ...dirs, probe: async () => META });
  let p = await repo.open('v.mp4');
  p.clips = [{ id: 'c1', start: 10, end: 40, title1: 'BIG WIN', description: 'What a play', captionsOn: false }];
  p.style.renderProfile = 'quality';
  p = await repo.saveFromClient(p.slug, p);
  const rendering = createRenderingService({ repo, ffmpeg, transcription: { available: false }, outputDir: dirs.outputDir, sourceDir: dirs.sourceDir, log: quiet });
  return { dirs, repo, rendering, ffmpeg, p, outDir: path.join(dirs.outputDir, p.slug) };
}
const arg = (args, name) => args[args.indexOf(name) + 1];

test('profile, metadata and estimate reach the render', async () => {
  const { rendering, ffmpeg, p } = await setup();
  const job = { id: 1 };
  await rendering.render(job, p.slug, 'c1');
  const a = ffmpeg.calls[0].args;
  assert.equal(arg(a, '-preset'), 'slow');
  assert.equal(arg(a, '-crf'), '18');
  assert.equal(arg(a, '-b:a'), '192k');
  assert.ok(a.includes('title=Big win'), 'title inside the MP4');
  assert.ok(a.some(x => /^comment=Big win\s+What a play/.test(x)), 'description inside the MP4');
  assert.ok(job.estimate.memoryMB > 0 && job.estimate.seconds > 0);
});

test('a render that fails the checks keeps the previous short and writes a log', async () => {
  const { rendering, ffmpeg, repo, p, outDir } = await setup();
  await rendering.render({ id: 1 }, p.slug, 'c1');
  const out = path.join(outDir, (await repo.load(p.slug)).clips[0].output);
  // the next file comes out at the wrong size and without sound
  ffmpeg.probe = async () => ({ width: 1920, height: 1080, duration: 31, hasAudio: false });
  await repo.update(p.slug, q => { q.clips[0].end = 41; });
  const job = { id: 2 };
  await assert.rejects(rendering.render(job, p.slug, 'c1'), /did not pass the checks \(size 1920x1080 instead of 1080x1920, no sound track\)\. The previous version was kept/);
  assert.equal(fs.readFileSync(out, 'utf8'), 'video', 'previous short untouched');
  assert.deepEqual(fs.readdirSync(outDir).filter(n => n.startsWith('.')), [], 'no unfinished file');
  assert.match(job.logFile, /^projects[\\/]v[\\/]logs[\\/]render-c1-.*\.log$/);
  const log = fs.readFileSync(path.join(repo.projDir(p.slug), 'logs', path.basename(job.logFile)), 'utf8');
  assert.match(log, /^Stream to Shorts render log/);
  assert.match(log, /command:\nffmpeg .*-preset slow/);
  assert.match(log, /error:\nThe rendered video did not pass the checks/);
  // a wrong length is caught too
  ffmpeg.probe = async () => ({ width: 1080, height: 1920, duration: 12, hasAudio: true });
  await assert.rejects(rendering.render({ id: 3 }, p.slug, 'c1'), /length 12 s instead of 31 s/);
});

test('out of memory: one more try with fewer threads', async () => {
  let n = 0;
  const ffmpeg = fakeFfmpeg({ fail: () => (++n === 1 ? new Error('ffmpeg failed (code 1)\n[libx264] malloc of size 123 failed\nCannot allocate memory') : null) });
  const { rendering, p } = await setup(ffmpeg);
  const job = { id: 1 };
  await rendering.render(job, p.slug, 'c1');
  assert.equal(ffmpeg.calls.length, 2);
  const retry = ffmpeg.calls[1].args;
  assert.equal(arg(retry, '-threads'), '2');
  assert.equal(arg(retry, '-filter_threads'), '1');
  assert.ok(retry.indexOf('-filter_threads') < retry.indexOf('-i'), 'global option before the inputs');
  // other failures are not retried
  const other = fakeFfmpeg({ fail: () => new Error('ffmpeg failed (code 1)\nInvalid data found') });
  const s2 = await setup(other);
  await assert.rejects(s2.rendering.render({ id: 2 }, s2.p.slug, 'c1'), /Invalid data/);
  assert.equal(other.calls.length, 1);
});

test('upload text changes update the MP4 metadata by copying the streams, never re-encoding', async () => {
  const { rendering, ffmpeg, repo, p, outDir, dirs } = await setup();
  await rendering.render({ id: 1 }, p.slug, 'c1');
  await repo.update(p.slug, q => { q.clips[0].description = 'New words'; });
  ffmpeg.calls.length = 0;
  const exporting = createExportService({ repo, outputDir: dirs.outputDir, trash: { recycle: async () => {} }, rendering });
  assert.equal(await exporting.writeAllUploadTexts(p.slug), 1);
  assert.equal(ffmpeg.calls.length, 1);
  const a = ffmpeg.calls[0].args;
  assert.equal(arg(a, '-c'), 'copy');
  assert.ok(!a.includes('libx264') && !a.includes('-filter_complex') && !a.includes(ffmpeg.filterArg));
  assert.ok(a.some(x => /^comment=.*New words/s.test(x)));
  assert.match(fs.readFileSync(path.join(outDir, 'short_01_big_win.txt'), 'utf8'), /New words/);
  assert.deepEqual(fs.readdirSync(outDir).filter(n => n.startsWith('.')), []);
});

test('clean-up removes only the app\'s own unfinished files', async () => {
  const { rendering, outDir } = await setup();
  fs.mkdirSync(outDir, { recursive: true });
  for (const n of ['.rendering_c1.mp4', '.metadata_c1.mp4', 'xrendering_c1.mp4', 'keep.mp4']) fs.writeFileSync(path.join(outDir, n), 'x');
  assert.equal(await rendering.cleanupPartial(), 2);
  assert.deepEqual(fs.readdirSync(outDir).sort(), ['keep.mp4', 'xrendering_c1.mp4']);
});

test('monitoring reads the memory of a running program', async () => {
  // a program that stays alive until the test ends (sampling can be slow on a busy computer)
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)']);
  try {
    const mb = await monitor.memoryOf(child.pid);
    assert.ok(mb > 5 && mb < 2000, `node uses ${mb} MB`);
    const samples = [];
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('no samples within 20 s')), 20000);
      monitor.watch(child, s => { samples.push(s.memoryMB); if (samples.length === 2) { clearTimeout(t); resolve(); } }, 200);
    });
    assert.ok(samples.every(v => v > 0));
  } finally { child.kill(); }
  assert.equal(await monitor.memoryOf(999999999), null);
});
