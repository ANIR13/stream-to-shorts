'use strict';
// Stream → Shorts: local-only server (no login, binds to 127.0.0.1).
const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const Layout = require('./public/layout.js');

const PORT = Number(process.env.PORT) || 5199;
const HOST = '127.0.0.1';
const ROOT = path.resolve(__dirname, '..');
const SOURCE_DIR = path.join(ROOT, 'source');
const OUTPUT_DIR = path.join(ROOT, 'output');
const PROJECTS_DIR = path.join(ROOT, 'projects');
const TOOLS_DIR = path.join(ROOT, 'tools');
const PUBLIC_DIR = path.join(__dirname, 'public');
const VIDEO_EXT = new Set(['.mkv', '.mp4', '.mov', '.webm', '.flv', '.avi', '.ts', '.m4v']);

const IS_WIN = process.platform === 'win32';
const { execFileSync } = require('child_process');
// Program on the system PATH (Linux/macOS), or null.
function onPath(name) {
  try { return execFileSync(IS_WIN ? 'where' : 'which', [name], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().split(/\r?\n/)[0].trim() || null; } catch { return null; }
}
// A tool bundled in tools/ (Windows: .exe), else the system one.
function tool(rel, systemName) {
  const p = path.join(TOOLS_DIR, IS_WIN ? rel + '.exe' : rel);
  if (fs.existsSync(p)) return p;
  return systemName ? onPath(systemName) : null;
}
const FFMPEG = tool('ffmpeg/ffmpeg', 'ffmpeg') || 'ffmpeg';
const FFPROBE = tool('ffmpeg/ffprobe', 'ffprobe') || 'ffprobe';
const WHISPER = tool('whisper/whisper-cli', 'whisper-cli');
const MODELS_DIR = path.join(TOOLS_DIR, 'whisper', 'models');
const FONTCONF = path.join(TOOLS_DIR, 'fonts.conf');
const THREADS = Math.max(2, Math.min(12, os.cpus().length - 2));
// Windows needs its own fontconfig file so libass finds C:\Windows\Fonts; Linux uses the system one.
// On Linux, whisper.cpp uses OpenMP: passive waiting and at most half the cores keep it from stalling when
// other programs (or the app itself) need the CPU (12 threads took 96 s vs 38 s with 8 in tests on Kali).
const toolEnv = IS_WIN ? { ...process.env, FONTCONFIG_FILE: FONTCONF, FONTCONFIG_PATH: TOOLS_DIR } : { ...process.env, OMP_WAIT_POLICY: 'PASSIVE' };
const WHISPER_THREADS = IS_WIN ? THREADS : Math.max(2, Math.min(8, Math.floor(os.cpus().length / 2)));

for (const d of [SOURCE_DIR, OUTPUT_DIR, PROJECTS_DIR]) fs.mkdirSync(d, { recursive: true });
if (IS_WIN) fs.writeFileSync(FONTCONF, `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <dir>${(process.env.WINDIR || 'C:/Windows').replace(/\\/g, '/')}/Fonts</dir>
  <cachedir>${path.join(PROJECTS_DIR, '.fontcache').replace(/\\/g, '/')}</cachedir>
</fontconfig>
`);
// ffmpeg 7+ reads the render filter with "-/filter_complex file"; older versions need -filter_complex_script.
const FFMPEG_MAJOR = (() => { try { return Number((execFileSync(FFMPEG, ['-version']).toString().match(/ffmpeg version n?(\d+)/) || [])[1]) || 7; } catch { return 7; } })();
const FILTER_ARG = FFMPEG_MAJOR >= 7 ? '-/filter_complex' : '-filter_complex_script';
// Open a folder or web page with the desktop's default program.
function openWith(target) {
  const [cmd, args] = IS_WIN ? (/^https?:/.test(target) ? ['cmd', ['/c', 'start', '', target]] : ['explorer.exe', [target]])
    : process.platform === 'darwin' ? ['open', [target]] : ['xdg-open', [target]];
  try { const c = spawn(cmd, args, { detached: true, stdio: 'ignore' }); c.on('error', () => console.log('  Open this yourself: ' + target)); c.unref(); }
  catch { console.log('  Open this yourself: ' + target); }
}

// ---------- helpers ----------
const slugify = s => String(s).replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'video';
const projDir = slug => path.join(PROJECTS_DIR, slugify(slug));
const projFile = slug => path.join(projDir(slug), 'project.json');
const exists = p => fs.promises.access(p).then(() => true, () => false);
const round1 = v => Math.round(v * 10) / 10;

async function readJSON(p, def) { try { return JSON.parse(await fsp.readFile(p, 'utf8')); } catch { return def; } }
async function writeJSON(p, obj) {
  await fsp.mkdir(path.dirname(p), { recursive: true });
  const tmp = p + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(obj, null, 2));
  await fsp.rename(tmp, p);
}
function deepDefaults(target, defs) {
  for (const [k, v] of Object.entries(defs)) {
    if (target[k] === undefined) target[k] = v;
    else if (v && typeof v === 'object' && !Array.isArray(v) && typeof target[k] === 'object') deepDefaults(target[k], v);
  }
  return target;
}

function runCapture(cmd, args, env) {
  return new Promise((resolve, reject) => {
    const c = spawn(cmd, args, { env: env ? { ...toolEnv, ...env } : toolEnv, windowsHide: true });
    let out = '', err = '';
    c.stdout.on('data', d => out += d);
    c.stderr.on('data', d => err += d);
    c.on('error', reject);
    c.on('close', code => code === 0 ? resolve(out) : reject(new Error(err.trim().slice(-800) || `exit ${code}`)));
  });
}

// Runs a tool, reporting ffmpeg "-progress pipe:1" progress into the job.
function runProc(job, cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, env: toolEnv, windowsHide: true });
    if (job) job.child = child;
    let errTail = '';
    const base = opts.base || 0, span = opts.span == null ? 1 : opts.span;
    child.stdout.on('data', d => {
      if (!job || !opts.duration) return;
      const m = String(d).match(/out_time_us=(\d+)/g);
      if (m) {
        const us = Number(m[m.length - 1].split('=')[1]);
        job.progress = base + span * Math.min(1, us / 1e6 / opts.duration);
      }
    });
    child.stderr.on('data', d => {
      const s = String(d);
      errTail = (errTail + s).slice(-4000);
      if (opts.onStderr) opts.onStderr(s);
    });
    child.on('error', e => reject(new Error(`Cannot start ${path.basename(cmd)}: ${e.message}`)));
    child.on('close', code => {
      if (job) job.child = null;
      if (job && job.cancelled) return reject(new Error('Cancelled'));
      if (code === 0) return resolve();
      const tail = errTail.trim().split(/\r?\n/).slice(-6).join('\n');
      reject(new Error(`${path.basename(cmd)} failed (code ${code})\n${tail}`));
    });
  });
}

