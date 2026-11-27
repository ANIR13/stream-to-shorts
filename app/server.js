'use strict';
// Stream → Shorts: local-only server (no login, binds to 127.0.0.1).
//
// This file is the entry point and the HTTP layer: it builds the application from its parts
// (see app/src and docs/ARCHITECTURE.md) and maps each API route to a service call.
//   src/shared          errors, file helpers, statistics
//   src/infrastructure  processes, tools and environment, ffmpeg adapter, trash
//   src/core            pure logic: project model, detection, captions, render graph, upload text
//   src/repository      project storage
//   src/services        detection, transcription, rendering, export, presets, job queue
const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const { httpError, friendlyError } = require('./src/shared/errors');
const { exists, readJSON, inside, slugify } = require('./src/shared/fsutil');
const { openWith, createProcessRunner } = require('./src/infrastructure/process');
const { createEnvironment } = require('./src/infrastructure/environment');
const { createFfmpeg } = require('./src/infrastructure/ffmpeg');
const { createTrash } = require('./src/infrastructure/trash');
const { clipName } = require('./src/core/project');
const { stripEchoChunks, fixChunks } = require('./src/core/captions');
const { createProjectRepository } = require('./src/repository/projectRepository');
const { createDetectionService } = require('./src/services/detectionService');
const { createTranscriptionService } = require('./src/services/transcriptionService');
const { createRenderingService } = require('./src/services/renderingService');
const { createExportService } = require('./src/services/exportService');
const { createPresetService } = require('./src/services/presetService');
const { createJobQueue, isActive, publicJob } = require('./src/services/jobQueue');

const HOST = '127.0.0.1';
const VIDEO_EXT = new Set(['.mkv', '.mp4', '.mov', '.webm', '.flv', '.avi', '.ts', '.m4v']);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.mkv': 'video/x-matroska', '.webm': 'video/webm', '.mov': 'video/quicktime' };

// ---------- HTTP helpers ----------
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
// Static and media files, with byte ranges so videos can be scrubbed.
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

