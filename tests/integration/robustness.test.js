'use strict';
// Integration: interrupted speech recognition, a large library of videos, low memory.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { app, quiet, tmpApp, fakeFfmpeg } = require('../helpers');
const { createProjectRepository } = require(app('src/repository/projectRepository'));
const { createTranscriptionService } = require(app('src/services/transcriptionService'));
const { createRenderingService } = require(app('src/services/renderingService'));
const { createDetectionService } = require(app('src/services/detectionService'));

// A fake whisper: crashes (after writing half an output file) or answers with known words.
function fakeWhisper() {
  const w = { mode: 'ok', calls: 0 };
  w.runner = {
    runProc: async (job, cmd, args, opts) => {
      w.calls++;
      const out = path.join(opts.cwd, args[args.indexOf('-of') + 1] + '.json');
      if (w.mode === 'crash') { fs.writeFileSync(out, '{"transcription": [{"text": " hal'); throw new Error('whisper-cli failed (code 3221225477)\nggml: out of memory'); }
      if (w.mode === 'cancel') { job.cancelled = true; throw new Error('Cancelled'); }
      fs.writeFileSync(out, JSON.stringify({ result: { language: 'en' }, transcription: [
        { text: ' the', offsets: { from: 1000, to: 1300 } }, { text: ' trick', offsets: { from: 1400, to: 1800 } }, { text: ' haha', offsets: { from: 5000, to: 5600 } }] }));
    },
  };
  return w;
}

test('interrupted speech recognition leaves no damaged cache, and the next run works', async () => {
  const dirs = tmpApp('s2s-ai-');
  fs.writeFileSync(path.join(dirs.sourceDir, 'v.mp4'), '');
  const models = path.join(dirs.root, 'models'); fs.mkdirSync(models); fs.writeFileSync(path.join(models, 'ggml-small.bin'), 'model');
  const repo = createProjectRepository({ ...dirs, probe: async () => ({ duration: 20, width: 1920, height: 1080, fps: 30, hasAudio: true }) });
  const p = await repo.open('v.mp4');
  const w = fakeWhisper();
  const t = createTranscriptionService({ repo, ffmpeg: fakeFfmpeg(), runner: w.runner, whisperPath: 'whisper-cli', modelsDir: models, threads: 2, sourceDir: dirs.sourceDir, isWin: false });
  const tdir = repo.fileIn(p.slug, 'transcripts');
  const caches = () => (fs.existsSync(tdir) ? fs.readdirSync(tdir) : []);   // nothing at all may be left

  w.mode = 'crash';
  await assert.rejects(t.transcribeAll({ id: 1 }, p.slug), /out of memory/);
  assert.deepEqual(caches(), [], 'a crash writes no transcript');
  w.mode = 'cancel';
  await assert.rejects(t.transcribeAll({ id: 2 }, p.slug), /Cancelled/);
  assert.deepEqual(caches(), [], 'a cancel writes no transcript');
  w.mode = 'ok';
  await t.transcribeAll({ id: 3 }, p.slug);
  const full = JSON.parse(fs.readFileSync(path.join(tdir, 'full.json'), 'utf8'));
  assert.deepEqual(full.words.map(x => x.w), ['the', 'trick', 'haha']);
  // smart detection can now use it; a second transcription is served from the cache
  const detection = createDetectionService({ repo, ffmpeg: fakeFfmpeg(), sourceDir: dirs.sourceDir });
  await repo.writeAnalysis(p.slug, { rms: new Array(20).fill(-30), scene: new Array(20).fill(0) });
  const q = await detection.detect(p.slug, { engine: 'smart', count: 1, length: 10 }, 'replace');
  assert.equal(q.clips.length, 1);
  const before = w.calls;
  await t.transcribeAll({ id: 4 }, p.slug);
  assert.equal(w.calls, before, 'cached: whisper not run again');
});

test('a library of 300 videos lists and opens quickly', async () => {
  const { createApp } = require(app('../app/server'));
  const root = tmpApp('s2s-lib-').root;
  for (let i = 0; i < 300; i++) {
    const name = `stream ${String(i).padStart(3, '0')}.mp4`, slug = `stream_${String(i).padStart(3, '0')}`;
    fs.writeFileSync(path.join(root, 'source', name), '');
    if (i % 2) continue;   // half of them already have a project with clips
    fs.mkdirSync(path.join(root, 'projects', slug));
    fs.writeFileSync(path.join(root, 'projects', slug, 'project.json'), JSON.stringify({ version: 5, video: name, slug, analyzed: true, meta: { duration: 3600, width: 1920, height: 1080, hasAudio: true, audioChecked: true },
      clips: Array.from({ length: 20 }, (_, k) => ({ id: 'c' + k, num: k + 1, start: k * 60, end: k * 60 + 30, output: k < 5 ? `short_${k}.mp4` : undefined })) }));
  }
  const a = createApp({ root, log: quiet });
  const server = await a.listen(0, { open: false });
  const port = server.address().port;
  const get = url => new Promise((resolve, reject) => http.get({ host: '127.0.0.1', port, path: url, headers: { Host: `127.0.0.1:${port}` } }, res => { let d = ''; res.on('data', c => { d += c; }); res.on('end', () => resolve(JSON.parse(d))); }).on('error', reject));
  try {
    let t0 = Date.now();
    const list = await get('/api/videos');
    const tList = Date.now() - t0;
    assert.equal(list.length, 300);
    assert.equal(list.filter(v => v.hasProject).length, 150);
    assert.ok(tList < 5000, `listing 300 videos took ${tList} ms`);
    t0 = Date.now();
    const p = await get('/api/project?video=' + encodeURIComponent('stream 150.mp4'));
    assert.equal(p.clips.length, 20);
    assert.ok(Date.now() - t0 < 2000);
  } finally { a.stopTools(); server.close(); }
});

test('low free memory: the render task warns before it starts', async () => {
  const dirs = tmpApp('s2s-mem-');
  fs.writeFileSync(path.join(dirs.sourceDir, 'v.mp4'), '');
  const repo = createProjectRepository({ ...dirs, probe: async () => ({ duration: 60, width: 3840, height: 2160, fps: 60, hasAudio: true }) });
  let p = await repo.open('v.mp4');
  p.clips = [{ id: 'c', start: 0, end: 30, captionsOn: false }];
  p = await repo.saveFromClient(p.slug, p);
  const low = createRenderingService({ repo, ffmpeg: fakeFfmpeg(), transcription: { available: false }, outputDir: dirs.outputDir, sourceDir: dirs.sourceDir, log: quiet, freeMemoryMB: () => 300 });
  const job = { id: 1 };
  await low.render(job, p.slug, 'c');
  assert.match(job.note, /may need about \d+ MB of memory and only 300 MB is free/);
  const plenty = createRenderingService({ repo, ffmpeg: fakeFfmpeg(), transcription: { available: false }, outputDir: dirs.outputDir, sourceDir: dirs.sourceDir, log: quiet, freeMemoryMB: () => 16000 });
  const job2 = { id: 2 };
  await plenty.render(job2, p.slug, 'c');
  assert.equal(job2.note, undefined);
});
