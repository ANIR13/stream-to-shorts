'use strict';
// End-to-end: the whole video-to-Short workflow with the real FFmpeg, on a generated recording.
//   open video -> analyze -> suggested clips -> captions -> render -> check the finished file
//   -> restart the app -> cancel a real render half-way.
// Skipped when FFmpeg isn't installed. Speech recognition isn't needed: the captions use the known
// times of beeps in the generated audio, which is exactly what checks that captions and audio line up.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { app, quiet, sleep, tmpApp, realTools, NO_FFMPEG, probeJSON, soundOnsets } = require('../helpers');
const { createProjectRepository } = require(app('src/repository/projectRepository'));
const { createDetectionService } = require(app('src/services/detectionService'));
const { createRenderingService } = require(app('src/services/renderingService'));
const { createJobQueue } = require(app('src/services/jobQueue'));
const Layout = require(app('public/layout.js'));

const tools = realTools();
const SECONDS = 45;
const BEEPS = [12, 15, 18];          // seconds in the recording where a short beep starts
const CLIP = { start: 10, end: 20 };

// A 45 s 1280x720 "stream": moving test picture, silence with three short beeps, and a loud,
// busy stretch at 30-38 s that detection should find.
function makeRecording(file) {
  const loud = BEEPS.map(t => `between(t,${t},${t + 0.3})`).concat('between(t,30,38)').join('+');
  return tools.runner.runCapture(tools.env.tools.FFMPEG, ['-v', 'error', '-y',
    '-f', 'lavfi', '-i', `testsrc2=size=1280x720:rate=30:duration=${SECONDS}`,
    '-f', 'lavfi', '-i', `sine=frequency=880:sample_rate=48000:duration=${SECONDS}`,
    '-filter_complex', `[1]volume='if(${loud},0.7,0)':eval=frame[a];[0]hue=s='if(between(t,30,38),8,1)'[v]`,
    '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', file]);
}

function app3(dirs) {
  const repo = createProjectRepository({ projectsDir: dirs.projectsDir, sourceDir: dirs.sourceDir, outputDir: dirs.outputDir, probe: src => tools.ffmpeg.probe(src) });
  const detection = createDetectionService({ repo, ffmpeg: tools.ffmpeg, sourceDir: dirs.sourceDir });
  const rendering = createRenderingService({ repo, ffmpeg: tools.ffmpeg, transcription: { available: false }, outputDir: dirs.outputDir, sourceDir: dirs.sourceDir, log: quiet });
  const queue = createJobQueue({
    queueFile: path.join(dirs.projectsDir, '.queue.json'), log: quiet,
    specFn: s => (s.type === 'analyze' ? j => detection.analyze(j, s.slug) : j => rendering.render(j, s.slug, s.clipId)),
  });
  return { repo, detection, rendering, queue };
}
async function finish(job, ms = 180000) {
  const t0 = Date.now();
  while (job.status === 'queued' || job.status === 'running') { if (Date.now() - t0 > ms) throw new Error('task timeout'); await sleep(20); }
  return job;
}

