'use strict';
// Integration: a project file from someone else can't make the app read, write or delete files
// outside its folders, or inject commands into the subtitle file and the ffmpeg filter graph.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { app, quiet, tmpApp, fakeFfmpeg } = require('../helpers');
const { createProjectRepository } = require(app('src/repository/projectRepository'));
const { createRenderingService } = require(app('src/services/renderingService'));
const { createTranscriptionService } = require(app('src/services/transcriptionService'));
const { createProcessRunner } = require(app('src/infrastructure/process'));
const { mergeClientSave } = require(app('src/core/project'));

const META = { duration: 600, width: 1920, height: 1080, fps: 30, hasAudio: true, size: 1 };
function setup(project) {
  const dirs = tmpApp('s2s-untrusted-');
  fs.writeFileSync(path.join(dirs.sourceDir, 'stream.mp4'), '');
  fs.mkdirSync(path.join(dirs.projectsDir, 'stream'));
  fs.writeFileSync(path.join(dirs.projectsDir, 'stream', 'project.json'), JSON.stringify({ version: 2, slug: 'stream', meta: META, ...project }));
  const repo = createProjectRepository({ ...dirs, probe: async () => META });
  return { dirs, repo };
}

test('a project whose video points outside the source folder is refused', async () => {
  for (const video of ['../../secret.mp4', '..\\..\\secret.mp4', '/etc/passwd', 'C:\\Windows\\win.ini', '', null, 'notes.txt']) {
    const { repo } = setup({ video, clips: [] });
    await assert.rejects(repo.load('stream'), e => e.code === 422, String(video));
  }
});

test('a crafted project cannot delete, overwrite or create files outside the app folders', async () => {
  const { dirs, repo } = setup({
    video: 'stream.mp4',
    style: { titleFont: 'Arial\n[Events]\nDialogue: 9,0:00:00.00,9:00:00.00,Default,,0,0,0,,HACKED', captionFont: 'Impact', captionSize: '84\nStyle: X', fps: '30,movie=/etc/passwd', crf: 20, captions: true, background: 'blur' },
    whisper: { model: '../../../../secret.bin', language: '-of /tmp/x', prompt: '' },
    layout: { mode: 'split', cam: { x: '0;movie=x', y: 0, w: 400, h: 300 }, game: { x: 0, y: 0, w: 1920, h: 1080 } },
    clips: [
      { id: '../../../../outside', num: 1, start: 10, end: 20, title1: 'Hi {\\fnEvil}', output: '../../../important.txt', captionsOn: false },
      { id: 'ok_1', num: 2, start: 30, end: 20, output: 'C:\\Windows\\win.ini' },
    ],
  });
  const important = path.join(dirs.root, 'important.txt');
  fs.writeFileSync(important, 'do not delete');

  const p = await repo.load('stream');
  const [a, b] = p.clips;
  assert.match(a.id, /^[A-Za-z0-9_-]+$/);
  assert.equal(a.output, undefined);                                        // dangerous output name dropped
  assert.equal(b.output, undefined);
  assert.ok(b.start < b.end);
  assert.equal(p.whisper.model, 'ggml-small.bin');
  assert.equal(p.whisper.language, 'auto');
  assert.equal(p.style.titleFont, 'Impact');
  assert.equal(p.style.captionSize, 84);
  assert.equal(p.style.fps, 30);
  assert.equal(p.layout.cam.x, 0);

  const ffmpeg = fakeFfmpeg();
  const rendering = createRenderingService({ repo, ffmpeg, transcription: { available: false }, outputDir: dirs.outputDir, sourceDir: dirs.sourceDir, log: quiet });
  await rendering.render({ id: 1 }, 'stream', a.id);
  assert.equal(fs.readFileSync(important, 'utf8'), 'do not delete');
  // everything written stays inside the app folders
  const args = ffmpeg.calls[0].args;
  const out = args[args.length - 1];
  assert.ok(out.startsWith(path.join(dirs.outputDir, 'stream') + path.sep), out);
  assert.ok(ffmpeg.calls[0].opts.cwd.startsWith(path.join(dirs.projectsDir, 'stream') + path.sep));
  const work = ffmpeg.calls[0].opts.cwd;
  const ass = fs.readFileSync(path.join(work, 'subs.ass'), 'utf8');
  assert.equal((ass.match(/^\[Events\]$/gm) || []).length, 1, 'no injected subtitle sections');
  assert.ok(!/HACKED/.test(ass));
  assert.ok(!/\\fnEvil/.test(ass), 'override tags in titles are removed');
  const filter = fs.readFileSync(path.join(work, 'filter.txt'), 'utf8');
  assert.ok(!/movie=|amovie=|sendcmd|zmq|\/etc\//.test(filter), 'no file-reading filters injected');
  assert.ok(/^\[0:v\]fps=30,/.test(filter));
  const saved = JSON.parse(fs.readFileSync(repo.projFile('stream'), 'utf8'));
  assert.ok(saved.clips.every(c => /^[A-Za-z0-9_-]+$/.test(c.id)), 'the repaired project is what gets saved');
});

test('whisper settings from a project can only select a model inside tools/whisper/models', async () => {
  const { dirs, repo } = setup({ video: 'stream.mp4', whisper: { model: '..\\..\\x.bin', language: 'auto', prompt: '--help' }, clips: [{ id: 'c1', start: 0, end: 10 }] });
  const models = path.join(dirs.root, 'models');
  const t = createTranscriptionService({ repo, ffmpeg: fakeFfmpeg(), runner: createProcessRunner(), whisperPath: 'whisper-cli', modelsDir: models, threads: 2, sourceDir: dirs.sourceDir, isWin: false });
  const e = await t.captionClip({}, 'stream', 'c1').catch(x => x);
  assert.match(e.message, /Speech model not found: tools\/whisper\/models\/ggml-small\.bin/);
});

test('browser saves go through the same checks', async () => {
  const { repo } = setup({ video: 'stream.mp4', clips: [] });
  const p = await repo.load('stream');
  const saved = await repo.saveFromClient('stream', { ...p, video: '../../other.mp4', clips: [{ id: '../x', start: 5, end: 9, output: '../../y.mp4' }] });
  assert.equal(saved.video, 'stream.mp4');                                  // the video of a project never changes
  assert.match(saved.clips[0].id, /^[A-Za-z0-9_-]+$/);
  assert.equal(saved.clips[0].output, undefined);
  // mergeClientSave never takes the video name from the browser
  const q = { rev: 0, video: 'a.mp4', meta: { duration: 10 }, clips: [] };
  mergeClientSave(q, { rev: 0, video: '../evil.mp4', clips: [] });
  assert.equal(q.video, 'a.mp4');
});

test('values shown in the page are the expected type (no markup from a project file)', async () => {
  const { repo } = setup({ video: 'stream.mp4', detect: { count: '"><img src=x onerror=alert(1)>', length: 40, gap: '3' }, clips: [] });
  const p = await repo.load('stream');
  assert.equal(p.detect.count, 12);
  assert.equal(p.detect.length, 40);
  assert.equal(p.detect.gap, 3);
});
