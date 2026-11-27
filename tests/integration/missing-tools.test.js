'use strict';
// Integration: missing FFmpeg or Whisper produce errors a user can act on, not raw system messages.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { app, quiet, sleep, tmpApp, fakeFfmpeg } = require('../helpers');
const { friendlyError } = require(app('src/shared/errors'));
const { createProcessRunner, IS_WIN } = require(app('src/infrastructure/process'));
const { createFfmpeg, MISSING_FFMPEG } = require(app('src/infrastructure/ffmpeg'));
const { createEnvironment } = require(app('src/infrastructure/environment'));
const { createProjectRepository } = require(app('src/repository/projectRepository'));
const { createTranscriptionService } = require(app('src/services/transcriptionService'));
const { createRenderingService } = require(app('src/services/renderingService'));
const { createJobQueue } = require(app('src/services/jobQueue'));

const runner = createProcessRunner();
const NOWHERE = path.join(tmpApp().root, 'tools', 'ffmpeg', IS_WIN ? 'ffmpeg.exe' : 'ffmpeg');   // does not exist

test('missing FFmpeg: a task explains that FFmpeg is missing (not that the video is)', async () => {
  const job = {};
  const err = await runner.runProc(job, NOWHERE, ['-version']).catch(e => e);
  assert.match(err.message, /^Cannot start ffmpeg/);
  const hint = friendlyError(err.message);
  assert.match(hint, /FFmpeg is missing/);
  assert.match(hint, /setup\.bat.*setup\.sh/);
  assert.doesNotMatch(hint, /source folder/);
});

test('missing FFmpeg: opening a video says how to install it', async () => {
  const ffmpeg = createFfmpeg({ ffmpegPath: NOWHERE, ffprobePath: NOWHERE.replace(/ffmpeg(\.exe)?$/, 'ffprobe$1'), runner });
  await assert.rejects(ffmpeg.probe('video.mp4'), e => e.message.startsWith(MISSING_FFMPEG));
  const dirs = tmpApp();
  fs.writeFileSync(path.join(dirs.sourceDir, 'v.mp4'), '');
  const repo = createProjectRepository({ projectsDir: dirs.projectsDir, sourceDir: dirs.sourceDir, probe: src => ffmpeg.probe(src) });
  await assert.rejects(repo.open('v.mp4'), /FFmpeg is not installed.*setup/);
  assert.equal(fs.existsSync(path.join(dirs.projectsDir, 'v', 'project.json')), false);      // nothing half-created
  // the version check falls back instead of crashing
  assert.equal(ffmpeg.filterArg, '-/filter_complex');
});

test('missing Whisper: captions fail with a clear message, the rest of the app keeps working', async () => {
  const dirs = tmpApp();
  fs.writeFileSync(path.join(dirs.sourceDir, 'v.mp4'), '');
  const repo = createProjectRepository({ projectsDir: dirs.projectsDir, sourceDir: dirs.sourceDir, probe: async () => ({ duration: 60, width: 1920, height: 1080, fps: 30, hasAudio: true, size: 1 }) });
  const p = await repo.open('v.mp4');
  await repo.update(p.slug, q => { q.clips = [{ id: 'c1', start: 0, end: 10, captionsOn: true }, { id: 'c2', start: 20, end: 30, captionsOn: false }]; });
  const ffmpeg = fakeFfmpeg();
  const none = createTranscriptionService({ repo, ffmpeg, runner, whisperPath: null, modelsDir: path.join(dirs.root, 'models'), threads: 2, sourceDir: dirs.sourceDir, isWin: IS_WIN });
  assert.equal(none.available, false);
  const rendering = createRenderingService({ repo, ffmpeg, transcription: none, outputDir: dirs.outputDir, sourceDir: dirs.sourceDir, log: quiet });

  const queue = createJobQueue({ queueFile: path.join(dirs.projectsDir, '.queue.json'), log: quiet, specFn: s => j => (s.type === 'captions' ? none.captionClip(j, s.slug, s.clipId) : rendering.render(j, s.slug, s.clipId)) });
  const jobs = [
    queue.addSpec({ type: 'captions', slug: p.slug, clipId: 'c1' }, 'Captions #1'),
    queue.addSpec({ type: 'render', slug: p.slug, clipId: 'c1' }, 'Render #1'),
    queue.addSpec({ type: 'render', slug: p.slug, clipId: 'c2' }, 'Render #2'),
  ];
  while (jobs.some(j => j.status === 'queued' || j.status === 'running')) await sleep(5);
  assert.deepEqual(jobs.map(j => j.status), ['error', 'error', 'done']);  // a clip without captions still renders
  for (const j of jobs.slice(0, 2)) assert.equal(j.hint, 'Speech recognition is not installed correctly. See the Captions & AI tab.');
  assert.match(jobs[0].error, /whisper-cli/);
  assert.match(jobs[1].error, /turn captions off/);

  // whisper is installed but the speech model was not downloaded
  const noModel = createTranscriptionService({ repo, ffmpeg, runner, whisperPath: '/usr/bin/whisper-cli', modelsDir: path.join(dirs.root, 'models'), threads: 2, sourceDir: dirs.sourceDir, isWin: IS_WIN });
  const e = await noModel.captionClip({}, p.slug, 'c1').catch(x => x);
  assert.match(e.message, /Speech model not found: tools\/whisper\/models\/ggml-small\.bin/);
  assert.match(friendlyError(e.message), /Speech recognition is not installed/);

  // whisper can't start (deleted, or blocked by an antivirus)
  assert.match(friendlyError('Cannot start whisper-cli.exe: spawn whisper-cli.exe ENOENT'), /Speech recognition \(whisper\) is missing/);
});

test('missing tools are reported at startup in plain language', () => {
  const root = tmpApp().root;
  const none = createEnvironment(root, { lookup: () => null });
  assert.equal(none.tools.WHISPER, null);
  const msgs = none.missingTools();
  assert.equal(msgs.length, 2);
  assert.match(msgs[0], /FFmpeg was not found.*can't be opened or rendered.*setup/);
  assert.match(msgs[1], /whisper-cli\) was not found.*Captions are unavailable.*everything else works/);

  // tools on the PATH, but no speech model yet
  const onPath = createEnvironment(root, { lookup: name => '/usr/bin/' + name });
  assert.deepEqual(onPath.missingTools(), [`No speech model in tools/whisper/models. Captions are unavailable until you run ${IS_WIN ? 'setup.bat' : './setup.sh'}.`]);
  fs.mkdirSync(path.join(root, 'tools', 'whisper', 'models'), { recursive: true });
  fs.writeFileSync(path.join(root, 'tools', 'whisper', 'models', 'ggml-small.bin'), '');
  assert.deepEqual(onPath.missingTools(), []);
});