test('end-to-end: recording -> analysis -> clips -> captions -> 1080x1920 short, in sync, survives a restart', { skip: !tools && NO_FFMPEG, timeout: 300000 }, async () => {
  const dirs = tmpApp('s2s-e2e-');
  await makeRecording(path.join(dirs.sourceDir, 'my stream.mp4'));
  const s = app3(dirs);

  // 1. open: the real video facts
  let p = await s.repo.open('my stream.mp4');
  assert.equal(p.slug, 'my_stream');
  assert.deepEqual([p.meta.width, p.meta.height, Math.round(p.meta.fps), p.meta.hasAudio], [1280, 720, 30, true]);
  assert.ok(Math.abs(p.meta.duration - SECONDS) < 0.2);

  // 2. analyze: loudness and action per second, a preview copy, suggested clips
  const analyze = await finish(s.queue.addSpec({ type: 'analyze', slug: p.slug }, 'Analyze'));
  assert.equal(analyze.status, 'done', analyze.error);
  p = await s.repo.load(p.slug);
  assert.ok(p.analyzed && p.hasProxy);
  const a = await s.repo.readAnalysis(p.slug);
  assert.equal(a.rms.length, Math.ceil(p.meta.duration));
  assert.ok(Math.max(...a.rms.slice(31, 37)) > Math.max(...a.rms.slice(2, 10)) + 20, 'the loud part is measured as loud');
  assert.ok(p.clips.length >= 1);
  for (const c of p.clips) assert.ok(c.start >= 0 && c.start < c.end && c.end <= p.meta.duration);
  const best = [...p.clips].sort((x, y) => y.score - x.score)[0];
  assert.ok(best.start <= 31 && best.end >= 37, `the loud stretch is suggested (${best.start}-${best.end})`);

  // 3. edit like a user: one clip around the beeps, a title, a caption word on each beep
  const words = BEEPS.map((t, i) => ({ w: ['one', 'two', 'three'][i], s: t, e: t + 0.6 }));
  p.layout.mode = 'split';
  p.clips = [{ id: 'k1', ...CLIP, title1: 'Beep test', captionsOn: true, captions: words.map(w => ({ s: w.s, e: w.e, words: [w] })), captionsRange: [CLIP.start, CLIP.end] }];
  p = await s.repo.saveFromClient(p.slug, p);

  // 4. render through the task queue, like the Render button
  const render = await finish(s.queue.addSpec({ type: 'render', slug: p.slug, clipId: 'k1' }, 'Render #1'));
  assert.equal(render.status, 'done', render.error);
  p = await s.repo.load(p.slug);
  const clip = p.clips[0];
  const file = path.join(dirs.outputDir, 'my_stream', clip.output);
  assert.equal(clip.output, 'short_01_beep_test.mp4');
  assert.ok(fs.existsSync(file.replace(/\.mp4$/, '.txt')), 'upload text written next to the short');

  // 5. the finished file: vertical 1080 x 1920 H.264, square pixels, 30 fps, audio, the clip's length
  const info = await probeJSON(tools, file);
  const v = info.streams.find(x => x.codec_type === 'video');
  const au = info.streams.find(x => x.codec_type === 'audio');
  assert.deepEqual([v.width, v.height], [1080, 1920]);
  assert.equal(v.codec_name, 'h264');
  assert.equal(v.pix_fmt, 'yuv420p');
  assert.ok(!v.sample_aspect_ratio || v.sample_aspect_ratio === '1:1' || v.sample_aspect_ratio === '0:1');
  assert.equal(v.r_frame_rate, '30/1');
  assert.ok(au, 'has sound');
  assert.equal(Number(au.sample_rate), 48000);
  assert.ok(Math.abs(Number(info.format.duration) - (CLIP.end - CLIP.start)) < 0.15, `duration ${info.format.duration}`);

  // 6. sync: each beep is heard where its caption word is shown
  const heard = await soundOnsets(tools, file);
  const ass = fs.readFileSync(s.repo.fileIn(p.slug, 'render', 'k1', 'subs.ass'), 'utf8');
  const shown = ass.split('\n').filter(l => l.startsWith('Dialogue: 2,')).map(l => { const [h, m, sec] = l.split(',')[1].split(':'); return Number(h) * 3600 + Number(m) * 60 + Number(sec); });
  const expected = BEEPS.map(t => t - CLIP.start);
  assert.equal(shown.length, BEEPS.length);
  expected.forEach((t, i) => {
    assert.ok(Math.abs(shown[i] - t) < 0.02, `caption ${i + 1} shown at ${shown[i]} s, expected ${t} s`);
    const h = heard.find(x => Math.abs(x - t) < 0.25);
    assert.ok(h != null, `beep ${i + 1} heard near ${t} s (heard at ${heard.join(', ')})`);
    assert.ok(Math.abs(h - shown[i]) < 0.1, `beep ${i + 1}: heard at ${h} s, caption at ${shown[i]} s`);
  });

  // 7. restart: a new app on the same folders sees the same project, the short as up to date
  const s2 = app3(dirs);
  const again = await s2.repo.open('my stream.mp4');
  assert.deepEqual(again, p);
  assert.equal(again.clips[0].outputMissing, undefined);
  assert.equal(again.clips[0].renderSig, Layout.renderSig(again, again.clips[0]), 'not outdated');
  assert.equal(await s2.rendering.cleanupPartial(), 0, 'nothing left half-written');

  // 8. cancel a real render half-way: the finished short from before is kept, nothing half-written remains
  const before = fs.statSync(file);
  await s2.repo.update(p.slug, q => { q.clips[0].end = 40; q.clips[0].captionsOn = false; });   // a longer render
  const job = s2.queue.addSpec({ type: 'render', slug: p.slug, clipId: 'k1' }, 'Render #1');
  const t0 = Date.now();
  while (!(job.progress > 0.05) && job.status !== 'done' && Date.now() - t0 < 60000) await sleep(20);
  assert.equal(job.status, 'running', 'the render was still running when cancelled');
  s2.queue.cancel(job);
  await finish(job);
  assert.equal(job.status, 'cancelled');
  const outDir = path.dirname(file);
  assert.deepEqual(fs.readdirSync(outDir).filter(n => n.startsWith('.rendering_')), []);
  const after = fs.statSync(file);
  assert.equal(after.size, before.size);
  assert.equal(after.mtimeMs, before.mtimeMs);
  assert.equal((await s2.repo.load(p.slug)).clips[0].output, 'short_01_beep_test.mp4');
});
