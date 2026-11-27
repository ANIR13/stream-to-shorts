'use strict';
// Shared test helpers: temporary app folders, a fake ffmpeg, and the real tools when installed.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const app = rel => path.join(ROOT, 'app', rel);
const quiet = { log() {}, error() {} };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// A fresh app folder (source/, projects/, output/) in the system temp folder.
function tmpApp(prefix = 's2s-') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const dirs = { root, sourceDir: path.join(root, 'source'), projectsDir: path.join(root, 'projects'), outputDir: path.join(root, 'output') };
  for (const d of [dirs.sourceDir, dirs.projectsDir, dirs.outputDir]) fs.mkdirSync(d);
  return dirs;
}

// Fake ffmpeg: records calls and writes the output file (last argument) like the real one would.
// fail(args) may return an Error to simulate a crash after part of the file was written.
function fakeFfmpeg({ fail } = {}) {
  const calls = [];
  return {
    calls,
    filterArg: '-/filter_complex',
    run: async (job, args, opts) => {
      calls.push({ args, opts });
      const out = args[args.length - 1];
      const file = path.isAbsolute(out) ? out : path.join(opts.cwd, out);
      if (/\.mp4$/.test(out)) fs.writeFileSync(file, fail ? 'half a vid' : 'video');
      const err = fail && fail(args, job);
      if (err) throw err;
    },
    detectHardware: async () => {}, gpuArgs: () => null,
  };
}

// The real ffmpeg (tools/ffmpeg or the system PATH), or null when it isn't installed:
// tests that need it are skipped instead of failing.
let realCache;
function realTools() {
  if (realCache !== undefined) return realCache;
  realCache = null;
  try {
    const { createEnvironment } = require(app('src/infrastructure/environment'));
    const { createProcessRunner } = require(app('src/infrastructure/process'));
    const { createFfmpeg } = require(app('src/infrastructure/ffmpeg'));
    const env = createEnvironment(ROOT);
    // S2S_FFMPEG_DIR: test with another ffmpeg build (a folder containing ffmpeg and ffprobe).
    if (process.env.S2S_FFMPEG_DIR) {
      const ext = env.IS_WIN ? '.exe' : '';
      env.tools.FFMPEG = path.join(process.env.S2S_FFMPEG_DIR, 'ffmpeg' + ext);
      env.tools.FFPROBE = path.join(process.env.S2S_FFMPEG_DIR, 'ffprobe' + ext);
    }
    execFileSync(env.tools.FFMPEG, ['-version'], { stdio: 'ignore' });
    execFileSync(env.tools.FFPROBE, ['-version'], { stdio: 'ignore' });
    if (env.IS_WIN) env.prepare(); // fontconfig file so subtitles find the Windows fonts
    const runner = createProcessRunner({ env: env.env });
    realCache = { env, runner, ffmpeg: createFfmpeg({ ffmpegPath: env.tools.FFMPEG, ffprobePath: env.tools.FFPROBE, runner }) };
  } catch { realCache = null; }
  return realCache;
}
const NO_FFMPEG = 'ffmpeg is not installed (run setup, or put ffmpeg on the PATH)';

// ffprobe facts of a file (streams + format), with the real tools.
async function probeJSON(tools, file) {
  return JSON.parse(await tools.runner.runCapture(tools.env.tools.FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]));
}

// Times (s) where sound starts again after silence, measured with ffmpeg's silencedetect.
async function soundOnsets(tools, file) {
  const { spawnSync } = require('child_process');
  const r = spawnSync(tools.env.tools.FFMPEG, ['-hide_banner', '-nostats', '-i', file, '-af', 'silencedetect=noise=-40dB:d=0.5', '-f', 'null', '-'], { env: tools.env.env, encoding: 'utf8' });
  return [...String(r.stderr).matchAll(/silence_end: ([\d.]+)/g)].map(m => Number(m[1]));
}

module.exports = { ROOT, app, quiet, sleep, tmpApp, fakeFfmpeg, realTools, NO_FFMPEG, probeJSON, soundOnsets };