async function probe(src) {
  const j = JSON.parse(await runCapture(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', src]));
  const v = j.streams.find(s => s.codec_type === 'video');
  if (!v) throw new Error('No video stream found');
  const a = j.streams.find(s => s.codec_type === 'audio');
  const [n, d] = String(v.r_frame_rate || '30/1').split('/').map(Number);
  return { duration: Number(j.format.duration), width: v.width, height: v.height, fps: d ? n / d : 30, hasAudio: !!a, size: Number(j.format.size) };
}

// ---------- projects ----------
const STYLE_DEFAULTS = {
  titleFont: 'Impact', titleSize: 86, titleColor1: '#FFFFFF', titleColor2: '#FFD400',
  accent: '#FFD400', captions: true, captionFont: 'Impact', captionSize: 84,
  captionColor: '#FFFFFF', captionHighlight: '#FFD400', highlightMode: 'word',
  wordsPerChunk: 3, uppercase: true, captionAuto: true, captionPos: 62,
  background: 'blur', camBorder: true, camBoost: true, progressBar: true,
  fps: 30, crf: 20, loudnorm: true,
};

function defaultProject(file, meta, slug) {
  const cw = Math.round(meta.width * 0.27), ch = Math.round(cw * 0.75);
  return {
    version: 1, video: file, slug, meta, analyzed: false,
    layout: {
      mode: 'gameplay', camOnTop: true,
      cam: { x: meta.width - cw, y: meta.height - ch, w: cw, h: ch },
      game: { x: 0, y: 0, w: meta.width, h: meta.height },
    },
    style: { ...STYLE_DEFAULTS },
    whisper: whisperDefaults(),
    publish: { hashtags: '#shorts' },
    detect: { ...DETECT_DEFAULTS },
    clips: [],
  };
}

// prompt: hint words for Whisper; fixes: [{from, to}] word corrections applied to every transcription.
function whisperDefaults() { return { model: 'ggml-small.bin', language: 'auto', translate: false, prompt: '', fixes: [] }; }

const locks = new Map();
function withLock(slug, fn) {
  const prev = locks.get(slug) || Promise.resolve();
  const p = prev.then(fn, fn);
  locks.set(slug, p.catch(() => {}));
  return p;
}

async function loadProject(slug) {
  const p = await readJSON(projFile(slug), null);
  if (!p) throw httpError(404, 'Project not found');
  deepDefaults(p, { style: STYLE_DEFAULTS, whisper: whisperDefaults(), publish: { hashtags: '#shorts' }, setup: {}, detect: { ...DETECT_DEFAULTS }, clips: [] });
  p.hasProxy = await exists(path.join(projDir(slug), 'proxy.mp4'));
  return p;
}
// Every video file gets its own project folder. Different files whose names clean up to the same
// folder name (e.g. "stream.mkv" and "stream.mp4") get a numbered folder, so they never share
// clips, captions, word fixes or output.
async function slugFor(file) {
  const base = slugify(file);
  for (let i = 1; ; i++) {
    const slug = i === 1 ? base : `${base}_${i}`;
    const p = await readJSON(projFile(slug), null);
    if (!p || p.video === file) return slug;
  }
}
async function openProject(file) {
  const slug = await slugFor(file);
  if (await exists(projFile(slug))) {
    const p = await loadProject(slug);
    return p.clips.some(c => !c.num) ? updateProject(slug, () => {}) : p;
  }
  const src = path.join(SOURCE_DIR, file);
  if (!(await exists(src))) throw httpError(404, 'Video not found in source folder');
  const meta = await probe(src);
  await writeJSON(projFile(slug), defaultProject(file, meta, slug));
  return loadProject(slug);
}
function updateProject(slug, mutate) {
  return withLock(slug, async () => {
    const p = await loadProject(slug);
    await mutate(p);
    ensureNums(p);
    p.updated = Date.now();
    delete p.hasProxy;
    await writeJSON(projFile(slug), p);
    return loadProject(slug);
  });
}
const SERVER_FIELDS = ['output', 'renderedAt', 'renderSig'];
// Every clip gets a permanent number (used in file names and labels) so names don't shift
// when clips are added, removed or moved.
function ensureNums(p) {
  let max = p.clips.reduce((m, c) => Math.max(m, Number(c.num) || 0), 0);
  const seen = new Set();
  for (const c of p.clips) {
    if (!c.num || seen.has(c.num)) c.num = ++max;
    seen.add(c.num);
  }
}
const clipName = c => `#${c.num || '?'}${[c.title1, c.title2].filter(Boolean).length ? ' ' + [c.title1, c.title2].filter(Boolean).join(' ') : ''}`;
// rev counts saves made from the browser. A save based on an older rev means another tab or
// window saved in between; it is refused (409) unless the user chose to overwrite (force).
function saveFromClient(slug, incoming, force) {
  return updateProject(slug, p => {
    if (!force && (Number(incoming.rev) || 0) !== (Number(p.rev) || 0)) {
      throw httpError(409, 'This project was changed in another tab or window.');
    }
    p.rev = (Number(p.rev) || 0) + 1;
    const old = new Map(p.clips.map(c => [c.id, c]));
    for (const k of ['layout', 'style', 'whisper', 'detect', 'publish', 'setup']) if (incoming[k]) p[k] = incoming[k];
    if (Array.isArray(incoming.clips)) {
      p.clips = incoming.clips.map(c => {
        const o = old.get(c.id);
        if (o) for (const f of SERVER_FIELDS) c[f] = o[f];
        if (o && o.num) c.num = o.num;
        // The server regenerated captions after the browser loaded them: keep the newer server copy
        // instead of letting a stale autosave wipe them.
        if (o && (o.captionsVer || 0) > (c.captionsVer || 0)) {
          c.captions = o.captions; c.captionsRange = o.captionsRange; c.captionsVer = o.captionsVer;
        }
        return c;
      });
    }
  });
}

// ---------- graphics-card encoder ----------
// The first H.264 hardware encoder that works on this PC (Intel Quick Sync, NVIDIA, AMD), or null.
let HW_ENC = null;
const hwReady = (async () => {
  for (const e of ['h264_qsv', 'h264_nvenc', 'h264_amf']) {
    try { await runCapture(FFMPEG, ['-v', 'error', '-f', 'lavfi', '-i', 'color=black:s=256x256:r=30:d=0.5', '-c:v', e, '-f', 'null', '-']); HW_ENC = e; return; } catch { /* not available */ }
  }
})();
const HW_NAMES = { h264_qsv: 'Intel Quick Sync', h264_nvenc: 'NVIDIA NVENC', h264_amf: 'AMD AMF' };
function gpuArgs(crf) {
  if (HW_ENC === 'h264_qsv') return ['-c:v', 'h264_qsv', '-preset', 'medium', '-global_quality', String(crf), '-look_ahead', '0'];
  if (HW_ENC === 'h264_nvenc') return ['-c:v', 'h264_nvenc', '-preset', 'p5', '-rc', 'vbr', '-cq', String(crf + 3), '-b:v', '0', '-pix_fmt', 'yuv420p'];
  if (HW_ENC === 'h264_amf') return ['-c:v', 'h264_amf', '-quality', 'quality', '-rc', 'cqp', '-qp_i', String(crf), '-qp_p', String(crf + 2), '-pix_fmt', 'yuv420p'];
  return null;
}

// ---------- upload text (title, description, hashtags) ----------
// Titles typed in capitals for the video are turned into normal sentences for the platform title.
function sentence(t) {
  t = String(t || '').replace(/\s+/g, ' ').trim();
  if (!t || t !== t.toUpperCase() || !/[A-Z]/.test(t)) return t;
  const low = t.toLowerCase();
  return low.charAt(0).toUpperCase() + low.slice(1);
}
function uploadText(p, clip) {
  const tags = String((p.publish && p.publish.hashtags) || '').trim();
  const title = sentence([clip.title1, clip.title2].filter(Boolean).join(' ')) || `Clip ${clip.num || ''}`.trim();
  let desc = String(clip.description || '').trim();
  if (!desc && Array.isArray(clip.captions) && clip.captions.length) {
    // a short quote of what was said
    let q = clip.captions.flatMap(ch => (ch.words || []).map(w => w.w)).join(' ').replace(/\s+/g, ' ').trim();
    if (q.length > 160) q = q.slice(0, q.lastIndexOf(' ', 160)) + '…';
    desc = q ? `"${q}"` : '';
  }
  return { title: title.slice(0, 100), description: [title, desc, tags].filter(Boolean).join('\n\n'), hashtags: tags };
}
const txtName = mp4 => mp4.replace(/\.mp4$/i, '.txt');
async function writeUploadText(p, clip, outDir) {
  if (!clip.output) return false;
  const u = uploadText(p, clip);
  await fsp.writeFile(path.join(outDir, txtName(clip.output)), `TITLE\r\n${u.title}\r\n\r\nDESCRIPTION\r\n${u.description.replace(/\n/g, '\r\n')}\r\n`, 'utf8');
  return true;
}

// ---------- jobs ----------
const jobs = [];
const queue = [];
let running = null, jobSeq = 0;
const STARTED_AT = Date.now();

// Tasks are described by a spec so they can be saved and resumed after the app window was closed.
const QUEUE_FILE = path.join(PROJECTS_DIR, '.queue.json');
function specFn(spec) {
  switch (spec.type) {
    case 'render': return j => renderJob(j, spec.slug, spec.clipId);
    case 'draft': return j => renderJob(j, spec.slug, spec.clipId, { from: spec.from });
    case 'captions': return j => captionsJob(j, spec.slug, spec.clipId);
    case 'transcribe': return j => fullTranscriptJob(j, spec.slug);
    case 'analyze': return j => analyzeJob(j, spec.slug);
    case 'proxy': return j => proxyJob(j, spec.slug);
    default: throw new Error('Unknown task type ' + spec.type);
  }
}
const queueSpec = (spec, label) => addJob(spec.type, label, spec.slug, specFn(spec), { clipId: spec.clipId, spec });
// Tasks that were still waiting or running when the app last closed (offered for resume in the UI).
let interrupted = (() => { try { return JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8')).filter(x => x && x.type && x.slug); } catch { return []; } })();
function persistQueue() {
  const list = interrupted.concat(jobs.filter(j => isActive(j) && !j.cancelled && j.spec && j.type !== 'draft').map(j => ({ ...j.spec, label: j.label })));
  fs.writeFile(QUEUE_FILE, JSON.stringify(list), () => {});
}
// Plain-language explanation of common failures (the technical message stays available as details).
function friendlyError(msg) {
  const m = String(msg || '');
  if (/^Cancelled$/.test(m)) return 'Cancelled.';
  if (/ENOSPC|No space left/i.test(m)) return 'The disk is full. Free some space, then retry.';
  if (/EBUSY|EPERM|EACCES|Permission denied|being used by another process/i.test(m)) return 'A file is locked, probably open in a video player or in Explorer\'s preview. Close it, then retry.';
  if (/Speech model not found|whisper-cli(\.exe)? not found|whisper is missing/i.test(m)) return 'Speech recognition is not installed correctly. See the Captions & AI tab.';
  if (/Clip was deleted|Clip not found/i.test(m)) return 'This clip was deleted before the task ran.';
  if (/too short/i.test(m)) return 'The clip is shorter than 1 second. Make it longer.';
  if (/Video not found|No such file or directory|ENOENT/i.test(m)) return 'A file is missing. Check that the video is still in the source folder.';
  if (/Invalid data found|moov atom not found/i.test(m)) return 'The video file looks damaged, or it is still being copied.';
  if (/Cannot start/i.test(m)) return 'A tool in the tools folder could not start. It may be missing or blocked by antivirus.';
  if (/Project not found/i.test(m)) return 'This video\'s project was removed. Open the video again.';
  return 'Something went wrong. See the details below.';
}

function addJob(type, label, slug, fn, extra = {}) {
  const job = { id: ++jobSeq, type, label, slug, status: 'queued', progress: 0, message: 'Waiting…', error: null, created: Date.now(), ...extra, fn };
  jobs.push(job);
  queue.push({ job, fn });
  while (jobs.length > 60) {
    const i = jobs.findIndex(j => ['done', 'error', 'cancelled'].includes(j.status));
    if (i < 0) break;
    jobs.splice(i, 1);
  }
  pump();
  persistQueue();
  return job;
}
async function pump() {
  if (running || !queue.length) return;
  const { job, fn } = queue.shift();
  if (job.cancelled) { job.status = 'cancelled'; return pump(); }
  running = job;
  job.status = 'running';
  job.started = Date.now();
  try {
    await fn(job);
    job.status = 'done'; job.progress = 1; job.message = 'Finished';
  } catch (e) {
    job.status = job.cancelled ? 'cancelled' : 'error';
    job.error = e.message;
    job.hint = friendlyError(e.message);
    console.error(`[job ${job.id}] ${e.message}`);
  }
  job.finished = Date.now();
  running = null;
  persistQueue();
  pump();
}
const publicJob = ({ child, fn, ...rest }) => rest;
const isActive = j => j.status === 'queued' || j.status === 'running';
function cancelJob(job) {
  if (!job || !isActive(job)) return;
  job.cancelled = true;
  if (job.status === 'queued') { job.status = 'cancelled'; job.finished = Date.now(); }
  if (job.child) job.child.kill();
  persistQueue();
}
// Re-queue a finished/failed/cancelled job as a fresh job; the old entry is removed from the list.
function retryJob(job) {
  if (!job || isActive(job) || !job.fn) return null;
  if (job.clipId && jobs.some(j => j !== job && j.type === job.type && j.clipId === job.clipId && j.slug === job.slug && isActive(j))) return null;
  const i = jobs.indexOf(job);
  if (i >= 0) jobs.splice(i, 1);
  return addJob(job.type, job.label, job.slug, job.fn, { ...(job.clipId ? { clipId: job.clipId } : {}), spec: job.spec });
}

// ---------- analysis ----------
function parseMeta(text, key) {
  const out = [];
  let t = 0;
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/pts_time:([\d.]+)/);
    if (m) { t = parseFloat(m[1]); continue; }
    const i = line.indexOf(key + '=');
    if (i >= 0) {
      const raw = line.slice(i + key.length + 1).trim();
      const v = raw.includes('inf') ? -90 : parseFloat(raw);
      if (Number.isFinite(v)) out.push([t, v]);
    }
  }
  return out;
}

// The preview copy played in the app: 360p (fast to build, light) or 720p (sharper player and 9:16 preview).
const proxyHeight = p => (Number(p.proxyHeight) === 720 ? 720 : 360);
const proxyEnc = h => ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', h === 720 ? '25' : '28', '-g', '60',
  '-c:a', 'aac', '-b:a', '96k', '-ac', '2', '-movflags', '+faststart'];
async function proxyJob(job, slug) {
  const p = await loadProject(slug);
  const dir = projDir(slug), h = proxyHeight(p);
  job.message = 'Building preview';
  try {
    await runProc(job, FFMPEG, ['-hide_banner', '-nostats', '-progress', 'pipe:1', '-y', '-i', path.join(SOURCE_DIR, p.video),
      '-vf', `fps=30,scale=-2:${h},format=yuv420p`, '-map', '0:v:0', '-map', '0:a?', ...proxyEnc(h), 'proxy.tmp.mp4'],
      { cwd: dir, duration: p.meta.duration });
  } catch (e) { await fsp.rm(path.join(dir, 'proxy.tmp.mp4'), { force: true }).catch(() => {}); throw e; }
  await fsp.rename(path.join(dir, 'proxy.tmp.mp4'), path.join(dir, 'proxy.mp4'));
  await updateProject(slug, q => { q.proxyVer = Date.now(); q.proxyBuiltHeight = h; });
}

async function analyzeJob(job, slug) {
  const p = await loadProject(slug);
  const dir = projDir(slug);
  const src = path.join(SOURCE_DIR, p.video);
  const dur = p.meta.duration;

  job.message = 'Measuring audio loudness';
  if (p.meta.hasAudio) {
    await runProc(job, FFMPEG, ['-hide_banner', '-nostats', '-progress', 'pipe:1', '-y', '-i', src, '-vn',
      '-af', 'aresample=8000,asetnsamples=8000,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=rms.txt',
      '-f', 'null', '-'], { cwd: dir, duration: dur, base: 0, span: 0.2 });
  }

  job.message = 'Building fast preview + scanning action';
  const ph = proxyHeight(p);
  const fc = `[0:v]fps=30,scale=-2:${ph},format=yuv420p[p];[0:v]fps=2,scale=160:-2,select='gte(scene,0)',metadata=print:key=lavfi.scene_score:file=scene.txt,nullsink`;
  await runProc(job, FFMPEG, ['-hide_banner', '-nostats', '-progress', 'pipe:1', '-y', '-i', src, '-filter_complex', fc,
    '-map', '[p]', '-map', '0:a?', ...proxyEnc(ph), 'proxy.tmp.mp4'],
    { cwd: dir, duration: dur, base: 0.2, span: 0.8 });
  await fsp.rename(path.join(dir, 'proxy.tmp.mp4'), path.join(dir, 'proxy.mp4'));

  const n = Math.ceil(dur);
  const rms = new Array(n).fill(-90), scene = new Array(n).fill(0);
  if (p.meta.hasAudio) for (const [t, v] of parseMeta(await fsp.readFile(path.join(dir, 'rms.txt'), 'utf8'), 'lavfi.astats.Overall.RMS_level')) {
    const i = Math.min(n - 1, Math.floor(t)); rms[i] = round1(v);
  }
  for (const [t, v] of parseMeta(await fsp.readFile(path.join(dir, 'scene.txt'), 'utf8'), 'lavfi.scene_score')) {
    const i = Math.min(n - 1, Math.floor(t)); scene[i] = Math.max(scene[i], Math.round(v * 1000) / 1000);
  }
  await writeJSON(path.join(dir, 'analysis.json'), { rms, scene, created: Date.now() });
  await updateProject(slug, q => {
    q.analyzed = true;
    q.proxyVer = Date.now(); q.proxyBuiltHeight = ph;
    if (!q.clips.length) q.clips = candidatesToClips(findCandidates(rms, scene, q.detect));
  });
}

const median = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] || 0; };
function movingAvg(a, w) {
  const out = new Array(a.length); let sum = 0; const h = Math.floor(w / 2);
  const pre = [0]; for (const v of a) pre.push(pre[pre.length - 1] + v);
  for (let i = 0; i < a.length; i++) {
    const lo = Math.max(0, i - h), hi = Math.min(a.length, i + h + 1);
    out[i] = (pre[hi] - pre[lo]) / (hi - lo);
  }
  return out;
}
function zscore(a) {
  const m = median(a); const mad = median(a.map(v => Math.abs(v - m))) || 1;
  return a.map(v => (v - m) / (1.4826 * mad));
}
// Auto-detect settings. The defaults reproduce the original detection exactly.
const DETECT_DEFAULTS = { count: 12, length: 55, wAudio: 1, wPeak: 0.5, wVisual: 0.3, gap: 3 };
const num = (v, lo, hi, def) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def; };
function detectSettings(d = {}) {
  const o = {
    count: Math.round(num(d.count, 1, 40, DETECT_DEFAULTS.count)),
    length: Math.round(num(d.length, 10, 60, DETECT_DEFAULTS.length)),
    wAudio: num(d.wAudio, 0, 3, DETECT_DEFAULTS.wAudio),
    wPeak: num(d.wPeak, 0, 3, DETECT_DEFAULTS.wPeak),
    wVisual: num(d.wVisual, 0, 3, DETECT_DEFAULTS.wVisual),
    gap: num(d.gap, 0, 600, DETECT_DEFAULTS.gap),
  };
  if (!o.wAudio && !o.wPeak && !o.wVisual) Object.assign(o, { wAudio: 1, wPeak: 0.5, wVisual: 0.3 }); // all off makes no sense
  return o;
}
// Three signals per second, each normalized against the whole stream (robust z-score: how far above
// a typical moment, in "typical deviations"):
//   audio  = sustained loudness over ~12 s (excitement, shouting, music)
//   peak   = the loudest instant within ±2 s (sudden spikes: a scream, an explosion)
//   visual = on-screen change over ~8 s (scene score from the analysis), capped at 3
// The moment score is their weighted sum. Picks go from the best down, skipping any clip that would
// come closer than `gap` seconds to one already picked (temporal diversity).
function findCandidates(rms, scene, opts = {}) {
  const { count, length, wAudio, wPeak, wVisual, gap } = detectSettings(opts);
  const n = rms.length;
  if (!n) return [];
  const energy = rms.map(d => Math.pow(10, d / 10));
  const loud = movingAvg(energy, 12).map(v => 10 * Math.log10(v + 1e-12));
  const peak = rms.map((_, i) => Math.max(...rms.slice(Math.max(0, i - 2), i + 3)));
  const act = movingAvg(scene, 8);
  const lz = zscore(loud), pz = zscore(peak), sz = zscore(act).map(v => Math.min(3, v));
  const score = lz.map((v, i) => wAudio * v + wPeak * pz[i] + wVisual * sz[i]);
  const L = Math.min(length, Math.max(10, n - 2));
  // exact ties (e.g. on-screen action alone, which is capped) go to the louder moment, not the earliest one
  const order = score.map((s, i) => [s, i]).sort((a, b) => b[0] - a[0] || lz[b[1]] - lz[a[1]]);
  const picked = [];
  const r2 = v => Math.round(v * 100) / 100;
  for (const [s, i] of order) {
    if (picked.length >= count) break;
    let start = Math.round(i - 0.6 * L);
    start = Math.max(0, Math.min(start, n - L - 1));
    const end = start + L;
    if (picked.some(c => start < c.end + gap && end > c.start - gap)) continue;
    picked.push({ start, end, peak: i, raw: s, parts: { audio: r2(lz[i]), peak: r2(pz[i]), visual: r2(sz[i]) } });
  }
  const max = Math.max(...picked.map(c => c.raw), 1);
  const weights = { audio: wAudio, peak: wPeak, visual: wVisual };
  return picked.map(c => ({ ...c, score: Math.round(100 * Math.max(0, c.raw) / max), weights }));
}
function candidatesToClips(cands) {
  return cands.map((c, i) => ({
    id: 'c' + Date.now().toString(36) + i, start: c.start, end: c.end, score: c.score,
    scoreParts: c.parts, scoreWeights: c.weights, scorePeak: c.peak,
    title1: '', title2: '', selected: true, captionsOn: true, captions: null,
  }));
}

