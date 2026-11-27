'use strict';
// Integration: projects survive restarts, and interrupted renders recover safely
// (failed, cancelled, or cut short by closing the app / a crash).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { app, quiet, sleep, tmpApp, fakeFfmpeg } = require('../helpers');
const { createProjectRepository } = require(app('src/repository/projectRepository'));
const { createRenderingService } = require(app('src/services/renderingService'));
const { createJobQueue } = require(app('src/services/jobQueue'));

const META = { duration: 600, width: 1920, height: 1080, fps: 30, hasAudio: true, size: 1 };

// Everything the app builds at startup, on the same folders (a new instance = a restart).
function start(dirs, ffmpeg = fakeFfmpeg()) {
  const repo = createProjectRepository({ projectsDir: dirs.projectsDir, sourceDir: dirs.sourceDir, outputDir: dirs.outputDir, probe: async () => META });
  const rendering = createRenderingService({ repo, ffmpeg, transcription: { available: false }, outputDir: dirs.outputDir, sourceDir: dirs.sourceDir, log: quiet });
  const queue = createJobQueue({
    queueFile: path.join(dirs.projectsDir, '.queue.json'), log: quiet,
    specFn: spec => job => rendering.render(job, spec.slug, spec.clipId),
  });
  return { repo, rendering, queue, ffmpeg };
}
async function newProject(dirs, s) {
  fs.writeFileSync(path.join(dirs.sourceDir, 'stream.mp4'), '');
  let p = await s.repo.open('stream.mp4');
  p.clips = [{ id: 'c1', start: 10, end: 40, title1: 'First', captionsOn: false }, { id: 'c2', start: 100, end: 130, title1: 'Second', captionsOn: false }];
  p.style.titleSize = 70;
  p.whisper.fixes = [{ from: 'made', to: 'mate' }];
  return s.repo.saveFromClient(p.slug, p);
}
const until = async (cond, ms = 3000) => { const t0 = Date.now(); while (!cond()) { if (Date.now() - t0 > ms) throw new Error('timeout'); await sleep(5); } };
const partials = dir => (fs.existsSync(dir) ? fs.readdirSync(dir).filter(n => n.startsWith('.rendering_')) : []);

test('restart: a project and its edits are the same after the app restarts', async () => {
  const dirs = tmpApp();
  const a = start(dirs);
  const before = await newProject(dirs, a);
  await a.rendering.render({ id: 1 }, before.slug, 'c1');
  const saved = await a.repo.load(before.slug);

  const b = start(dirs);                                                  // restart
  const after = await b.repo.open('stream.mp4');
  assert.deepEqual(after, saved);
  assert.equal(after.style.titleSize, 70);
  assert.deepEqual(after.whisper.fixes, [{ from: 'made', to: 'mate' }]);
  assert.equal(after.clips[0].output, 'short_01_first.mp4');
  assert.equal(after.clips[0].outputMissing, undefined);
  assert.equal(after.rev, before.rev);                                    // a new tab can keep saving
  assert.equal((await b.repo.saveFromClient(after.slug, after)).rev, before.rev + 1);
});

test('restart: a crash while saving never damages the project file', async () => {
  const dirs = tmpApp();
  const a = start(dirs);
  const p = await newProject(dirs, a);
  // a save interrupted half-way leaves only the temporary file; the project file is still whole
  fs.writeFileSync(a.repo.projFile(p.slug) + '.tmp', '{"video": "stream.mp4", "clips": [{"id":');
  const b = start(dirs);
  const q = await b.repo.load(p.slug);
  assert.deepEqual(q.clips.map(c => c.id), ['c1', 'c2']);
  await b.repo.update(p.slug, x => { x.clips[0].title1 = 'Renamed'; });  // the next save replaces the leftover
  assert.equal(JSON.parse(fs.readFileSync(b.repo.projFile(p.slug), 'utf8')).clips[0].title1, 'Renamed');
  assert.equal(fs.existsSync(b.repo.projFile(p.slug) + '.tmp'), false);
});

test('interrupted render: a render that fails half-way leaves the previous short untouched', async () => {
  const dirs = tmpApp();
  const a = start(dirs);
  const p = await newProject(dirs, a);
  await a.rendering.render({ id: 1 }, p.slug, 'c1');
  const out = path.join(dirs.outputDir, p.slug, 'short_01_first.mp4');
  const sig = (await a.repo.load(p.slug)).clips[0].renderSig;
  assert.equal(fs.readFileSync(out, 'utf8'), 'video');

  // render again after an edit; ffmpeg dies after writing part of the file
  await a.repo.update(p.slug, q => { q.clips[0].start = 12; });
  const broken = start(dirs, fakeFfmpeg({ fail: () => new Error('ffmpeg failed (code 1)\nConversion failed!') })).rendering;
  await assert.rejects(broken.render({ id: 2 }, p.slug, 'c1'), /Conversion failed/);
  assert.equal(fs.readFileSync(out, 'utf8'), 'video');                    // old short still there, complete
  assert.deepEqual(partials(path.dirname(out)), []);                     // no half-written file left
  const q = await a.repo.load(p.slug);
  assert.equal(q.clips[0].output, 'short_01_first.mp4');
  assert.equal(q.clips[0].renderSig, sig);                                // still known as the old version (outdated)
});

