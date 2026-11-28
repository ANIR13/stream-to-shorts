'use strict';
// End-to-end: a render on this computer's graphics-card encoder (Intel Quick Sync, NVIDIA NVENC,
// AMD AMF or Apple VideoToolbox), when FFmpeg finds one. Skipped otherwise (CI machines have none);
// the encoder arguments of every vendor and the fallback to the processor are tested in unit and
// integration tests.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { app, quiet, tmpApp, realTools, probeJSON } = require('../helpers');
const { createProjectRepository } = require(app('src/repository/projectRepository'));
const { createRenderingService } = require(app('src/services/renderingService'));

const tools = realTools();

test('render on the graphics card', { timeout: 300000 }, async t => {
  if (!tools) return t.skip('ffmpeg is not installed');
  await tools.ffmpeg.detectHardware();
  if (!tools.ffmpeg.hardwareName) return t.skip('no graphics-card encoder on this computer');
  const dirs = tmpApp('s2s-gpu-');
  await tools.runner.runCapture(tools.env.tools.FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30:duration=8',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=8', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', path.join(dirs.sourceDir, 'g.mp4')]);
  const repo = createProjectRepository({ ...dirs, probe: f => tools.ffmpeg.probe(f) });
  const rendering = createRenderingService({ repo, ffmpeg: tools.ffmpeg, transcription: { available: false }, outputDir: dirs.outputDir, sourceDir: dirs.sourceDir, log: quiet });
  let p = await repo.open('g.mp4');
  p.style.encoder = 'gpu';
  p.clips = [{ id: 'k', start: 1, end: 6, title1: 'GPU', captionsOn: false }];
  p = await repo.saveFromClient(p.slug, p);
  const job = { id: 1 };
  await rendering.render(job, p.slug, 'k');
  const info = await probeJSON(tools, path.join(dirs.outputDir, p.slug, (await repo.load(p.slug)).clips[0].output));
  const v = info.streams.find(s => s.codec_type === 'video');
  assert.deepEqual([v.width, v.height, v.codec_name], [1080, 1920, 'h264']);
  t.diagnostic(`${tools.ffmpeg.hardwareName}${job.message === 'Graphics encoder failed, using the processor' ? ' failed, the processor was used' : ' was used'}`);
});