// ---------- transcription ----------
const whisperKey = w => `${w.model}|${w.language}|${w.translate ? 1 : 0}` + (w.prompt ? `|${String(w.prompt).trim()}` : '');

// Word corrections ("made" → "mate", or phrases like "made in two" → "mate in two").
// Matching is whole-word and case-insensitive; punctuation around words is kept.
const wordCore = w => String(w).match(/^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/u);
function normFixes(fixes) {
  return (Array.isArray(fixes) ? fixes : [])
    .map(f => ({ from: String(f.from || '').trim().toLowerCase().split(/\s+/).filter(Boolean), to: String(f.to || '').trim().split(/\s+/).filter(Boolean) }))
    .filter(f => f.from.length && f.to.length)
    .sort((a, b) => b.from.length - a.from.length);
}
function applyFixes(words, fixes) {
  const list = normFixes(fixes);
  let count = 0;
  if (!list.length || !Array.isArray(words)) return { words, count };
  const out = [];
  for (let i = 0; i < words.length;) {
    const f = list.find(f => f.from.every((tok, k) => words[i + k] && wordCore(words[i + k].w)[2].toLowerCase() === tok));
    if (!f) { out.push(words[i]); i++; continue; }
    const seg = words.slice(i, i + f.from.length);
    const before = seg.map(w => wordCore(w.w)[2]).join(' ');
    if (before === f.to.join(' ')) { out.push(...seg); i += seg.length; continue; }
    count++;
    if (f.to.length === seg.length) {
      seg.forEach((w, k) => { const m = wordCore(w.w); out.push({ ...w, w: m[1] + f.to[k] + m[3] }); });
    } else {
      const first = wordCore(seg[0].w), last = wordCore(seg[seg.length - 1].w);
      const s = seg[0].s, e = seg[seg.length - 1].e, d = (e - s) / f.to.length;
      f.to.forEach((t, k) => out.push({
        w: (k === 0 ? first[1] : '') + t + (k === f.to.length - 1 ? last[3] : ''),
        s: Math.round((s + d * k) * 100) / 100, e: Math.round((s + d * (k + 1)) * 100) / 100,
      }));
    }
    i += seg.length;
  }
  return { words: out, count };
}
// The speech AI sometimes repeats its hint words ("Words to expect") during silence or music.
// Long runs of consecutive words that all come from the hint text are removed: at least 5 words
// using at least 4 different hint words. Real speech like "it's mate in two" is kept.
const tokens = t => String(t || '').toLowerCase().split(/[^\p{L}\p{N}']+/u).filter(Boolean);
function echoMask(words, prompt) {
  const set = new Set(tokens(prompt));
  const mask = new Array(words.length).fill(false);
  if (set.size < 4) return mask;
  for (let i = 0; i < words.length;) {
    let j = i;
    while (j < words.length) { const t = tokens(words[j].w); if (!t.length || !t.every(x => set.has(x))) break; j++; }
    const run = words.slice(i, j).flatMap(w => tokens(w.w));
    if (j - i >= 5 && new Set(run).size >= 4) for (let k = i; k < j; k++) mask[k] = true;
    i = Math.max(j, i + 1);
  }
  return mask;
}
const dropEcho = (words, prompt) => { const m = echoMask(words, prompt); return words.filter((w, i) => !m[i]); };
// Same for existing caption lines; a line left with a single stray word is removed too.
function stripEchoChunks(chunks, prompt) {
  const flat = []; (chunks || []).forEach((ch, ci) => (ch.words || []).forEach((w, wi) => flat.push({ ci, wi, w })));
  const mask = echoMask(flat.map(f => f.w), prompt);
  const drop = new Set(); let removed = 0;
  flat.forEach((f, k) => { if (mask[k]) { drop.add(f.ci + ':' + f.wi); removed++; } });
  if (!removed) return { chunks, removed };
  const out = [];
  chunks.forEach((ch, ci) => {
    const words = (ch.words || []).filter((w, wi) => !drop.has(ci + ':' + wi));
    const lost = words.length < (ch.words || []).length;
    if (words.length && !(lost && words.length <= 1)) out.push({ ...ch, s: Math.max(ch.s, words[0].s), words });
  });
  return { chunks: out, removed };
}
function fixChunks(chunks, fixes) {
  let count = 0;
  for (const ch of chunks || []) { const r = applyFixes(ch.words, fixes); ch.words = r.words; count += r.count; }
  return count;
}
const shortHash = s => crypto.createHash('md5').update(s).digest('hex').slice(0, 8);

function parseWhisper(j, offset) {
  const words = [];
  for (const seg of j.transcription || []) {
    const text = String(seg.text || '').replace(/\uFFFD/g, '').trim();
    if (!text || /^[\[(].*[\])]$/.test(text)) continue;
    const s = offset + seg.offsets.from / 1000, e = offset + seg.offsets.to / 1000;
    const parts = text.split(/\s+/).filter(Boolean);
    parts.forEach((w, k) => {
      const ws = s + (e - s) * k / parts.length, we = s + (e - s) * (k + 1) / parts.length;
      words.push({ w, s: Math.round(ws * 100) / 100, e: Math.round(we * 100) / 100 });
    });
  }
  return words;
}

async function transcribeRange(job, slug, start, end, w, base = 0, span = 1) {
  if (!WHISPER) throw new Error(IS_WIN ? 'whisper-cli.exe not found in tools/whisper' : 'whisper-cli not found (tools/whisper/whisper-cli or on the PATH)');
  const model = path.join(MODELS_DIR, w.model);
  if (!(await exists(model))) throw new Error(`Speech model not found: tools/whisper/models/${w.model}`);
  const dir = path.join(projDir(slug), 'transcripts');
  await fsp.mkdir(dir, { recursive: true });
  const key = whisperKey(w);

  const full = await readJSON(path.join(dir, 'full.json'), null);
  if (full && full.key === key && start >= full.start && end <= full.end) {
    return full.words.filter(x => x.e > start && x.s < end);
  }
  const name = `r_${Math.round(start * 10)}_${Math.round(end * 10)}_${shortHash(key)}`;
  const cached = await readJSON(path.join(dir, name + '.json'), null);
  if (cached) return cached.words;

  const p = await loadProject(slug);
  const src = path.join(SOURCE_DIR, p.video);
  job.message = 'Extracting audio';
  await runProc(job, FFMPEG, ['-hide_banner', '-nostats', '-progress', 'pipe:1', '-y', '-ss', String(start), '-t', String(end - start),
    '-i', src, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', name + '.wav'],
    { cwd: dir, duration: end - start, base, span: span * 0.1 });
  job.message = 'Transcribing speech (AI)';
  const args = ['-m', model, '-f', name + '.wav', '-l', w.language || 'auto', '-t', String(WHISPER_THREADS),
    '-ml', '1', '-sow', '-oj', '-of', name + '.w', '-pp'];
  if (w.translate) args.push('-tr');
  if (w.prompt && String(w.prompt).trim()) args.push('--prompt', String(w.prompt).trim());
  await runProc(job, WHISPER, args, {
    cwd: dir,
    onStderr: s => {
      const m = [...s.matchAll(/progress\s*=\s*(\d+)%/g)].pop();
      if (m) job.progress = base + span * (0.1 + 0.9 * Number(m[1]) / 100);
    },
  });
  const raw = await fsp.readFile(path.join(dir, name + '.w.json'));
  const j = JSON.parse(raw.toString('utf8'));
  const words = parseWhisper(j, start);
  await writeJSON(path.join(dir, name + '.json'), { key, start, end, language: j.result && j.result.language, words });
  await fsp.unlink(path.join(dir, name + '.wav')).catch(() => {});
  await fsp.unlink(path.join(dir, name + '.w.json')).catch(() => {});
  return words;
}

function chunkWords(words, maxWords) {
  const chunks = [];
  let cur = [];
  const flush = () => { if (cur.length) { chunks.push({ s: cur[0].s, e: cur[cur.length - 1].e, words: cur }); cur = []; } };
  for (const w of words) {
    const last = cur[cur.length - 1];
    if (last && (cur.length >= maxWords || w.s - last.e > 0.7 || /[.!?…,]$/.test(last.w))) flush();
    cur.push(w);
  }
  flush();
  for (let i = 0; i < chunks.length; i++) {
    const next = chunks[i + 1];
    if (next && next.s - chunks[i].e < 0.35) chunks[i].e = next.s;
    if (chunks[i].e - chunks[i].s < 0.3) chunks[i].e = chunks[i].s + 0.3;
  }
  return chunks;
}

// Keep the caption lines (and the user's corrections) that are still inside [start, end];
// cut words that fall outside it.
function keepChunks(chunks, start, end) {
  const out = [];
  for (const ch of chunks || []) {
    const words = (ch.words || []).filter(w => (w.s + w.e) / 2 >= start && (w.s + w.e) / 2 <= end);
    if (!words.length) continue;
    out.push({ ...ch, s: Math.max(ch.s, start), e: Math.min(ch.e, end), words });
  }
  return out;
}

// merge = true: after a retrim, keep existing (possibly hand-edited) captions and only
// transcribe the seconds that were added. merge = false: transcribe everything again.
async function captionsJob(job, slug, clipId, base = 0, span = 1, { merge = false } = {}) {
  const p = await loadProject(slug);
  const clip = p.clips.find(c => c.id === clipId);
  if (!clip) throw new Error('Clip not found');
  const per = Layout.effective(p, clip).style.wordsPerChunk || 3;
  const old = Array.isArray(clip.captions) && Array.isArray(clip.captionsRange) ? clip.captionsRange : null;
  const overlap = old && old[0] < clip.end && old[1] > clip.start;
  let chunks;
  if (merge && overlap) {
    const [o0, o1] = old;
    chunks = keepChunks(clip.captions, clip.start, clip.end);
    if (clip.start < o0 - 0.05 || clip.end > o1 + 0.05) {
      job.message = 'Transcribing the added seconds';
      const words = await transcribeRange(job, slug, clip.start, clip.end, p.whisper, base, span);
      const added = dropEcho(words, p.whisper.prompt).filter(w => { const m = (w.s + w.e) / 2; return m >= clip.start && m <= clip.end && (m < o0 || m > o1); });
      chunks = chunks.concat(chunkWords(applyFixes(added, p.whisper.fixes).words, per)).sort((a, b) => a.s - b.s);
    }
  } else {
    const words = await transcribeRange(job, slug, clip.start, clip.end, p.whisper, base, span);
    chunks = chunkWords(applyFixes(dropEcho(words, p.whisper.prompt).filter(w => w.e > clip.start && w.s < clip.end), p.whisper.fixes).words, per);
  }
  await updateProject(slug, q => {
    const c = q.clips.find(x => x.id === clipId);
    if (c) { c.captions = chunks; c.captionsRange = [clip.start, clip.end]; c.captionsVer = (c.captionsVer || 0) + 1; }
  });
  return chunks;
}

async function fullTranscriptJob(job, slug) {
  const p = await loadProject(slug);
  const dir = path.join(projDir(slug), 'transcripts');
  const words = dropEcho(await transcribeRange(job, slug, 0, p.meta.duration, p.whisper), p.whisper.prompt);
  await writeJSON(path.join(dir, 'full.json'), { key: whisperKey(p.whisper), start: 0, end: p.meta.duration, words });
}

// ---------- rendering ----------
const hex = (c, fallback = 'FFFFFF') => (/^#?[0-9a-f]{6}$/i.test(c || '') ? c.replace('#', '') : fallback).toUpperCase();
const assColor = c => { const h = hex(c); return `&H00${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}&`; };
const assTime = t => {
  t = Math.max(0, t);
  const cs = Math.round(t * 100);
  const h = Math.floor(cs / 360000), m = Math.floor(cs / 6000) % 60, s = Math.floor(cs / 100) % 60, c = cs % 100;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
};
const assEsc = t => String(t).replace(/[\\{}]/g, '').replace(/\s+/g, ' ').trim();

function buildASS(p, clip, L, dur) {
  const s = p.style;
  const up = t => s.uppercase ? t.toLocaleUpperCase() : t;
  const head = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Title,${s.titleFont},${s.titleSize},${assColor(s.titleColor1)},&H000000FF&,&H00000000&,&H64000000&,0,0,0,0,100,100,1,0,1,6,2,8,40,40,26,1
Style: Caption,${s.captionFont},${s.captionSize},${assColor(s.captionColor)},&H000000FF&,&H00000000&,&H80000000&,0,0,0,0,100,100,1,0,1,7,3,5,70,70,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const ev = [];
  const t1 = up(assEsc(clip.title1 || '')), t2 = up(assEsc(clip.title2 || ''));
  if (t1 || t2) {
    const size = Layout.titleSize(s, t1, t2);
    const lines = [t1, t2 ? `{\\c${assColor(s.titleColor2)}}${t2}` : ''].filter(Boolean).join('\\N');
    ev.push(`Dialogue: 1,${assTime(0)},${assTime(dur)},Title,,0,0,0,,{\\an8\\pos(540,${L.titleTop || 26})\\fs${size}\\fad(350,0)}${lines}`);
  }
  if (s.captions && clip.captionsOn !== false && Array.isArray(clip.captions)) {
    const y = L.captionY, hl = assColor(s.captionHighlight);
    for (const ch of clip.captions) {
      const words = (ch.words || []).map(w => ({ ...w, w: up(assEsc(w.w)) })).filter(w => w.w);
      if (!words.length) continue;
      const cs = ch.s - clip.start, ce = ch.e - clip.start;
      if (ce <= 0 || cs >= dur) continue;
      const pos = `{\\an5\\pos(540,${y})}`;
      if (s.highlightMode !== 'word') {
        ev.push(`Dialogue: 2,${assTime(cs)},${assTime(ce)},Caption,,0,0,0,,${pos}${words.map(w => w.w).join(' ')}`);
        continue;
      }
      words.forEach((w, i) => {
        const ws = i === 0 ? cs : w.s - clip.start;
        const we = i === words.length - 1 ? ce : words[i + 1].s - clip.start;
        if (we <= ws) return;
        const text = words.map((x, j) => j === i ? `{\\c${hl}\\fscx110\\fscy110}${x.w}{\\r}` : x.w).join(' ');
        ev.push(`Dialogue: 2,${assTime(ws)},${assTime(we)},Caption,,0,0,0,,${pos}${text}`);
      });
    }
  }
  return head + ev.join('\n') + '\n';
}

function buildFilter(p, L, dur) {
  const s = p.style, fps = Number(s.fps) || 30;
  const fo = Math.max(0, dur - 0.5).toFixed(2);
  const blur = s.background !== 'dark';
  const n = L.items.length + (blur ? 1 : 0);
  const labels = Array.from({ length: n }, (_, i) => `[s${i}]`).join('');
  const f = [`[0:v]fps=${fps},setsar=1,split=${n}${labels}`];
  let k = 0;
  if (blur) {
    f.push(`[s${k++}]scale=270:480:force_original_aspect_ratio=increase,crop=270:480,gblur=sigma=10,eq=brightness=-0.2:saturation=1.15,scale=1080:1920,setsar=1[bg]`);
  } else {
    f.push(`color=c=0x0E0E12:s=1080x1920:r=${fps}:d=${dur}[bg]`);
  }
  let last = 'bg';
  L.items.forEach((it, i) => {
    const { src, dst } = it;
    let chain = `[s${k++}]crop=${src.w}:${src.h}:${src.x}:${src.y}`;
    if (it.key === 'cam' && s.camBoost) chain += ',eq=brightness=0.05:contrast=1.08:saturation=0.95';
    chain += `,scale=${dst.w}:${dst.h}:flags=lanczos,setsar=1`;
    if (it.key === 'cam' && s.camBorder && p.layout.mode === 'split') chain += `,drawbox=x=0:y=0:w=iw:h=ih:color=0x${hex(s.accent)}:t=6`;
    f.push(`${chain}[it${i}]`);
    f.push(`[${last}][it${i}]overlay=${dst.x}:${dst.y}${blur ? ':shortest=1' : ''}[o${i}]`);
    last = `o${i}`;
  });
  if (s.progressBar) {
    f.push(`color=c=0x${hex(s.accent)}:s=1080x14:r=${fps}:d=${dur}[bar]`);
    f.push(`[${last}][bar]overlay=x='-w+w*t/${dur}':y=1906:eof_action=pass[ob]`);
    last = 'ob';
  }
  f.push(`[${last}]ass=subs.ass,fade=t=in:st=0:d=0.3,fade=t=out:st=${fo}:d=0.5,format=yuv420p[v]`);
  if (p.meta.hasAudio) {
    f.push(`[0:a]${s.loudnorm ? 'loudnorm=I=-14:TP=-1.5:LRA=11,' : ''}aresample=48000,afade=t=in:st=0:d=0.3,afade=t=out:st=${fo}:d=0.5[a]`);
  } else {
    f.push(`anullsrc=r=48000:cl=stereo,atrim=0:${dur}[a]`);
  }
  return f.join(';\n');
}

const fileTitle = c => [c.title1, c.title2].join(' ').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 50) || 'clip';

const DRAFT_SECONDS = 10;
const draftFile = (slug, clipId) => path.join(projDir(slug), 'drafts', `${clipId}.mp4`);

// draft: { from } renders a fast, low-quality 10-second preview starting at `from` (inside the clip)
// to projects/<slug>/drafts/<clipId>.mp4. It never generates captions (that is the slow part).
async function renderJob(job, slug, clipId, draft = null) {
  let p = await loadProject(slug);
  let clip = p.clips.find(c => c.id === clipId);
  if (!clip) throw new Error('Clip was deleted');
  if (clip.end - clip.start <= 1) throw new Error('Clip is too short');
  let ep = Layout.effective(p, clip);
  const wantCaptions = ep.style.captions && clip.captionsOn !== false;
  const stale = clip.captionsRange && (clip.captionsRange[0] !== clip.start || clip.captionsRange[1] !== clip.end);
  let base = 0;
  if (!draft && wantCaptions && (!Array.isArray(clip.captions) || stale)) {
    if (!WHISPER) throw new Error('Captions are on but whisper is missing — turn captions off or add tools/whisper');
    job.message = stale ? 'Updating captions for the new timing' : 'Generating captions';
    await captionsJob(job, slug, clipId, 0, 0.4, { merge: true });
    p = await loadProject(slug);
    clip = p.clips.find(c => c.id === clipId);
    ep = Layout.effective(p, clip);
    base = 0.4;
  }
  if (draft && wantCaptions && !Array.isArray(clip.captions)) job.note = 'No captions yet: generate them in Edit clip to see them in drafts.';

  // The part of the source to render (the whole clip, or a 10 s window for a draft).
  let seg = clip;
  if (draft) {
    const from = Math.min(Math.max(Number(draft.from) || clip.start, clip.start), Math.max(clip.start, clip.end - DRAFT_SECONDS));
    seg = { ...clip, start: from, end: Math.min(clip.end, from + DRAFT_SECONDS) };
  }
  const dur = Math.round((seg.end - seg.start) * 100) / 100;
  const work = path.join(projDir(slug), draft ? 'drafts' : 'render', clip.id);
  await fsp.mkdir(work, { recursive: true });
  const hasTitle = !!(clip.title1 || clip.title2);
  const L = Layout.compute(ep.layout, p.meta, ep.style, hasTitle);
  await fsp.writeFile(path.join(work, 'subs.ass'), '﻿' + buildASS(ep, seg, L, dur), 'utf8');
  let filter = buildFilter(ep, L, dur);
  if (draft) filter = filter.replace('format=yuv420p[v]', 'scale=540:960,format=yuv420p[v]');
  await fsp.writeFile(path.join(work, 'filter.txt'), filter);

  const outDir = draft ? path.join(projDir(slug), 'drafts') : path.join(OUTPUT_DIR, slugify(slug));
  await fsp.mkdir(outDir, { recursive: true });
  const outName = draft ? `${clip.id}.mp4` : `short_${String(clip.num || 0).padStart(2, '0')}_${fileTitle(clip)}.mp4`;
  const tmp = path.join(outDir, `.rendering_${clip.id}${draft ? '_draft' : ''}.mp4`);
  job.message = draft ? 'Rendering quick draft' : 'Rendering video';
  const crf = Number(ep.style.crf) || 20;
  const cpu = draft
    ? ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '30', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k']
    : ['-c:v', 'libx264', '-preset', 'medium', '-crf', String(crf), '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k'];
  await hwReady;
  const gpu = !draft && ep.style.encoder === 'gpu' ? gpuArgs(crf) : null;
  const encode = enc => runProc(job, FFMPEG, ['-hide_banner', '-nostats', '-progress', 'pipe:1', '-y',
    '-ss', String(seg.start), '-t', String(dur), '-i', path.join(SOURCE_DIR, p.video),
    FILTER_ARG, 'filter.txt', '-map', '[v]', '-map', '[a]',
    ...enc, '-movflags', '+faststart', '-t', String(dur), tmp],
    { cwd: work, duration: dur, base, span: 1 - base });
  try {
    if (gpu) {
      try { await encode([...gpu, '-c:a', 'aac', '-b:a', '160k']); }
      catch (e) {
        if (job.cancelled) throw e;
        job.message = 'Graphics encoder failed, using the processor';
        console.error(`[job ${job.id}] GPU encode failed, retrying on CPU: ${e.message.split('\n')[0]}`);
        await encode(cpu);
      }
    } else await encode(cpu);
  } catch (e) {
    await fsp.rm(tmp, { force: true }).catch(() => {}); // don't leave a half-written video behind
    throw e;
  }
  const out = path.join(outDir, outName);
  if (!draft && clip.output && clip.output !== outName) {
    await fsp.unlink(path.join(outDir, clip.output)).catch(() => {});
    await fsp.unlink(path.join(outDir, txtName(clip.output))).catch(() => {});
  }
  await fsp.rm(out, { force: true });
  await fsp.rename(tmp, out);
  if (draft) { job.draft = { clipId, from: seg.start, at: Date.now() }; return; }
  const sig = Layout.renderSig(p, clip);
  await updateProject(slug, q => {
    const c = q.clips.find(x => x.id === clipId);
    if (c) { c.output = outName; c.renderedAt = Date.now(); c.renderSig = sig; }
  });
  await writeUploadText(p, { ...clip, output: outName }, outDir).catch(e => console.error('upload text: ' + e.message));
}

// ---------- frames ----------
let frameSlots = 3;
const frameWaiters = [];
async function withFrameSlot(fn) {
  if (frameSlots <= 0) await new Promise(r => frameWaiters.push(r));
  frameSlots--;
  try { return await fn(); } finally { frameSlots++; const w = frameWaiters.shift(); if (w) w(); }
}
async function getFrame(slug, t, w) {
  const dir = path.join(projDir(slug), 'thumbs');
  await fsp.mkdir(dir, { recursive: true });
  const out = path.join(dir, `${Math.round(t * 10)}_${w}.jpg`);
  if (await exists(out)) return out;
  const p = await loadProject(slug);
  await withFrameSlot(() => runProc(null, FFMPEG, ['-hide_banner', '-v', 'error', '-y', '-ss', String(t), '-i', path.join(SOURCE_DIR, p.video),
    '-frames:v', '1', '-vf', `scale=${w}:-2`, '-q:v', '4', out]));
  return out;
}

// ---------- http ----------
function httpError(code, msg) { const e = new Error(msg); e.code = code; return e; }
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.mkv': 'video/x-matroska', '.webm': 'video/webm', '.mov': 'video/quicktime' };

function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(body);
}
async function readBody(req, limit = 20 * 1024 * 1024) {
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > limit) throw httpError(413, 'Body too large'); chunks.push(c); }
  const s = Buffer.concat(chunks).toString('utf8');
  return s ? JSON.parse(s) : {};
}
async function serveFile(req, res, file, cache = 'no-cache') {
  let st;
  try { st = await fsp.stat(file); } catch { res.writeHead(404); return res.end('Not found'); }
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const range = req.headers.range && /bytes=(\d*)-(\d*)/.exec(req.headers.range);
  if (range) {
    let start = range[1] ? Number(range[1]) : st.size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : st.size - 1;
    end = Math.min(end, st.size - 1);
    if (start > end || start < 0) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
    res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, 'Cache-Control': cache });
    fs.createReadStream(file, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Accept-Ranges': 'bytes', 'Cache-Control': cache });
    fs.createReadStream(file).pipe(res);
  }
}
const inside = (base, p) => { const r = path.relative(base, p); return r && !r.startsWith('..') && !path.isAbsolute(r); };

