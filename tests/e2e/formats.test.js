'use strict';
// End-to-end: many kinds of recordings with the real FFmpeg. Each is opened (probed), analyzed and
// rendered; the finished short must be a valid 1080x1920 video of the right length with sound.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { app, quiet, tmpApp, realTools, NO_FFMPEG, probeJSON } = require('../helpers');
const { createProjectRepository } = require(app('src/repository/projectRepository'));
const { createDetectionService } = require(app('src/services/detectionService'));
const { createRenderingService } = require(app('src/services/renderingService'));
const { fingerprint } = require(app('src/infrastructure/fingerprint'));

const tools = realTools();
const required = process.env.S2S_REQUIRE_FFMPEG === '1';
const ff = args => tools.runner.runCapture(tools.env.tools.FFMPEG, ['-v', 'error', '-y', ...args]);
const tone = (f, d) => ['-f', 'lavfi', '-i', `sine=frequency=${f}:sample_rate=48000:duration=${d}`];

// name, ffmpeg arguments that write the file (given its path), expected facts
const CASES = [
  { name: '720p30', file: 'a 720p.mp4', make: o => ff(['-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=8', ...tone(440, 8), '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', o]), w: 1280, h: 720, fps: 30 },
  { name: '1080p60', file: 'b 1080p60.mkv', make: o => ff(['-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=60:duration=6', ...tone(440, 6), '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', o]), w: 1920, h: 1080, fps: 60 },
  { name: '1440p24 (film)', file: 'c 1440p24.mov', make: o => ff(['-f', 'lavfi', '-i', 'testsrc2=size=2560x1440:rate=24:duration=6', ...tone(440, 6), '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', o]), w: 2560, h: 1440, fps: 24 },
  { name: '4K 25 fps', file: 'd 4k.mp4', make: o => ff(['-f', 'lavfi', '-i', 'testsrc2=size=3840x2160:rate=25:duration=4', ...tone(440, 4), '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', o]), w: 3840, h: 2160, fps: 25 },
  { name: 'portrait (phone)', file: 'e portrait.mp4', make: o => ff(['-f', 'lavfi', '-i', 'testsrc2=size=1080x1920:rate=30:duration=6', ...tone(440, 6), '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', o]), w: 1080, h: 1920, fps: 30 },
  { name: 'ultrawide 21:9', file: 'f ultrawide.mp4', make: o => ff(['-f', 'lavfi', '-i', 'testsrc2=size=3440x1440:rate=30:duration=5', ...tone(440, 5), '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', o]), w: 3440, h: 1440, fps: 30 },
  { name: 'no audio', file: 'g silent.mp4', make: o => ff(['-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=6', '-c:v', 'libx264', '-preset', 'ultrafast', o]), w: 1280, h: 720, fps: 30, noAudio: true },
  { name: 'two audio tracks (game + mic)', file: 'h two tracks.mkv', make: o => ff(['-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=6', ...tone(440, 6), ...tone(880, 6), '-map', '0:v', '-map', '1:a', '-map', '2:a', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', o]), w: 1280, h: 720, fps: 30, twoTracks: true },
  { name: 'variable frame rate', file: 'i vfr.mp4', make: o => ff(['-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=60:duration=6', ...tone(440, 6), '-vf', "select='not(mod(n\\,3))+lt(mod(t\\,2)\\,1)'", '-fps_mode', 'vfr', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', o]), w: 1280, h: 720, vfr: true },
  { name: 'odd size, square pixels off', file: 'j odd.mp4', make: o => ff(['-f', 'lavfi', '-i', 'testsrc2=size=1366x768:rate=30:duration=5', ...tone(440, 5), '-vf', 'setsar=4/3', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', o]), w: 1366, h: 768, fps: 30 },
  { name: 'unicode name', file: 'Vidéo 日本語 ✓ (live).mp4', make: o => ff(['-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=6', ...tone(440, 6), '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', o]), w: 1280, h: 720, fps: 30, unicode: true },
];

test('every kind of recording opens, analyzes and renders a valid short', { skip: !tools && !required && NO_FFMPEG, timeout: 900000 }, async t => {
  assert.ok(tools, NO_FFMPEG);
  const dirs = tmpApp('s2s-formats-');
  const repo = createProjectRepository({ ...dirs, probe: f => tools.ffmpeg.probe(f) });
  const detection = createDetectionService({ repo, ffmpeg: tools.ffmpeg, sourceDir: dirs.sourceDir, fingerprint });
  const rendering = createRenderingService({ repo, ffmpeg: tools.ffmpeg, transcription: { available: false }, outputDir: dirs.outputDir, sourceDir: dirs.sourceDir, log: quiet });
  for (const c of CASES) {
    await t.test(c.name, async () => {
      await c.make(path.join(dirs.sourceDir, c.file));
      let p = await repo.open(c.file);
      assert.deepEqual([p.meta.width, p.meta.height], [c.w, c.h]);
      if (c.fps) assert.ok(Math.abs(p.meta.fps - c.fps) < 0.5, `fps ${p.meta.fps}`);
      assert.equal(p.meta.hasAudio, !c.noAudio);
      await detection.analyze({ id: c.name }, p.slug);
      const a = await repo.readAnalysis(p.slug);
      assert.equal(a.rms.length, Math.ceil(p.meta.duration));
      p = await repo.load(p.slug);
      assert.ok(p.hasProxy);
      // a clip in the split layout, with a title and a caption (unicode in the last case)
      p.layout.mode = 'split';
      p.clips = [{ id: 'k', start: 1, end: 4, title1: c.unicode ? 'ÇA VA 🔥' : 'TEST', captionsOn: true,
        captions: [{ s: 1.5, e: 3, words: (c.unicode ? ['مرحبا', '你好', '😂'] : ['one', 'two']).map((w, i) => ({ w, s: 1.5 + i * 0.5, e: 1.9 + i * 0.5 })) }], captionsRange: [1, 4] }];
      p = await repo.saveFromClient(p.slug, p);
      await rendering.render({ id: c.name }, p.slug, 'k');                 // also runs the output checks
      const q = await repo.load(p.slug);
      const out = path.join(dirs.outputDir, q.slug, q.clips[0].output);
      const info = await probeJSON(tools, out);
      const v = info.streams.find(s => s.codec_type === 'video');
      assert.deepEqual([v.width, v.height], [1080, 1920]);
      assert.ok(Math.abs(Number(info.format.duration) - 3) < 0.2, `duration ${info.format.duration}`);
      assert.ok(info.streams.some(s => s.codec_type === 'audio'));
      if (c.twoTracks) {
        // 440 Hz on track 1, 880 Hz on track 2: both must be in the short
        const band = f => { const r = require('child_process').spawnSync(tools.env.tools.FFMPEG, ['-hide_banner', '-nostats', '-i', out, '-af', `bandpass=f=${f}:width_type=h:w=60,volumedetect`, '-f', 'null', '-'], { encoding: 'utf8' }); return Number((r.stderr.match(/mean_volume: (-?[\d.]+)/) || [])[1]); };
        assert.equal(p.meta.audioStreams, 2);
        assert.ok(band(440) > -40 && band(880) > -40, `both tracks heard: 440 Hz ${band(440)} dB, 880 Hz ${band(880)} dB`);
      }
      if (c.unicode) {
        assert.match(fs.readFileSync(path.join(repo.fileIn(q.slug, 'render', 'k'), 'subs.ass'), 'utf8'), /مرحبا 你好 😂|你好/);
        assert.match(fs.readFileSync(out.replace(/\.mp4$/, '.txt'), 'utf8'), /Ça va 🔥|ÇA VA 🔥/);
      }
    });
  }
});
