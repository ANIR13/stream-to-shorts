'use strict';
// Rendering service: turns a clip into a finished vertical short (or a 10-second quick draft).
const fsp = require('fs').promises;
const os = require('os');
const path = require('path');
const Layout = require('../../public/layout.js');
const { slugify } = require('../shared/fsutil');
const { draftFilter, shortName } = require('../core/render');
const { profileOf, cpuArgs, gpuQuality, audioArgs } = require('../core/profiles');
const { estimateRender, memoryWarning } = require('../core/resources');
const { buildTimeline, compileTimeline, inputArgs } = require('../core/timeline');
const { exists } = require('../shared/fsutil');
const { uploadText, txtName, uploadTextFile } = require('../core/upload');

const DRAFT_SECONDS = 10;
// ffmpeg's messages when memory runs out (Linux, Windows, macOS)
const OUT_OF_MEMORY = /Cannot allocate memory|out of memory|ENOMEM|Not enough memory|std::bad_alloc|malloc/i;
// Title and description as MP4 metadata (one line each, no control characters).
const metadataArgs = u => ['-metadata', 'title=' + clean(u.title), '-metadata', 'comment=' + clean(u.description).slice(0, 1000)];
const clean = t => String(t || '').replace(/[\x00-\x1f]+/g, ' ').trim();