async function listVideos() {
  const files = (await fsp.readdir(SOURCE_DIR, { withFileTypes: true }))
    .filter(d => d.isFile() && VIDEO_EXT.has(path.extname(d.name).toLowerCase())).map(d => d.name);
  return Promise.all(files.map(async file => {
    const st = await fsp.stat(path.join(SOURCE_DIR, file));
    const slug = await slugFor(file);
    const p = await readJSON(projFile(slug), null);
    return {
      file, slug, size: st.size, modified: st.mtimeMs, hasProject: !!p, analyzed: !!(p && p.analyzed),
      clips: p ? p.clips.length : 0, rendered: p ? p.clips.filter(c => c.output).length : 0,
      updated: p ? p.updated || null : null, duration: p ? p.meta.duration : null,
    };
  }));
}

async function listMp4(dir) {
  if (!(await exists(dir))) return [];
  const names = (await fsp.readdir(dir, { withFileTypes: true })).filter(d => d.isFile() && d.name.endsWith('.mp4') && !d.name.startsWith('.')).map(d => d.name);
  return Promise.all(names.map(async name => { const st = await fsp.stat(path.join(dir, name)); return { name, size: st.size, modified: st.mtimeMs }; }));
}
// files: this video's shorts; other: loose .mp4s directly in output/ (e.g. older exports).
async function listOutputs(slug) {
  return { files: await listMp4(path.join(OUTPUT_DIR, slugify(slug))), other: await listMp4(OUTPUT_DIR) };
}
// Never delete for good: Windows Recycle Bin; Linux desktop trash (gio), or the app's own .trash folder.
async function toTrash(p) {
  if (onPath('gio')) { try { await runCapture('gio', ['trash', p]); return; } catch { /* no desktop trash: fall back */ } }
  const dir = path.join(ROOT, '.trash');
  await fsp.mkdir(dir, { recursive: true });
  await fsp.rename(p, path.join(dir, `${Date.now()}_${path.basename(p)}`));
}
function recycle(file) {
  if (!IS_WIN) return toTrash(file);
  return runCapture('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    "Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($env:RECYCLE_PATH, 'OnlyErrorDialogs', 'SendToRecycleBin')"],
  { RECYCLE_PATH: file });
}

