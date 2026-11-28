'use strict';
// Rough resource estimates for a render, so the app can warn before a job is likely to run out of
// memory and say how long it may take. Pure functions; the numbers are approximations measured on
// typical renders (1080x1920 H.264), not guarantees.
const { PROFILES } = require('./profiles');

// meta: source video facts; duration: seconds of the short; style: render style; opts.draft;
// opts.cores: logical processors; opts.layers: picture layers (video layers + images).
function estimateRender({ meta, duration, style = {}, draft = false, cores = 4, layers = 2, gpu = false }) {
  const prof = PROFILES[style.renderProfile] || PROFILES.balanced;
  const srcMP = (Number(meta.width) || 1920) * (Number(meta.height) || 1080) / 1e6;   // megapixels per source frame
  const outMP = draft ? 0.52 : 2.07;                                                   // 540x960 or 1080x1920
  // decoder + filter frames (source and every layer at output size) + encoder lookahead + libass
  let memoryMB = 180 + srcMP * 60 + outMP * (layers + 1) * 45 + (draft ? 60 : 420 * prof.memory) + (style.background !== 'dark' ? 40 : 0);
  if (gpu) memoryMB -= 150;
  // encoding speed in "seconds of video per second", from typical CPU renders, scaled by cores
  const base = draft ? 6 : 0.9 * prof.speed;
  const speed = Math.max(0.05, base * Math.min(16, Math.max(1, cores)) / 8 * (srcMP > 4 ? 0.6 : 1) * (gpu ? 2.5 : 1));
  return { memoryMB: Math.round(memoryMB), seconds: Math.round(duration / speed) };
}

// Plain-language warning when free memory is below the estimate (with a margin), else null.
function memoryWarning(estimate, freeMB) {
  if (!(freeMB > 0) || freeMB >= estimate.memoryMB * 1.2) return null;
  return `This render may need about ${estimate.memoryMB} MB of memory and only ${Math.round(freeMB)} MB is free. Close other programs if it fails.`;
}

module.exports = { estimateRender, memoryWarning };
