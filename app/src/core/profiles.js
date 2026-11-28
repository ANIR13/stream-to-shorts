'use strict';
// Render profiles: quality versus speed, as encoder settings. Pure functions.
//
//   fast      quick exports and slow computers: faster preset, a little lower quality
//   balanced  the default (exactly the settings used before profiles existed)
//   quality   best picture for the size: slower preset, higher quality
//   small     smaller files (messaging apps, slow uploads): lower video and audio bitrate
//
// The profile is how a short is encoded, not what it shows: changing it doesn't mark shorts as
// outdated (like the CPU / graphics card choice).
const PROFILES = {
  fast: { label: 'Fast', preset: 'veryfast', crfDelta: 3, audio: '128k', speed: 2.2, memory: 0.8 },
  balanced: { label: 'Balanced', preset: 'medium', crfDelta: 0, audio: '160k', speed: 1, memory: 1 },
  quality: { label: 'High quality', preset: 'slow', crfDelta: -2, audio: '192k', speed: 0.55, memory: 1.25 },
  small: { label: 'Small file', preset: 'medium', crfDelta: 5, audio: '96k', speed: 1.05, memory: 1 },
};
const profileOf = style => PROFILES[style && style.renderProfile] ? style.renderProfile : 'balanced';

// libx264 arguments for a final render (drafts are always ultrafast and small).
function cpuArgs(profileName, crf, draft) {
  if (draft) return ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '30', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k'];
  const p = PROFILES[profileName] || PROFILES.balanced;
  return ['-c:v', 'libx264', '-preset', p.preset, '-crf', String(crf + p.crfDelta), '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', p.audio];
}
// Quality value for a graphics-card encoder with this profile (same scale as crf).
const gpuQuality = (profileName, crf) => crf + (PROFILES[profileName] || PROFILES.balanced).crfDelta;
const audioArgs = profileName => ['-c:a', 'aac', '-b:a', (PROFILES[profileName] || PROFILES.balanced).audio];

module.exports = { PROFILES, profileOf, cpuArgs, gpuQuality, audioArgs };