// transcription: the transcription service (captions are generated before rendering when missing).
// freeMemoryMB(): free memory now (tests pass a fixed value).
function createRenderingService({ repo, ffmpeg, transcription, outputDir, sourceDir, log = console, freeMemoryMB = () => os.freemem() / 1048576 }) {
  const draftFile = (slug, clipId) => repo.fileIn(slug, 'drafts', `${clipId}.mp4`);
  const outputDirOf = slug => path.join(outputDir, slugify(slug));

  // The .txt with title, description and hashtags saved next to a short.
  async function writeUploadText(p, clip, outDir) {
    if (!clip.output) return false;
    await fsp.writeFile(path.join(outDir, txtName(clip.output)), uploadTextFile(uploadText(p, clip)), 'utf8');
    return true;
  }

  // draft: { from } renders a fast, low-quality 10-second preview starting at `from` (inside the clip)
  // to projects/<slug>/drafts/<clipId>.mp4. It never generates captions (that is the slow part).
  async function render(job, slug, clipId, draft = null) {
    let p = await repo.load(slug);
    let clip = p.clips.find(c => c.id === clipId);
    if (!clip) throw new Error('Clip was deleted');
    if (clip.end - clip.start <= 1) throw new Error('Clip is too short');
    let ep = Layout.effective(p, clip);
    const wantCaptions = ep.style.captions && clip.captionsOn !== false;
    const stale = clip.captionsRange && (clip.captionsRange[0] !== clip.start || clip.captionsRange[1] !== clip.end);
    let base = 0;
    if (!draft && wantCaptions && (!Array.isArray(clip.captions) || stale)) {
      if (!transcription.available) throw new Error('Captions are on but whisper is missing — turn captions off or add tools/whisper');
      job.message = stale ? 'Updating captions for the new timing' : 'Generating captions';
      await transcription.captionClip(job, slug, clipId, 0, 0.4, { merge: true });
      p = await repo.load(slug);
      clip = p.clips.find(c => c.id === clipId);
      ep = Layout.effective(p, clip);
      base = 0.4;
    }
    if (draft && wantCaptions && !Array.isArray(clip.captions)) job.note = 'No captions yet: generate them in Edit clip to see them in drafts.';

    // The short as a timeline (the whole clip, or a 10 s window of it for a draft), compiled to the
    // subtitle file, the filter graph and the inputs (see core/timeline.js).
    let window = null;
    if (draft) {
      const from = Math.min(Math.max(Number(draft.from) || clip.start, clip.start), Math.max(clip.start, clip.end - DRAFT_SECONDS));
      window = { start: from, end: Math.min(clip.end, from + DRAFT_SECONDS) };
    }
    const tl = buildTimeline(ep, clip, window);
    if (tl.duration <= 1) throw new Error('Clip is too short');
    const built = compileTimeline(ep, clip, tl);
    const dur = built.duration;
    for (const i of built.inputs) {
      if (!(await exists(path.join(sourceDir, i.file)))) throw new Error(`${i.kind === 'image' ? 'Image' : 'Music'} not found in the source folder: ${i.file}`);
    }
    const work = repo.fileIn(slug, draft ? 'drafts' : 'render', clip.id);
    await fsp.mkdir(work, { recursive: true });
    await fsp.writeFile(path.join(work, 'subs.ass'), '﻿' + built.ass, 'utf8');
    let filter = built.filter;
    if (draft) filter = draftFilter(filter);
    await fsp.writeFile(path.join(work, 'filter.txt'), filter);

    const outDir = draft ? repo.fileIn(slug, 'drafts') : outputDirOf(slug);
    await fsp.mkdir(outDir, { recursive: true });
    const outName = draft ? `${clip.id}.mp4` : shortName(clip);
    const tmp = path.join(outDir, `.rendering_${clip.id}${draft ? '_draft' : ''}.mp4`);
    job.message = draft ? 'Rendering quick draft' : 'Rendering video';
    const crf = Number(ep.style.crf) || 20;
    const profile = profileOf(ep.style);
    const cpu = cpuArgs(profile, crf, !!draft);
    await ffmpeg.detectHardware();
    const gpu = !draft && ep.style.encoder === 'gpu' ? ffmpeg.gpuArgs(gpuQuality(profile, crf)) : null;
    // what this render probably needs, and a warning when the computer is short of memory
    job.estimate = estimateRender({ meta: p.meta, duration: dur, style: ep.style, draft: !!draft, cores: os.cpus().length,
      layers: tl.layout.items.length + built.inputs.filter(i => i.kind === 'image').length, gpu: !!gpu });
    const warn = memoryWarning(job.estimate, freeMemoryMB());
    if (warn) job.note = warn;
    // title and description inside the MP4 (players and some upload pages show them)
    const meta = draft ? [] : metadataArgs(uploadText(p, clip));
    const args = (enc, extra = []) => ['-hide_banner', '-nostats', '-progress', 'pipe:1', '-y', ...extra,
      '-ss', String(built.seek.start), '-t', String(built.seek.length), '-i', path.join(sourceDir, p.video),
      ...inputArgs(built.inputs, sourceDir, dur, tl.fps, path.join),
      ffmpeg.filterArg, 'filter.txt', '-map', '[v]', '-map', '[a]',
      ...enc, ...meta, '-movflags', '+faststart', '-t', String(dur), tmp];
    const encode = (enc, extra) => ffmpeg.run(job, args(enc, extra), { cwd: work, duration: dur, base, span: 1 - base });
    let lastArgs = args(gpu ? [...gpu, ...audioArgs(profile)] : cpu);
    try {
      try {
        if (gpu) {
          try { await encode([...gpu, ...audioArgs(profile)]); }
          catch (e) {
            if (job.cancelled) throw e;
            job.message = 'Graphics encoder failed, using the processor';
            log.error(`[job ${job.id}] GPU encode failed, retrying on CPU: ${e.message.split('\n')[0]}`);
            lastArgs = args(cpu);
            await encode(cpu);
          }
        } else await encode(cpu);
      } catch (e) {
        // out of memory: once more with fewer threads (less memory, slower) before giving up
        if (job.cancelled || !OUT_OF_MEMORY.test(e.message)) throw e;
        job.message = 'Not enough memory, trying again with fewer threads';
        log.error(`[job ${job.id}] out of memory, retrying with fewer threads`);
        lastArgs = args([...cpu, '-threads', '2'], ['-filter_threads', '1']);
        await encode([...cpu, '-threads', '2'], ['-filter_threads', '1']);
      }
      // check the new file before it replaces anything
      job.message = 'Checking the video';
      await validateOutput(tmp, { duration: dur, draft: !!draft });
    } catch (e) {
      await fsp.rm(tmp, { force: true }).catch(() => {}); // don't leave a half-written video behind
      if (!job.cancelled) job.logFile = await writeFailureLog(slug, job, clip, lastArgs, e).catch(() => null);
      throw e;
    }
    const out = path.join(outDir, outName);
    if (!draft && clip.output && clip.output !== outName) {
      await fsp.unlink(path.join(outDir, clip.output)).catch(() => {});
      await fsp.unlink(path.join(outDir, txtName(clip.output))).catch(() => {});
    }
    await fsp.rm(out, { force: true });
    await fsp.rename(tmp, out);
    if (draft) { job.draft = { clipId, from: window.start, at: Date.now() }; return; }
    const sig = Layout.renderSig(p, clip);
    await repo.update(slug, q => {
      const c = q.clips.find(x => x.id === clipId);
      if (c) { c.output = outName; c.renderedAt = Date.now(); c.renderSig = sig; }
    });
    await writeUploadText(p, { ...clip, output: outName }, outDir).catch(e => log.error('upload text: ' + e.message));
  }

  // The finished file must be a playable vertical video of the expected length, with sound, before it
  // replaces the previous short. Throws a plain-language error otherwise.
  async function validateOutput(file, { duration, draft }) {
    const st = await fsp.stat(file).catch(() => null);
    if (!st || !st.size) throw new Error('The rendered video is empty. The render was not saved.');
    let info;
    try { info = await ffmpeg.probe(file); } catch (e) { throw new Error('The rendered video can\'t be read: ' + e.message.split('\n')[0]); }
    const [w, h] = draft ? [540, 960] : [1080, 1920];
    const problems = [];
    if (info.width !== w || info.height !== h) problems.push(`size ${info.width}x${info.height} instead of ${w}x${h}`);
    if (!(Math.abs(info.duration - duration) <= Math.max(0.35, duration * 0.02))) problems.push(`length ${Math.round(info.duration * 10) / 10} s instead of ${Math.round(duration * 10) / 10} s`);
    if (!info.hasAudio) problems.push('no sound track');
    if (problems.length) throw new Error('The rendered video did not pass the checks (' + problems.join(', ') + '). The previous version was kept.');
  }

  // A log file per failed render (it survives a restart; Tasks shows where it is). Keeps the last 20.
  async function writeFailureLog(slug, job, clip, args, err) {
    const dir = repo.fileIn(slug, 'logs');
    await fsp.mkdir(dir, { recursive: true });
    const name = `render-${clip.id}-${new Date().toISOString().replace(/[:.]/g, '-')}.log`;
    const text = [`Stream to Shorts render log`, `clip: ${clip.id} (#${clip.num || '?'})`, `date: ${new Date().toISOString()}`,
      `estimate: ${JSON.stringify(job.estimate || null)}`, `stats: ${JSON.stringify(job.stats || null)}`, '',
      'command:', 'ffmpeg ' + args.map(a => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' '), '', 'error:', String(err.message)].join('\n');
    await fsp.writeFile(path.join(dir, name), text, 'utf8');
    const old = (await fsp.readdir(dir)).filter(n => n.endsWith('.log')).sort();
    for (const n of old.slice(0, Math.max(0, old.length - 20))) await fsp.rm(path.join(dir, n), { force: true }).catch(() => {});
    return path.join('projects', path.basename(repo.projDir(slug)), 'logs', name);
  }

  // Title and description inside an existing short, without re-encoding (a copy of the streams), after
  // its upload text changed. Returns true when the file was updated.
  async function updateMetadata(p, clip, outDir) {
    if (!clip.output) return false;
    const file = path.join(outDir, clip.output);
    if (!(await exists(file))) return false;
    const tmp = path.join(outDir, `.metadata_${clip.id}.mp4`);
    try {
      await ffmpeg.run(null, ['-hide_banner', '-v', 'error', '-y', '-i', file, '-map', '0', '-c', 'copy', ...metadataArgs(uploadText(p, clip)), '-movflags', '+faststart', tmp], { monitor: false });
      await fsp.rename(tmp, file);
      return true;
    } catch (e) {
      await fsp.rm(tmp, { force: true }).catch(() => {});
      throw e;
    }
  }

  // Remove half-written shorts (.rendering_*.mp4) left in output/ when the app was closed or crashed
  // during a render. Finished shorts are never touched. Call once at startup, before tasks resume.
  async function cleanupPartial() {
    let n = 0;
    const dirs = await fsp.readdir(outputDir, { withFileTypes: true }).catch(() => []);
    for (const d of dirs.filter(x => x.isDirectory())) {
      const names = await fsp.readdir(path.join(outputDir, d.name)).catch(() => []);
      for (const name of names.filter(x => /^\.(rendering|metadata)_.+\.mp4$/.test(x))) {
        await fsp.rm(path.join(outputDir, d.name, name), { force: true }).then(() => n++, () => {});
      }
    }
    return n;
  }

  return { render, draftFile, writeUploadText, outputDirOf, cleanupPartial, updateMetadata, validateOutput };
}

module.exports = { createRenderingService, DRAFT_SECONDS };