function recycleDir(dir) {
  if (!IS_WIN) return toTrash(dir);
  return runCapture('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    "Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($env:RECYCLE_PATH, 'OnlyErrorDialogs', 'SendToRecycleBin')"],
  { RECYCLE_PATH: dir });
}

// ---------- style presets (shared by all videos) ----------
const PRESETS_FILE = path.join(PROJECTS_DIR, 'presets.json');
const LOOK_KEYS = Object.keys(STYLE_DEFAULTS).filter(k => !['fps', 'crf', 'loudnorm'].includes(k)).concat(['titleSafe']);
const pickLook = st => Object.fromEntries(LOOK_KEYS.filter(k => st && st[k] !== undefined).map(k => [k, st[k]]));
const BUILTIN_PRESETS = [
  { name: 'Bold yellow', builtin: true, style: pickLook(STYLE_DEFAULTS) },
  { name: 'Clean white', builtin: true, style: pickLook({ ...STYLE_DEFAULTS, titleFont: 'Arial Black', titleSize: 80, titleColor1: '#FFFFFF', titleColor2: '#FFFFFF', captionFont: 'Arial Black', captionSize: 76, captionHighlight: '#00E5FF', accent: '#00E5FF' }) },
  { name: 'Minimal', builtin: true, style: pickLook({ ...STYLE_DEFAULTS, titleFont: 'Bahnschrift', titleSize: 76, titleColor2: '#FFFFFF', captionFont: 'Bahnschrift', captionSize: 70, highlightMode: 'none', uppercase: false, wordsPerChunk: 4, background: 'dark', camBorder: false, progressBar: false }) },
];
async function listPresets() { return BUILTIN_PRESETS.concat((await readJSON(PRESETS_FILE, [])).map(x => ({ ...x, builtin: false }))); }

