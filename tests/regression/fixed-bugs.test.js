'use strict';
// Regression: one test per bug that was fixed, so it can't come back unnoticed.
// When you fix a bug, add a test here named after what the user saw, and say what caused it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { app, quiet, sleep, tmpApp, fakeFfmpeg } = require('../helpers');
const Timing = require(app('public/timing.js'));
const Layout = require(app('public/layout.js'));
const { STYLE_DEFAULTS, mergeClientSave } = require(app('src/core/project'));
const { friendlyError } = require(app('src/shared/errors'));
const { filterArgFor, parseVersion } = require(app('src/infrastructure/ffmpeg'));
const { createEnvironment } = require(app('src/infrastructure/environment'));
const { createProjectRepository } = require(app('src/repository/projectRepository'));
const { createRenderingService } = require(app('src/services/renderingService'));
const { createJobQueue } = require(app('src/services/jobQueue'));

test('a clip edge snapped "to a pause" could still cut into the next word', () => {
  // Cause: the snapped time was rounded to 0.1 s after choosing it, and with a pause of 0.25 s the
  // rounding pushed the end of the clip 0.04 s into the next word.
  const words = [{ w: 'nice', s: 4.8, e: 5.21 }, { w: 'shot', s: 5.46, e: 5.9 }];
  const r = Timing.snapEdge(5.3, 'end', { segs: Timing.speechSegments(words), duration: 60 });
  assert.equal(r.how, 'pause in speech');
  assert.ok(r.t >= 5.21 && r.t <= 5.46, `end at ${r.t}`);
});

test('the video was shifted 2 px to the right in the gameplay and split layouts', () => {
  // Cause: positions were rounded with the helper for sizes, which never returns less than 2.
  const meta = { width: 1920, height: 1080 };
  const box = { x: 0, y: 0, w: 1920, h: 1080 }, cam = { x: 1400, y: 700, w: 500, h: 360 };
  for (const mode of ['gameplay', 'split']) {
    const L = Layout.compute({ mode, cam, game: box }, meta, STYLE_DEFAULTS, true);
    for (const it of L.items) if (it.dst.w === 1080) assert.equal(it.dst.x, 0, `${mode}: ${it.key} starts at x = ${it.dst.x}`);
  }
});

test('a missing ffmpeg was reported as "Check that the video is still in the source folder"', () => {
  // Cause: the "file not found" rule (ENOENT) was checked before the "tool can't start" rule.
  for (const m of ['Cannot start ffmpeg.exe: spawn C:\\app\\tools\\ffmpeg\\ffmpeg.exe ENOENT', 'Cannot start ffprobe: spawn ffprobe ENOENT']) {
    assert.match(friendlyError(m), /^FFmpeg is missing/);
  }
  assert.match(friendlyError('ENOENT: no such file or directory, open source/stream.mkv'), /source folder/);  // still right for videos
});

test('a clip that ended before it started could be saved and reach the renderer', () => {
  // Cause: the server stored clip times from the browser as they came.
  const p = { rev: 0, meta: { duration: 100 }, clips: [] };
  mergeClientSave(p, { rev: 0, clips: [{ id: 'a', start: 50, end: 20 }, { id: 'b', start: 60, end: 60 }] });
  for (const c of p.clips) assert.ok(c.start < c.end && c.end - c.start >= 2);
});

test('shorts deleted outside the app still showed "Rendered"', async () => {
  // Cause: the project only remembered that a short had been rendered, never checked the file.
  const dirs = tmpApp();
  fs.writeFileSync(path.join(dirs.sourceDir, 'v.mp4'), '');
  const repo = createProjectRepository({ ...dirs, probe: async () => ({ duration: 60, width: 1920, height: 1080, fps: 30, hasAudio: true, size: 1 }) });
  const p = await repo.open('v.mp4');
  await repo.update(p.slug, q => { q.clips = [{ id: 'a', start: 0, end: 10, output: 'short_01.mp4' }]; });
  assert.equal((await repo.load(p.slug)).clips[0].outputMissing, true);
});

test('a half-written short stayed in the output folder after the app was closed during a render', async () => {
  // Cause: the unfinished file was only removed when the render failed, not when the app stopped.
  const dirs = tmpApp();
  fs.mkdirSync(path.join(dirs.outputDir, 'v'));
  fs.writeFileSync(path.join(dirs.outputDir, 'v', '.rendering_c1.mp4'), 'half');
  const repo = createProjectRepository({ ...dirs, probe: async () => ({}) });
  const rendering = createRenderingService({ repo, ffmpeg: fakeFfmpeg(), transcription: { available: false }, outputDir: dirs.outputDir, sourceDir: dirs.sourceDir, log: quiet });
  assert.equal(await rendering.cleanupPartial(), 1);
  assert.deepEqual(fs.readdirSync(path.join(dirs.outputDir, 'v')), []);
});

