'use strict';
// Unit: render profiles and resource estimates.
const test = require('node:test');
const assert = require('node:assert/strict');
const { PROFILES, profileOf, cpuArgs, gpuQuality, audioArgs } = require('../../app/src/core/profiles');
const { estimateRender, memoryWarning } = require('../../app/src/core/resources');
const { cpuEncoderArgs } = require('../../app/src/core/render');
const { gpuArgsFor } = require('../../app/src/infrastructure/ffmpeg');

test('profiles: balanced is exactly the earlier encoder settings; the others trade speed and size', () => {
  assert.deepEqual(cpuArgs('balanced', 20, false), ['-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k']);
  assert.deepEqual(cpuEncoderArgs(false, 20), cpuArgs('balanced', 20, false));
  assert.deepEqual(cpuArgs('quality', 20, true), cpuArgs('balanced', 20, true), 'drafts are always quick');
  const crfOf = a => Number(a[a.indexOf('-crf') + 1]);
  assert.ok(crfOf(cpuArgs('quality', 20)) < 20 && crfOf(cpuArgs('fast', 20)) > 20 && crfOf(cpuArgs('small', 20)) > crfOf(cpuArgs('fast', 20)));
  assert.equal(cpuArgs('fast', 20)[cpuArgs('fast', 20).indexOf('-preset') + 1], 'veryfast');
  assert.equal(cpuArgs('quality', 20)[cpuArgs('quality', 20).indexOf('-preset') + 1], 'slow');
  assert.deepEqual(audioArgs('small'), ['-c:a', 'aac', '-b:a', '96k']);
  assert.equal(gpuQuality('quality', 20), 18);
  assert.equal(profileOf({}), 'balanced');
  assert.equal(profileOf({ renderProfile: 'nonsense' }), 'balanced');
  assert.equal(profileOf({ renderProfile: 'small' }), 'small');
  assert.deepEqual(Object.keys(PROFILES), ['fast', 'balanced', 'quality', 'small']);
  assert.deepEqual(gpuArgsFor('h264_videotoolbox', 20).slice(0, 4), ['-c:v', 'h264_videotoolbox', '-q:v', '60']);
});

test('estimates: more pixels, layers and quality need more memory; more cores go faster', () => {
  const meta = { width: 1920, height: 1080 };
  const base = estimateRender({ meta, duration: 30, cores: 8 });
  assert.ok(base.memoryMB > 300 && base.memoryMB < 2000, JSON.stringify(base));
  assert.ok(estimateRender({ meta: { width: 3840, height: 2160 }, duration: 30, cores: 8 }).memoryMB > base.memoryMB);
  assert.ok(estimateRender({ meta, duration: 30, cores: 8, style: { renderProfile: 'quality' } }).memoryMB > base.memoryMB);
  assert.ok(estimateRender({ meta, duration: 30, cores: 8, draft: true }).memoryMB < base.memoryMB);
  assert.ok(estimateRender({ meta, duration: 30, cores: 16 }).seconds < estimateRender({ meta, duration: 30, cores: 2 }).seconds);
  assert.ok(estimateRender({ meta, duration: 60, cores: 8 }).seconds > base.seconds);
  assert.equal(memoryWarning({ memoryMB: 800 }, 4000), null);
  assert.match(memoryWarning({ memoryMB: 800 }, 500), /about 800 MB.*only 500 MB is free/);
  assert.equal(memoryWarning({ memoryMB: 800 }, NaN), null);
});