// ---------- composition ----------
// Builds the whole application for a project folder. Nothing runs until listen() is called.
function createApp({ root = path.resolve(__dirname, '..'), log = console } = {}) {
  const env = createEnvironment(root);
  const { paths, tools } = env;
  const runner = createProcessRunner({ env: env.env });
  const ffmpeg = createFfmpeg({ ffmpegPath: tools.FFMPEG, ffprobePath: tools.FFPROBE, runner });
  const trash = createTrash({ root, runner });
  const repo = createProjectRepository({ projectsDir: paths.PROJECTS_DIR, sourceDir: paths.SOURCE_DIR, outputDir: paths.OUTPUT_DIR, probe: src => ffmpeg.probe(src) });
  const detection = createDetectionService({ repo, ffmpeg, sourceDir: paths.SOURCE_DIR });
  const transcription = createTranscriptionService({ repo, ffmpeg, runner, whisperPath: tools.WHISPER, modelsDir: paths.MODELS_DIR, threads: env.WHISPER_THREADS, sourceDir: paths.SOURCE_DIR, isWin: env.IS_WIN });
  const rendering = createRenderingService({ repo, ffmpeg, transcription, outputDir: paths.OUTPUT_DIR, sourceDir: paths.SOURCE_DIR, log });
  const exporting = createExportService({ repo, outputDir: paths.OUTPUT_DIR, trash, rendering });
  const presets = createPresetService({ file: path.join(paths.PROJECTS_DIR, 'presets.json') });
  // Tasks are described by a spec so they can be saved and resumed after the app window was closed.
  const specFn = spec => {
    switch (spec.type) {
      case 'render': return j => rendering.render(j, spec.slug, spec.clipId);
      case 'draft': return j => rendering.render(j, spec.slug, spec.clipId, { from: spec.from });
      case 'captions': return j => transcription.captionClip(j, spec.slug, spec.clipId);
      case 'transcribe': return j => transcription.transcribeAll(j, spec.slug);
      case 'analyze': return j => detection.analyze(j, spec.slug);
      case 'proxy': return j => detection.buildProxy(j, spec.slug);
      default: throw new Error('Unknown task type ' + spec.type);
    }
  };
  const queue = createJobQueue({ queueFile: path.join(paths.PROJECTS_DIR, '.queue.json'), specFn, log });
  const STARTED_AT = Date.now();

  // ---------- thumbnails (at most 3 ffmpeg processes at a time) ----------
  let frameSlots = 3;
  const frameWaiters = [];
  async function withFrameSlot(fn) {
    if (frameSlots <= 0) await new Promise(r => frameWaiters.push(r));
    frameSlots--;
    try { return await fn(); } finally { frameSlots++; const w = frameWaiters.shift(); if (w) w(); }
  }
  async function getFrame(slug, t, w) {
    const dir = repo.fileIn(slug, 'thumbs');
    await fsp.mkdir(dir, { recursive: true });
    const out = path.join(dir, `${Math.round(t * 10)}_${w}.jpg`);
    if (await exists(out)) return out;
    const p = await repo.load(slug);
    await withFrameSlot(() => ffmpeg.run(null, ['-hide_banner', '-v', 'error', '-y', '-ss', String(t), '-i', path.join(paths.SOURCE_DIR, p.video),
      '-frames:v', '1', '-vf', `scale=${w}:-2`, '-q:v', '4', out]));
    return out;
  }

  async function listVideos() {
    const files = (await fsp.readdir(paths.SOURCE_DIR, { withFileTypes: true }))
      .filter(d => d.isFile() && VIDEO_EXT.has(path.extname(d.name).toLowerCase())).map(d => d.name);
    return Promise.all(files.map(async file => {
      const st = await fsp.stat(path.join(paths.SOURCE_DIR, file));
      const slug = await repo.slugFor(file);
      const p = await repo.readRaw(slug);
      return {
        file, slug, size: st.size, modified: st.mtimeMs, hasProject: !!p, analyzed: !!(p && p.analyzed),
        clips: p ? p.clips.length : 0, rendered: p ? p.clips.filter(c => c.output).length : 0,
        updated: p ? p.updated || null : null, duration: p ? p.meta.duration : null,
      };
    }));
  }

  // ---------- API routes ----------
  async function handleApi(req, res, u) {
    const q = Object.fromEntries(u.searchParams);
    const route = `${req.method} ${u.pathname}`;
    const jobs = queue.jobs;
    switch (route) {
      case 'GET /api/status': {
        const models = (await exists(paths.MODELS_DIR)) ? (await fsp.readdir(paths.MODELS_DIR)).filter(n => n.endsWith('.bin')) : [];
        return sendJSON(res, 200, { startedAt: STARTED_AT, gpu: ffmpeg.hardwareName, ffmpeg: tools.FFMPEG !== 'ffmpeg' || null, whisper: transcription.available, models, threads: env.THREADS, sourceDir: paths.SOURCE_DIR, outputDir: paths.OUTPUT_DIR });
      }
      case 'GET /api/videos': return sendJSON(res, 200, await listVideos());
      case 'GET /api/project': return sendJSON(res, 200, await repo.open(q.video));
      case 'GET /api/analysis': return sendJSON(res, 200, await repo.readAnalysis(q.slug));
      case 'GET /api/transcript': return sendJSON(res, 200, await repo.readTranscript(q.slug));
      case 'POST /api/project': {
        const b = await readBody(req);
        return sendJSON(res, 200, await repo.saveFromClient(b.slug, b.project, !!b.force));
      }
      case 'POST /api/proxy': {
        // change this video's preview quality and rebuild only the preview copy
        const b = await readBody(req);
        const h = Number(b.height) === 720 ? 720 : 360;
        await repo.update(b.slug, p => { p.proxyHeight = h; });
        if (jobs.some(j => j.slug === b.slug && j.type === 'proxy' && isActive(j))) throw httpError(409, 'The preview is already being rebuilt');
        return sendJSON(res, 200, publicJob(queue.addSpec({ type: 'proxy', slug: b.slug }, `Preview ${h}p`)));
      }
      case 'POST /api/analyze': {
        const b = await readBody(req);
        const p = await repo.load(b.slug);
        return sendJSON(res, 200, publicJob(queue.addSpec({ type: 'analyze', slug: b.slug }, `Analyze ${p.video}`)));
      }
      case 'POST /api/detect': {
        const b = await readBody(req);
        return sendJSON(res, 200, await detection.detect(b.slug, b, b.mode));
      }
      case 'POST /api/captions': {
        const b = await readBody(req);
        return sendJSON(res, 200, publicJob(queue.addSpec({ type: 'captions', slug: b.slug, clipId: b.clipId }, 'Captions')));
      }
      case 'POST /api/transcribe-full': {
        const b = await readBody(req);
        return sendJSON(res, 200, publicJob(queue.addSpec({ type: 'transcribe', slug: b.slug }, 'Transcribe full stream')));
      }
      case 'POST /api/render': {
        const b = await readBody(req);
        const p = await repo.load(b.slug);
        const out = [];
        for (const id of b.clipIds || []) {
          const c = p.clips.find(x => x.id === id);
          if (!c) continue;
          if (jobs.some(j => j.type === 'render' && j.clipId === id && isActive(j))) continue;
          out.push(publicJob(queue.addSpec({ type: 'render', slug: b.slug, clipId: id }, `Render ${clipName(c)}`)));
        }
        return sendJSON(res, 200, out);
      }
      case 'POST /api/draft': {
        const b = await readBody(req);
        const p = await repo.load(b.slug);
        const c = p.clips.find(x => x.id === b.clipId);
        if (!c) throw httpError(404, 'Clip not found');
        const old = jobs.find(j => j.type === 'draft' && j.clipId === c.id && isActive(j));
        if (old) queue.cancel(old);
        const from = Number(b.from);
        return sendJSON(res, 200, publicJob(queue.addSpec({ type: 'draft', slug: b.slug, clipId: c.id, from }, `Quick draft ${clipName(c)}`)));
      }
      case 'GET /api/upload-text': return sendJSON(res, 200, await exporting.clipUploadText(q.slug, q.clipId));
      case 'POST /api/upload-text/write': {
        const b = await readBody(req);
        return sendJSON(res, 200, { count: await exporting.writeAllUploadTexts(b.slug) });
      }
      case 'POST /api/outputs/delete': {
        const b = await readBody(req);
        await exporting.remove(b.slug, b.name, !!b.other);
        return sendJSON(res, 200, { ok: true });
      }
      case 'GET /api/presets': return sendJSON(res, 200, await presets.list());
      case 'POST /api/presets': {
        const b = await readBody(req);
        return sendJSON(res, 200, await presets.save(b.name, b.style));
      }
      case 'POST /api/presets/delete': {
        const b = await readBody(req);
        return sendJSON(res, 200, await presets.remove(b.name));
      }
      case 'GET /api/jobs': return sendJSON(res, 200, jobs.map(publicJob));
      case 'GET /api/interrupted': return sendJSON(res, 200, queue.interrupted);
      case 'POST /api/interrupted': {
        const b = await readBody(req);
        return sendJSON(res, 200, queue.takeInterrupted(b.action === 'resume').map(publicJob));
      }
      case 'POST /api/jobs/cancel': {
        const b = await readBody(req);
        if (b.all) queue.active().forEach(queue.cancel);
        else queue.cancel(queue.find(b.id));
        return sendJSON(res, 200, { ok: true });
      }
      case 'POST /api/jobs/retry': {
        const b = await readBody(req);
        const targets = b.status ? jobs.filter(j => j.status === b.status) : jobs.filter(j => j.id === b.id);
        return sendJSON(res, 200, targets.slice().sort((x, y) => x.id - y.id).map(queue.retry).filter(Boolean).map(publicJob));
      }
      case 'POST /api/fix-words': {
        // Apply the project's word fixes to every clip's existing captions (and remove hint-word echoes).
        const b = await readBody(req);
        let count = 0, echo = 0;
        const p = await repo.update(b.slug, proj => {
          for (const c of proj.clips) if (Array.isArray(c.captions)) {
            const r = stripEchoChunks(c.captions, proj.whisper.prompt);
            if (r.removed) { c.captions = r.chunks; echo += r.removed; }
            const n = fixChunks(c.captions, proj.whisper.fixes);
            if (n || r.removed) c.captionsVer = (c.captionsVer || 0) + 1;
            count += n;
          }
        });
        return sendJSON(res, 200, { count, echo, project: p });
      }
      case 'POST /api/jobs/clear': {
        queue.clearFinished();
        return sendJSON(res, 200, { ok: true });
      }
      case 'GET /api/frame': {
        const t = Math.max(0, Number(q.t) || 0), w = Math.min(1920, Math.max(64, Number(q.w) || 320));
        return serveFile(req, res, await getFrame(q.slug, t, w), 'max-age=86400');
      }
      case 'GET /api/outputs': return sendJSON(res, 200, await exporting.list(q.slug));
      case 'POST /api/project/reset': {
        // Start a video over: its project folder (clips, edits, analysis, captions) goes to the Recycle Bin.
        // Finished shorts in output/ are kept.
        const b = await readBody(req);
        const dir = repo.projDir(b.slug);
        if (!inside(paths.PROJECTS_DIR, dir) || !(await repo.exists(b.slug))) throw httpError(404, 'Project not found');
        jobs.filter(j => j.slug === b.slug && isActive(j)).forEach(queue.cancel);
        await new Promise(r => setTimeout(r, 400)); // let cancelled tools release their files
        queue.forgetInterrupted(b.slug);
        await repo.withLock(b.slug, () => trash.recycleDir(dir));
        return sendJSON(res, 200, { ok: true });
      }
      case 'POST /api/open': {
        const b = await readBody(req);
        const dir = b.what === 'source' ? paths.SOURCE_DIR : b.what === 'project' && b.slug ? repo.projDir(b.slug) : b.slug ? exporting.dirOf(b.slug) : paths.OUTPUT_DIR;
        await fsp.mkdir(dir, { recursive: true });
        openWith(dir);
        return sendJSON(res, 200, { ok: true });
      }
      case 'PUT /api/upload': {
        const name = path.basename(String(q.name || ''));
        if (!VIDEO_EXT.has(path.extname(name).toLowerCase())) throw httpError(400, 'Unsupported file type');
        const dest = path.join(paths.SOURCE_DIR, name);
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
        if (kind === 'proxy') return serveFile(req, res, repo.fileIn(slug, 'proxy.mp4'));
        if (kind === 'source') {
          const p = await repo.load(slug);
          return serveFile(req, res, path.join(paths.SOURCE_DIR, p.video));
        }
        if (kind === 'draft') return serveFile(req, res, rendering.draftFile(slug, path.basename(name || '')));
        if (kind === 'output-other') {
          const f = path.join(paths.OUTPUT_DIR, path.basename(slug || ''));
          if (!inside(paths.OUTPUT_DIR, f)) throw httpError(403, 'Forbidden');
          return serveFile(req, res, f);
        }
        if (kind === 'output') {
          const f = path.join(paths.OUTPUT_DIR, slugify(slug), path.basename(name || ''));
          if (!inside(paths.OUTPUT_DIR, f)) throw httpError(403, 'Forbidden');
          return serveFile(req, res, f);
        }
        throw httpError(404, 'Not found');
      }
      const rel = u.pathname === '/' ? 'index.html' : decodeURIComponent(u.pathname.slice(1));
      const f = path.join(paths.PUBLIC_DIR, rel);
      if (!inside(paths.PUBLIC_DIR, f)) throw httpError(403, 'Forbidden');
      return serveFile(req, res, f);
    } catch (e) {
      if (!res.headersSent) sendJSON(res, e.code && e.code >= 400 && e.code < 600 ? e.code : 500, { error: e.message });
      else res.end();
      if (!e.code || e.code >= 500) log.error(e);
    }
  });

  // Start: create folders, look for a graphics encoder in the background, listen on 127.0.0.1.
  function listen(port, { open = true } = {}) {
    env.prepare();
    ffmpeg.detectHardware();
    return new Promise(resolve => server.listen(port, HOST, () => {
      const url = `http://${HOST}:${port}`;
      log.log(`\n  Stream → Shorts is running at ${url}\n  (local only — ${env.IS_WIN ? 'close this window' : 'press Ctrl+C'} to stop)\n`);
      log.log(`  ffmpeg: ${tools.FFMPEG} (v${ffmpeg.major}) · speech recognition: ${tools.WHISPER || 'not installed'}\n`);
      for (const m of env.missingTools()) log.log(`  ! ${m}\n`);
      // Half-written shorts left by a render that was running when the app was closed or crashed.
      rendering.cleanupPartial().then(n => { if (n) log.log(`  Removed ${n} unfinished render file(s) from the last session.\n`); }, e => log.error(e));
      if (open) openWith(url);
      resolve(server);
    }));
  }

  return { env, repo, ffmpeg, detection, transcription, rendering, exporting, presets, queue, server, listen, handleApi };
}

if (require.main === module) {
  createApp().listen(Number(process.env.PORT) || 5199, { open: !process.argv.includes('--no-open') });
}

// Pure functions, re-exported for scripts and tests that used them from this file.
const detectionCore = require('./src/core/detection');
const captionsCore = require('./src/core/captions');
const renderCore = require('./src/core/render');
const uploadCore = require('./src/core/upload');
const projectCore = require('./src/core/project');
module.exports = {
  createApp, friendlyError, readJSON,
  detectSettings: detectionCore.detectSettings, DETECT_DEFAULTS: detectionCore.DETECT_DEFAULTS, findCandidates: detectionCore.findCandidates,
  echoMask: captionsCore.echoMask, stripEchoChunks: captionsCore.stripEchoChunks, chunkWords: captionsCore.chunkWords,
  parseWhisper: captionsCore.parseWhisper, applyFixes: captionsCore.applyFixes, keepChunks: captionsCore.keepChunks, whisperKey: captionsCore.whisperKey,
  buildASS: renderCore.buildASS, buildFilter: renderCore.buildFilter,
  uploadText: uploadCore.uploadText, sentence: uploadCore.sentence,
  ensureNums: projectCore.ensureNums,
};
