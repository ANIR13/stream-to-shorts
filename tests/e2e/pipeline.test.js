'use strict';
// End-to-end: the render pipeline with the real FFmpeg: profiles change size and quality, title and
// description are inside the MP4, a description change rewrites them without touching the video,
// the job reports memory and speed, the output passes its checks.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { app, quiet, tmpApp, realTools, NO_FFMPEG, probeJSON } = require('../helpers');
const { createProjectRepository } = require(app('src/repository/projectRepository'));
const { createRenderingService } = require(app('src/services/renderingService'));
const { createExportService } = require(app('src/services/exportService'));

const tools = realTools();
const required = process.env.S2S_REQUIRE_FFMPEG === '1';
// md5 of the video stream's packets (identical when the video was not re-encoded)
const videoHash = file => (spawnSync(tools.env.tools.FFMPEG, ['-v', 'error', '-i', file, '-map', '0:v', '-c', 'copy', '-f', 'md5', '-'], { encoding: 'utf8' }).stdout || '').trim();

test('render pipeline with FFmpeg: profiles, metadata without re-encoding, stats', { skip: !tools && !required && NO_FFMPEG, timeout: 300000 }, async () => {
  assert.ok(tools, NO_FFMPEG);
  const dirs = tmpApp('s2s-pipe-e2e-');
  await tools.runner.runCapture(tools.env.tools.FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=20',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=20', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', path.join(dirs.sourceDir, 's.mp4')]);
  const repo = createProjectRepository({ ...dirs, probe: f => tools.ffmpeg.probe(f) });
  const rendering = createRenderingService({ repo, ffmpeg: tools.ffmpeg, transcription: { available: false }, outputDir: dirs.outputDir, sourceDir: dirs.sourceDir, log: quiet });
  let p = await repo.open('s.mp4');
  p.layout.mode = 'gameplay';
  p.clips = [{ id: 'k', start: 2, end: 10, title1: 'GG EZ', description: 'First take', captionsOn: false }];
  p = await repo.saveFromClient(p.slug, p);
  const sizeWith = async profile => {
    await repo.update(p.slug, q => { q.style.renderProfile = profile; });
    const job = { id: profile };
    await rendering.render(job, p.slug, 'k');
    const file = path.join(dirs.outputDir, p.slug, (await repo.load(p.slug)).clips[0].output);
    return { job, file, size: fs.statSync(file).size };
  };
  const small = await sizeWith('small');
  const quality = await sizeWith('quality');
  assert.ok(small.size < quality.size * 0.8, `small file ${small.size} B < high quality ${quality.size} B`);
  // monitoring and estimate on a real job
  assert.ok(quality.job.stats.peakMemoryMB > 10, `peak memory ${quality.job.stats.peakMemoryMB} MB`);
  assert.ok(quality.job.stats.speed > 0, `speed ${quality.job.stats.speed}x`);
  assert.ok(quality.job.estimate.memoryMB > 0);
  // title and description inside the MP4
  const tags = (await probeJSON(tools, quality.file)).format.tags || {};
  assert.equal(tags.title, 'Gg ez');
  assert.match(tags.comment, /First take/);
  // a new description: metadata rewritten, the video itself untouched (same packets)
  const before = videoHash(quality.file);
  assert.ok(before.length > 10);
  await repo.update(p.slug, q => { q.clips[0].description = 'Better words'; });
  const exporting = createExportService({ repo, outputDir: dirs.outputDir, trash: { recycle: async () => {} }, rendering });
  assert.equal(await exporting.writeAllUploadTexts(p.slug), 1);
  assert.match(((await probeJSON(tools, quality.file)).format.tags || {}).comment, /Better words/);
  assert.equal(videoHash(quality.file), before, 'video stream not re-encoded');
  // the real output passes the same checks a render does
  await rendering.validateOutput(quality.file, { duration: 8, draft: false });
  await assert.rejects(rendering.validateOutput(quality.file, { duration: 20, draft: false }), /length 8 s instead of 20 s/);
  await assert.rejects(rendering.validateOutput(quality.file, { duration: 8, draft: true }), /size 1080x1920 instead of 540x960/);
});
