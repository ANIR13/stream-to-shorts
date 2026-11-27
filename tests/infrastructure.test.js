'use strict';
// FFmpeg adapter, with a fake process runner (no ffmpeg needed).
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFfmpeg, parseVersion, filterArgFor, parseProbe, gpuArgsFor } = require('../app/src/infrastructure/ffmpeg');

test('ffmpeg version and filter-script argument', () => {
  assert.equal(parseVersion('ffmpeg version 9.0.2-4 Copyright (c) 2000-2026'), 9);
  assert.equal(parseVersion('ffmpeg version n7.1-3-g1234 Copyright'), 7);
  assert.equal(parseVersion('ffmpeg version 5.1.6-0+deb12u1'), 5);
  assert.equal(parseVersion('ffmpeg version N-129288-gc81e35cf2b-20261125'), 7); // nightly builds: assume modern
  assert.equal(filterArgFor(9), '-/filter_complex');
  assert.equal(filterArgFor(5), '-filter_complex_script');
});

test('ffprobe output parsing', () => {
  const j = { format: { duration: '2694.35', size: '2077686199' }, streams: [{ codec_type: 'audio' }, { codec_type: 'video', width: 1920, height: 1080, r_frame_rate: '60000/1001' }] };
  const m = parseProbe(j);
  assert.equal(m.width, 1920); assert.equal(m.hasAudio, true); assert.equal(m.duration, 2694.35);
  assert.ok(Math.abs(m.fps - 59.94) < 0.01);
  assert.throws(() => parseProbe({ format: {}, streams: [{ codec_type: 'audio' }] }), /No video stream/);
});

test('graphics-card encoder arguments', () => {
  assert.deepEqual(gpuArgsFor('h264_qsv', 20).slice(0, 2), ['-c:v', 'h264_qsv']);
  assert.ok(gpuArgsFor('h264_nvenc', 20).includes('23'));
  assert.equal(gpuArgsFor(null, 20), null);
});

test('adapter: runs the configured program, probes through ffprobe, finds a hardware encoder', async () => {
  const calls = [];
  const runner = {
    runProc: async (job, cmd, args) => { calls.push(['proc', cmd, args[0]]); },
    runCapture: async (cmd, args) => {
      calls.push(['capture', cmd, args.includes('h264_nvenc') ? 'nvenc' : args[0]]);
      if (cmd === 'fake-ffprobe') return JSON.stringify({ format: { duration: '10', size: '1' }, streams: [{ codec_type: 'video', width: 640, height: 360, r_frame_rate: '30/1' }] });
      if (args.includes('h264_nvenc')) return '';
      throw new Error('encoder not available');
    },
  };
  const ff = createFfmpeg({ ffmpegPath: 'fake-ffmpeg', ffprobePath: 'fake-ffprobe', runner });
  await ff.run({}, ['-i', 'x']);
  assert.deepEqual(calls[0], ['proc', 'fake-ffmpeg', '-i']);
  assert.equal((await ff.probe('x.mp4')).width, 640);
  await ff.detectHardware();
  assert.equal(ff.hardwareName, 'NVIDIA NVENC');
  assert.equal(ff.gpuArgs(20)[1], 'h264_nvenc');
});
