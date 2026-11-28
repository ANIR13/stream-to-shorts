'use strict';
// End-to-end: timeline features rendered by the real FFmpeg (cuts, text and image overlays, music).
// Skipped when FFmpeg isn't installed (fails instead with S2S_REQUIRE_FFMPEG=1, as in CI).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { app, quiet, tmpApp, realTools, NO_FFMPEG, probeJSON, soundOnsets } = require('../helpers');
const { createProjectRepository } = require(app('src/repository/projectRepository'));
const { createRenderingService } = require(app('src/services/renderingService'));

const tools = realTools();
const required = process.env.S2S_REQUIRE_FFMPEG === '1';
const BEEPS = [12, 15, 18];
const ff = args => tools.runner.runCapture(tools.env.tools.FFMPEG, ['-v', 'error', '-y', ...args]);

// Average colour of a small square of one frame (rgb 0-255).
function colourAt(file, t, x, y, size = 20) {
  const r = spawnSync(tools.env.tools.FFMPEG, ['-v', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', `crop=${size}:${size}:${x}:${y}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { env: tools.env.env, maxBuffer: 1e7 });
  const b = r.stdout, n = b.length / 3, sum = [0, 0, 0];
  for (let i = 0; i < b.length; i += 3) { sum[0] += b[i]; sum[1] += b[i + 1]; sum[2] += b[i + 2]; }
  return sum.map(v => Math.round(v / n));
}
// Mean loudness (dB) of [from, from + len] of a file.
function meanVolume(file, from, len) {
  const r = spawnSync(tools.env.tools.FFMPEG, ['-hide_banner', '-nostats', '-ss', String(from), '-t', String(len), '-i', file, '-af', 'volumedetect', '-f', 'null', '-'], { env: tools.env.env, encoding: 'utf8' });
  return Number((String(r.stderr).match(/mean_volume: (-?[\d.]+) dB/) || [])[1]);
}

test('timeline: cuts, text and image overlays and music render correctly with FFmpeg', { skip: !tools && !required && NO_FFMPEG, timeout: 300000 }, async () => {
  assert.ok(tools, NO_FFMPEG);
  const dirs = tmpApp('s2s-tl-');
  const src = path.join(dirs.sourceDir, 'rec.mp4');
  const loud = BEEPS.map(t => `between(t,${t},${t + 0.3})`).join('+');
  await ff(['-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=25', '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000:duration=25',
    '-filter_complex', `[1]volume='if(${loud},0.7,0)':eval=frame[a]`, '-map', '0:v', '-map', '[a]', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', src]);
  await ff(['-f', 'lavfi', '-i', 'color=c=red:s=200x100', '-frames:v', '1', path.join(dirs.sourceDir, 'logo.png')]);
  await ff(['-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=48000:duration=3', path.join(dirs.sourceDir, 'music.wav')]);

  const repo = createProjectRepository({ ...dirs, probe: s => tools.ffmpeg.probe(s) });
  const rendering = createRenderingService({ repo, ffmpeg: tools.ffmpeg, transcription: { available: false }, outputDir: dirs.outputDir, sourceDir: dirs.sourceDir, log: quiet });
  let p = await repo.open('rec.mp4');
  p.layout.mode = 'gameplay';
  p.clips = [{ id: 'k1', start: 10, end: 20, title1: 'CUT TEST', captionsOn: false,
    cuts: [{ start: 13, end: 14.5 }],
    texts: [{ text: 'WAIT FOR IT', start: 0, end: 3, pos: 'top' }],
    images: [{ file: 'logo.png', start: 0, end: 10, pos: 'top-right', size: 0.2 }] }];
  p = await repo.saveFromClient(p.slug, p);

  // 1. cut + overlays: 8.5 s, beeps moved, the picture is there
  await rendering.render({ id: 1 }, p.slug, 'k1');
  const out = path.join(dirs.outputDir, p.slug, (await repo.load(p.slug)).clips[0].output);
  const info = await probeJSON(tools, out);
  const v = info.streams.find(s => s.codec_type === 'video');
  assert.deepEqual([v.width, v.height], [1080, 1920]);
  assert.ok(Math.abs(Number(info.format.duration) - 8.5) < 0.15, `duration ${info.format.duration}, expected 8.5`);
  const heard = await soundOnsets(tools, out);
  for (const t of [2, 3.5, 6.5]) assert.ok(heard.some(h => Math.abs(h - t) < 0.15), `beep near ${t} s after the cut (heard ${heard.join(', ')})`);
  const [r, g, b] = colourAt(out, 1, 850, 220);
  assert.ok(r > 170 && g < 90 && b < 90, `picture overlay is red at its place (got ${r},${g},${b})`);
  const [r2] = colourAt(out, 1, 100, 1000);
  assert.ok(r2 < 255, 'sanity: elsewhere it is the video');

  // 2. music: audible where the stream is silent, the short keeps its length
  await repo.update(p.slug, q => { q.clips[0].music = { file: 'music.wav', volume: 0.5, fadeIn: 0.2, fadeOut: 0.2, duck: true }; });
  const before = meanVolume(out, 4.2, 1.5);
  await rendering.render({ id: 2 }, p.slug, 'k1');
  const info2 = await probeJSON(tools, out);
  assert.ok(Math.abs(Number(info2.format.duration) - 8.5) < 0.15, 'music (looped, shorter than the clip) does not change the length');
  const after = meanVolume(out, 4.2, 1.5);
  assert.ok(after > before + 20, `music audible in a silent part: ${before} dB -> ${after} dB`);

  // 3. hiding the music track and the stream sound
  await repo.update(p.slug, q => { q.clips[0].tracks = { music: { hidden: true }, stream: { hidden: true } }; });
  await rendering.render({ id: 3 }, p.slug, 'k1');
  assert.ok(meanVolume(out, 0, 8) < -80, 'silent when both sound tracks are hidden');
});