test('interrupted render: cancelling a render removes the unfinished file and keeps the old short', async () => {
  const dirs = tmpApp();
  let release;
  const gate = new Promise(r => { release = r; });
  const ffmpeg = fakeFfmpeg();
  const realRun = ffmpeg.run;
  ffmpeg.run = async (job, args, opts) => {
    const tmp = args[args.length - 1];                                      // absolute path of the unfinished short
    if (path.basename(tmp).startsWith('.rendering_') && job.slow) {
      fs.writeFileSync(tmp, 'half');                                        // ffmpeg is writing…
      await gate;                                                           // …until it is killed
      throw new Error(job.cancelled ? 'Cancelled' : 'killed');
    }
    return realRun(job, args, opts);
  };
  const s = start(dirs, ffmpeg);
  const p = await newProject(dirs, s);
  await s.rendering.render({ id: 1 }, p.slug, 'c1');
  const out = path.join(dirs.outputDir, p.slug, 'short_01_first.mp4');

  const job = s.queue.addSpec({ type: 'render', slug: p.slug, clipId: 'c1' }, 'Render #1');
  job.slow = true;
  await until(() => partials(path.dirname(out)).length === 1);
  s.queue.cancel(job);
  release();
  await until(() => job.status !== 'running');
  assert.equal(job.status, 'cancelled');
  assert.equal(job.hint, 'Cancelled.');
  assert.deepEqual(partials(path.dirname(out)), []);
  assert.equal(fs.readFileSync(out, 'utf8'), 'video');
  await s.queue.saved();
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dirs.projectsDir, '.queue.json'), 'utf8')), []);  // not resumed later
});

test('interrupted render: after a crash, the leftover is removed and the render resumes from the saved queue', async () => {
  const dirs = tmpApp();
  const a = start(dirs);
  const p = await newProject(dirs, a);
  // the app was closed (or crashed) while #2 was rendering: the queue file still lists it, and a
  // half-written file is left in the output folder
  a.queue.add('render', 'Render #2', p.slug, () => new Promise(() => {}), { clipId: 'c2', spec: { type: 'render', slug: p.slug, clipId: 'c2' } });
  await a.queue.saved();
  const outDir = path.join(dirs.outputDir, p.slug);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, '.rendering_c2.mp4'), 'half');
  fs.writeFileSync(path.join(outDir, 'keep_me.mp4'), 'a finished short');

  const b = start(dirs);                                                  // restart
  assert.equal(await b.rendering.cleanupPartial(), 1);
  assert.deepEqual(partials(outDir), []);
  assert.equal(fs.readFileSync(path.join(outDir, 'keep_me.mp4'), 'utf8'), 'a finished short');
  assert.deepEqual(b.queue.interrupted.map(x => [x.type, x.clipId, x.label]), [['render', 'c2', 'Render #2']]);
  const [job] = b.queue.takeInterrupted(true);
  await until(() => job.status === 'done' || job.status === 'error');
  assert.equal(job.status, 'done', job.error);
  assert.equal((await b.repo.load(p.slug)).clips[1].output, 'short_02_second.mp4');
  assert.equal(fs.readFileSync(path.join(outDir, 'short_02_second.mp4'), 'utf8'), 'video');
  await b.queue.saved();
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dirs.projectsDir, '.queue.json'), 'utf8')), []);
});

test('interrupted render: dismissing the interrupted tasks forgets them for good', async () => {
  const dirs = tmpApp();
  fs.writeFileSync(path.join(dirs.projectsDir, '.queue.json'), JSON.stringify([{ type: 'render', slug: 's', clipId: 'x', label: 'Render #1' }, { junk: true }]));
  const s = start(dirs);
  assert.equal(s.queue.interrupted.length, 1);                            // damaged entries are ignored
  s.queue.takeInterrupted(false);
  await s.queue.saved();
  assert.equal(start(dirs).queue.interrupted.length, 0);
  // an unreadable queue file doesn't stop the app from starting
  fs.writeFileSync(path.join(dirs.projectsDir, '.queue.json'), '{ not json');
  assert.equal(start(dirs).queue.interrupted.length, 0);
});
