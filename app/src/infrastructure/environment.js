'use strict';
// Folders, bundled tools and the environment the tools run with.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { IS_WIN, onPath } = require('./process');

// lookup(name): the program's path on the system PATH, or null (injectable for tests).
function createEnvironment(root, { lookup = onPath } = {}) {
  const TOOLS_DIR = path.join(root, 'tools');
  const paths = {
    ROOT: root,
    SOURCE_DIR: path.join(root, 'source'),
    OUTPUT_DIR: path.join(root, 'output'),
    PROJECTS_DIR: path.join(root, 'projects'),
    TOOLS_DIR,
    PUBLIC_DIR: path.join(root, 'app', 'public'),
    MODELS_DIR: path.join(TOOLS_DIR, 'whisper', 'models'),
    FONTCONF: path.join(TOOLS_DIR, 'fonts.conf'),
  };
  // A tool bundled in tools/ (Windows: .exe), else the system one.
  const tool = (rel, systemName) => {
    const p = path.join(TOOLS_DIR, IS_WIN ? rel + '.exe' : rel);
    if (fs.existsSync(p)) return p;
    return systemName ? lookup(systemName) : null;
  };
  const tools = {
    FFMPEG: tool('ffmpeg/ffmpeg', 'ffmpeg') || 'ffmpeg',
    FFPROBE: tool('ffmpeg/ffprobe', 'ffprobe') || 'ffprobe',
    WHISPER: tool('whisper/whisper-cli', 'whisper-cli'),
  };
  const found = { ffmpeg: tool('ffmpeg/ffmpeg', 'ffmpeg'), ffprobe: tool('ffmpeg/ffprobe', 'ffprobe') };

  // Plain-language problems with the installed tools (shown in the console at startup).
  function missingTools() {
    const setup = IS_WIN ? 'setup.bat' : './setup.sh';
    const out = [];
    if (!found.ffmpeg || !found.ffprobe) out.push(`FFmpeg was not found (tools/ffmpeg or the system PATH). Videos can't be opened or rendered until you run ${setup}.`);
    if (!tools.WHISPER) out.push(`Speech recognition (whisper-cli) was not found. Captions are unavailable until you run ${setup}; everything else works.`);
    else if (!fs.existsSync(paths.MODELS_DIR) || !fs.readdirSync(paths.MODELS_DIR).some(n => n.endsWith('.bin'))) out.push(`No speech model in tools/whisper/models. Captions are unavailable until you run ${setup}.`);
    return out;
  }
  const cpus = os.cpus().length;
  const THREADS = Math.max(2, Math.min(12, cpus - 2));
  // Windows needs its own fontconfig file so libass finds C:\Windows\Fonts; Linux uses the system one.
  // On Linux, whisper.cpp uses OpenMP: passive waiting and at most half the cores keep it from stalling when
  // other programs (or the app itself) need the CPU (12 threads took 96 s vs 38 s with 8 in tests on Kali).
  const env = IS_WIN ? { ...process.env, FONTCONFIG_FILE: paths.FONTCONF, FONTCONFIG_PATH: TOOLS_DIR } : { ...process.env, OMP_WAIT_POLICY: 'PASSIVE' };
  const WHISPER_THREADS = IS_WIN ? THREADS : Math.max(2, Math.min(8, Math.floor(cpus / 2)));

  // Create the working folders and, on Windows, the fontconfig file. Called once at startup.
  function prepare() {
    for (const d of [paths.SOURCE_DIR, paths.OUTPUT_DIR, paths.PROJECTS_DIR, TOOLS_DIR]) fs.mkdirSync(d, { recursive: true });
    if (IS_WIN) fs.writeFileSync(paths.FONTCONF, `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <dir>${(process.env.WINDIR || 'C:/Windows').replace(/\\/g, '/')}/Fonts</dir>
  <cachedir>${path.join(paths.PROJECTS_DIR, '.fontcache').replace(/\\/g, '/')}</cachedir>
</fontconfig>
`);
  }

  return { IS_WIN, paths, tools, env, THREADS, WHISPER_THREADS, prepare, missingTools };
}

module.exports = { createEnvironment };