async function handleApi(req, res, u) {
  const q = Object.fromEntries(u.searchParams);
  const route = `${req.method} ${u.pathname}`;
  switch (route) {
    case 'GET /api/status': {
      const models = (await exists(MODELS_DIR)) ? (await fsp.readdir(MODELS_DIR)).filter(n => n.endsWith('.bin')) : [];
      return sendJSON(res, 200, { startedAt: STARTED_AT, gpu: HW_ENC ? HW_NAMES[HW_ENC] : null, ffmpeg: FFMPEG !== 'ffmpeg' || null, whisper: !!WHISPER, models, threads: THREADS, sourceDir: SOURCE_DIR, outputDir: OUTPUT_DIR });
    }
    case 'GET /api/videos': return sendJSON(res, 200, await listVideos());
    case 'GET /api/project': return sendJSON(res, 200, await openProject(q.video));
    case 'GET /api/analysis': return sendJSON(res, 200, await readJSON(path.join(projDir(q.slug), 'analysis.json'), null));
    case 'GET /api/transcript': return sendJSON(res, 200, await readJSON(path.join(projDir(q.slug), 'transcripts', 'full.json'), null));
    case 'POST /api/project': {
      const b = await readBody(req);
      return sendJSON(res, 200, await saveFromClient(b.slug, b.project, !!b.force));
    }
    case 'POST /api/proxy': {
      // change this video's preview quality and rebuild only the preview copy
      const b = await readBody(req);
      const h = Number(b.height) === 720 ? 720 : 360;
      await updateProject(b.slug, q => { q.proxyHeight = h; });
      if (jobs.some(j => j.slug === b.slug && j.type === 'proxy' && isActive(j))) throw httpError(409, 'The preview is already being rebuilt');
      return sendJSON(res, 200, publicJob(queueSpec({ type: 'proxy', slug: b.slug }, `Preview ${h}p`)));
    }
    case 'POST /api/analyze': {
      const b = await readBody(req);
      const p = await loadProject(b.slug);
      const job = queueSpec({ type: 'analyze', slug: b.slug }, `Analyze ${p.video}`);
      return sendJSON(res, 200, publicJob(job));
    }
    case 'POST /api/detect': {
      const b = await readBody(req);
      const a = await readJSON(path.join(projDir(b.slug), 'analysis.json'), null);
      if (!a) throw httpError(400, 'Analyze the video first');
      const p = await updateProject(b.slug, q => {
        q.detect = detectSettings(b);
        const fresh = candidatesToClips(findCandidates(a.rms, a.scene, q.detect));
        if (b.mode === 'replace') q.clips = fresh;
        else for (const c of fresh) if (!q.clips.some(o => c.start < o.end && c.end > o.start)) q.clips.push(c);
        q.clips.sort((x, y) => x.start - y.start);
      });
      return sendJSON(res, 200, p);
    }
    case 'POST /api/captions': {
      const b = await readBody(req);
      const job = queueSpec({ type: 'captions', slug: b.slug, clipId: b.clipId }, 'Captions');
      return sendJSON(res, 200, publicJob(job));
    }
    case 'POST /api/transcribe-full': {
      const b = await readBody(req);
      const job = queueSpec({ type: 'transcribe', slug: b.slug }, 'Transcribe full stream');
      return sendJSON(res, 200, publicJob(job));
    }
    case 'POST /api/render': {
      const b = await readBody(req);
      const p = await loadProject(b.slug);
      const out = [];
      for (const id of b.clipIds || []) {
        const c = p.clips.find(x => x.id === id);
        if (!c) continue;
        if (jobs.some(j => j.type === 'render' && j.clipId === id && ['queued', 'running'].includes(j.status))) continue;
        out.push(publicJob(queueSpec({ type: 'render', slug: b.slug, clipId: id }, `Render ${clipName(c)}`)));
      }
      return sendJSON(res, 200, out);
    }
    case 'POST /api/draft': {
      const b = await readBody(req);
      const p = await loadProject(b.slug);
      const c = p.clips.find(x => x.id === b.clipId);
      if (!c) throw httpError(404, 'Clip not found');
      const old = jobs.find(j => j.type === 'draft' && j.clipId === c.id && isActive(j));
      if (old) cancelJob(old);
      const from = Number(b.from);
      return sendJSON(res, 200, publicJob(queueSpec({ type: 'draft', slug: b.slug, clipId: c.id, from }, `Quick draft ${clipName(c)}`)));
    }
    case 'GET /api/upload-text': {
      const p = await loadProject(q.slug);
      const c = p.clips.find(x => x.id === q.clipId);
      if (!c) throw httpError(404, 'Clip not found');
      return sendJSON(res, 200, uploadText(p, c));
    }
    case 'POST /api/upload-text/write': {
      // rewrite the .txt of every rendered short (after changing hashtags or descriptions)
      const b = await readBody(req);
      const p = await loadProject(b.slug);
      const dir = path.join(OUTPUT_DIR, slugify(b.slug));
      let n = 0;
      for (const c of p.clips) if (c.output && await exists(path.join(dir, c.output))) { await writeUploadText(p, c, dir); n++; }
      return sendJSON(res, 200, { count: n });
    }
    case 'POST /api/outputs/delete': {
      const b = await readBody(req);
      const dir = b.other ? OUTPUT_DIR : path.join(OUTPUT_DIR, slugify(b.slug));
      const file = path.join(dir, path.basename(String(b.name || '')));
      if (!inside(OUTPUT_DIR, file) || !file.endsWith('.mp4')) throw httpError(403, 'Forbidden');
      if (!(await exists(file))) throw httpError(404, 'File not found');
      await recycle(file);
      if (!b.other && await exists(txtName(file))) await recycle(txtName(file)).catch(() => {});
      if (!b.other) await updateProject(b.slug, q => { for (const c of q.clips) if (c.output === path.basename(file)) { delete c.output; delete c.renderedAt; delete c.renderSig; } });
      return sendJSON(res, 200, { ok: true });
    }
    case 'GET /api/presets': return sendJSON(res, 200, await listPresets());
    case 'POST /api/presets': {
      const b = await readBody(req);
      const name = String(b.name || '').trim().slice(0, 40);
      if (!name) throw httpError(400, 'Give the preset a name');
      if (BUILTIN_PRESETS.some(x => x.name.toLowerCase() === name.toLowerCase())) throw httpError(400, 'That name is used by a built-in preset');
      const list = (await readJSON(PRESETS_FILE, [])).filter(x => x.name.toLowerCase() !== name.toLowerCase());
      list.push({ name, style: pickLook(b.style) });
      await writeJSON(PRESETS_FILE, list);
      return sendJSON(res, 200, await listPresets());
    }
    case 'POST /api/presets/delete': {
      const b = await readBody(req);
      await writeJSON(PRESETS_FILE, (await readJSON(PRESETS_FILE, [])).filter(x => x.name !== b.name));
      return sendJSON(res, 200, await listPresets());
    }
    case 'GET /api/jobs': return sendJSON(res, 200, jobs.map(publicJob));
    case 'GET /api/interrupted': return sendJSON(res, 200, interrupted);
    case 'POST /api/interrupted': {
      const b = await readBody(req);
      const list = interrupted; interrupted = [];
      const out = [];
      if (b.action === 'resume') {
        for (const spec of list) {
          if (spec.clipId && jobs.some(j => j.type === spec.type && j.clipId === spec.clipId && isActive(j))) continue;
          try { out.push(publicJob(queueSpec(spec, spec.label || spec.type))); } catch (e) { console.error(e.message); }
        }
      }
      persistQueue();
      return sendJSON(res, 200, out);
    }
    case 'POST /api/jobs/cancel': {
      const b = await readBody(req);
      if (b.all) jobs.filter(isActive).forEach(cancelJob);
      else cancelJob(jobs.find(j => j.id === b.id));
      return sendJSON(res, 200, { ok: true });
    }
    case 'POST /api/jobs/retry': {
      const b = await readBody(req);
      const targets = b.status ? jobs.filter(j => j.status === b.status) : jobs.filter(j => j.id === b.id);
      const out = targets.slice().sort((x, y) => x.id - y.id).map(retryJob).filter(Boolean).map(publicJob);
      return sendJSON(res, 200, out);
    }
    case 'POST /api/fix-words': {
      // Apply the project's word fixes to every clip's existing captions.
      const b = await readBody(req);
      let count = 0;
      let echo = 0;
      const p = await updateProject(b.slug, q => {
        for (const c of q.clips) if (Array.isArray(c.captions)) {
          const r = stripEchoChunks(c.captions, q.whisper.prompt);
          if (r.removed) { c.captions = r.chunks; echo += r.removed; }
          const n = fixChunks(c.captions, q.whisper.fixes);
          if (n || r.removed) c.captionsVer = (c.captionsVer || 0) + 1;
          count += n;
        }
      });
      return sendJSON(res, 200, { count, echo, project: p });

    }
    case 'POST /api/jobs/clear': {
      for (let i = jobs.length - 1; i >= 0; i--) if (['done', 'error', 'cancelled'].includes(jobs[i].status)) jobs.splice(i, 1);
      return sendJSON(res, 200, { ok: true });
    }
    case 'GET /api/frame': {
      const t = Math.max(0, Number(q.t) || 0), w = Math.min(1920, Math.max(64, Number(q.w) || 320));
      return serveFile(req, res, await getFrame(q.slug, t, w), 'max-age=86400');
    }
    case 'GET /api/outputs': return sendJSON(res, 200, await listOutputs(q.slug));
    case 'POST /api/project/reset': {
      // Start a video over: its project folder (clips, edits, analysis, captions) goes to the Recycle Bin.
      // Finished shorts in output/ are kept.
      const b = await readBody(req);
      const dir = projDir(b.slug);
      if (!inside(PROJECTS_DIR, dir) || !(await exists(projFile(b.slug)))) throw httpError(404, 'Project not found');
      jobs.filter(j => j.slug === b.slug && isActive(j)).forEach(cancelJob);
      await new Promise(r => setTimeout(r, 400)); // let cancelled tools release their files
      interrupted = interrupted.filter(x => x.slug !== b.slug); persistQueue();
      await withLock(b.slug, () => recycleDir(dir));
      return sendJSON(res, 200, { ok: true });
    }
    case 'POST /api/open': {
      const b = await readBody(req);
      const dir = b.what === 'source' ? SOURCE_DIR : b.what === 'project' && b.slug ? projDir(b.slug) : b.slug ? path.join(OUTPUT_DIR, slugify(b.slug)) : OUTPUT_DIR;
      await fsp.mkdir(dir, { recursive: true });
      openWith(dir);
      return sendJSON(res, 200, { ok: true });
    }
    case 'PUT /api/upload': {
      const name = path.basename(String(q.name || ''));
      if (!VIDEO_EXT.has(path.extname(name).toLowerCase())) throw httpError(400, 'Unsupported file type');
      const dest = path.join(SOURCE_DIR, name);
      if (await exists(dest)) throw httpError(409, 'A video with this name already exists');
      const tmp = dest + '.uploading';
      await new Promise((resolve, reject) => {
        const ws = fs.createWriteStream(tmp);
        req.pipe(ws);
        ws.on('finish', resolve);
        ws.on('error', reject);
        req.on('error', reject);
      });
      await fsp.rename(tmp, dest);
      return sendJSON(res, 200, { file: name });
    }
  }
  throw httpError(404, 'Unknown API route');
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${HOST}`);
  try {
    if (u.pathname.startsWith('/api/')) return await handleApi(req, res, u);
    if (u.pathname.startsWith('/media/')) {
      const [, , kind, slug, name] = u.pathname.split('/').map(decodeURIComponent);
      if (kind === 'proxy') return serveFile(req, res, path.join(projDir(slug), 'proxy.mp4'));
      if (kind === 'source') {
        const p = await loadProject(slug);
        return serveFile(req, res, path.join(SOURCE_DIR, p.video));
      }
      if (kind === 'draft') return serveFile(req, res, draftFile(slug, path.basename(name || '')));
      if (kind === 'output-other') {
        const f = path.join(OUTPUT_DIR, path.basename(slug || ''));
        if (!inside(OUTPUT_DIR, f)) throw httpError(403, 'Forbidden');
        return serveFile(req, res, f);
      }
      if (kind === 'output') {
        const f = path.join(OUTPUT_DIR, slugify(slug), path.basename(name || ''));
        if (!inside(OUTPUT_DIR, f)) throw httpError(403, 'Forbidden');
        return serveFile(req, res, f);
      }
      throw httpError(404, 'Not found');
    }
    const rel = u.pathname === '/' ? 'index.html' : decodeURIComponent(u.pathname.slice(1));
    const f = path.join(PUBLIC_DIR, rel);
    if (!inside(PUBLIC_DIR, f)) throw httpError(403, 'Forbidden');
    return serveFile(req, res, f);
  } catch (e) {
    if (!res.headersSent) sendJSON(res, e.code && e.code >= 400 && e.code < 600 ? e.code : 500, { error: e.message });
    else res.end();
    if (!e.code || e.code >= 500) console.error(e);
  }
});

if (require.main === module) server.listen(PORT, HOST, () => {
  const url = `http://${HOST}:${PORT}`;
  console.log(`\n  Stream → Shorts is running at ${url}\n  (local only — ${IS_WIN ? 'close this window' : 'press Ctrl+C'} to stop)\n`);
  console.log(`  ffmpeg: ${FFMPEG} (v${FFMPEG_MAJOR}) · speech recognition: ${WHISPER || 'not installed'}\n`);
  if (!process.argv.includes('--no-open')) openWith(url);
});

module.exports = { detectSettings, DETECT_DEFAULTS, echoMask, stripEchoChunks, uploadText, sentence, gpuArgs, slugFor, friendlyError, renderJob, listOutputs, ensureNums, buildASS, buildFilter, chunkWords, findCandidates, parseWhisper, applyFixes, keepChunks, whisperKey };