test('the task list file could be corrupted when tasks changed quickly', async () => {
  // Cause: overlapping saves wrote the same file at the same time. Saves are now serialized and atomic.
  const dirs = tmpApp();
  const queueFile = path.join(dirs.projectsDir, '.queue.json');
  const q = createJobQueue({ queueFile, log: quiet, specFn: () => () => sleep(1) });
  const jobs = [];
  for (let i = 0; i < 200; i++) {
    jobs.push(q.addSpec({ type: 'render', slug: 's', clipId: 'c' + i }, 'Render ' + i));
    if (i % 3 === 0) q.cancel(jobs[i - 1]);
  }
  await q.saved();
  JSON.parse(fs.readFileSync(queueFile, 'utf8'));                         // whole, valid JSON
  while (q.active().length) await sleep(5);
  await q.saved();
  assert.deepEqual(JSON.parse(fs.readFileSync(queueFile, 'utf8')), []);
});

test('captions regenerated by the server were wiped by an older autosave from the browser', () => {
  // Cause: the browser's copy always replaced the server's; now the newer captions version wins.
  const p = { rev: 1, meta: { duration: 100 }, clips: [{ id: 'a', start: 0, end: 10, num: 1, captions: [{ s: 1, e: 2, words: [] }], captionsVer: 3 }] };
  mergeClientSave(p, { rev: 1, clips: [{ id: 'a', start: 0, end: 10, captions: null, captionsVer: 2 }] });
  assert.equal(p.clips[0].captionsVer, 3);
  assert.equal(p.clips[0].captions.length, 1);
});

test('renders failed with ffmpeg 7+ ("Unrecognized option filter_complex_script")', () => {
  // Cause: ffmpeg 7 replaced -filter_complex_script with "-/filter_complex <file>".
  assert.equal(filterArgFor(parseVersion('ffmpeg version 7.1-full_build')), '-/filter_complex');
  assert.equal(filterArgFor(parseVersion('ffmpeg version n8.0')), '-/filter_complex');
  assert.equal(filterArgFor(parseVersion('ffmpeg version 6.1.1-3ubuntu5')), '-filter_complex_script');
});

test('speech recognition stalled on Linux machines with many cores', { skip: process.platform === 'win32' && 'Linux only' }, () => {
  // Cause: whisper.cpp's OpenMP threads busy-waited and fought for the CPU with 12 threads.
  const env = createEnvironment(tmpApp().root, { lookup: () => null });
  assert.equal(env.env.OMP_WAIT_POLICY, 'PASSIVE');
  assert.ok(env.WHISPER_THREADS >= 2 && env.WHISPER_THREADS <= 8);
});

test('any website open in the browser could send commands to the app', async () => {
  // Cause: listening on 127.0.0.1 was taken as "only the app can call it"; browsers let other sites
  // send requests to localhost. Requests must now come from the app's own page (Host, Origin, Sec-Fetch-Site).
  const http = require('http');
  const { createApp } = require(path.join(__dirname, '..', '..', 'app', 'server'));
  const a = createApp({ root: tmpApp().root, log: quiet });
  const server = await a.listen(0, { open: false });
  const port = server.address().port;
  const status = headers => new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/api/jobs/cancel', headers: { Host: `127.0.0.1:${port}`, 'Content-Type': 'text/plain', ...headers } }, res => { res.resume(); resolve(res.statusCode); });
    r.on('error', reject); r.end('{"all":true}');
  });
  try {
    assert.equal(await status({ Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site' }), 403);
    assert.equal(await status({ Origin: `http://127.0.0.1:${port}`, 'Sec-Fetch-Site': 'same-origin' }), 200);
  } finally { server.close(); }
});

test('a project file could make a render delete a file outside the output folder', async () => {
  // Cause: the clip's recorded output name was used as a path when the previous short was replaced.
  const dirs = tmpApp();
  fs.writeFileSync(path.join(dirs.sourceDir, 'v.mp4'), '');
  fs.mkdirSync(path.join(dirs.projectsDir, 'v'));
  fs.writeFileSync(path.join(dirs.projectsDir, 'v', 'project.json'), JSON.stringify({ version: 2, video: 'v.mp4', slug: 'v', meta: { duration: 60, width: 1920, height: 1080 }, clips: [{ id: 'a', num: 1, start: 0, end: 10, captionsOn: false, output: '../../victim.txt' }] }));
  fs.writeFileSync(path.join(dirs.root, 'victim.txt'), 'keep');
  const repo = createProjectRepository({ ...dirs, probe: async () => ({}) });
  await createRenderingService({ repo, ffmpeg: fakeFfmpeg(), transcription: { available: false }, outputDir: dirs.outputDir, sourceDir: dirs.sourceDir, log: quiet }).render({ id: 1 }, 'v', 'a');
  assert.equal(fs.readFileSync(path.join(dirs.root, 'victim.txt'), 'utf8'), 'keep');
});

test('on Windows the app crashed at startup when setup had not been run yet', () => {
  // Cause: the font configuration was written into tools/ before that folder existed.
  const root = tmpApp().root;
  createEnvironment(root, { lookup: () => null }).prepare();
  assert.ok(fs.existsSync(path.join(root, 'tools')));
});
