'use strict';
// Rendering service: turns a clip into a finished vertical short (or a 10-second quick draft).
const fsp = require('fs').promises;
const path = require('path');
const Layout = require('../../public/layout.js');
const { slugify } = require('../shared/fsutil');
const { buildASS, buildFilter, draftFilter, shortName, cpuEncoderArgs } = require('../core/render');
const { uploadText, txtName, uploadTextFile } = require('../core/upload');

const DRAFT_SECONDS = 10;

// transcription: the transcription service (captions are generated before rendering when missing).
function createRenderingService({ repo, ffmpeg, transcription, outputDir, sourceDir, log = console }) {
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

    // The part of the source to render (the whole clip, or a 10 s window for a draft).
    let seg = clip;
    if (draft) {
      const from = Math.min(Math.max(Number(draft.from) || clip.start, clip.start), Math.max(clip.start, clip.end - DRAFT_SECONDS));
      seg = { ...clip, start: from, end: Math.min(clip.end, from + DRAFT_SECONDS) };
    }
    const dur = Math.round((seg.end - seg.start) * 100) / 100;
    const work = repo.fileIn(slug, draft ? 'drafts' : 'render', clip.id);
    await fsp.mkdir(work, { recursive: true });
    const hasTitle = !!(clip.title1 || clip.title2);
    const L = Layout.compute(ep.layout, p.meta, ep.style, hasTitle);
    await fsp.writeFile(path.join(work, 'subs.ass'), '﻿' + buildASS(ep, seg, L, dur), 'utf8');
    let filter = buildFilter(ep, L, dur);
    if (draft) filter = draftFilter(filter);
    await fsp.writeFile(path.join(work, 'filter.txt'), filter);

    const outDir = draft ? repo.fileIn(slug, 'drafts') : outputDirOf(slug);
    await fsp.mkdir(outDir, { recursive: true });
    const outName = draft ? `${clip.id}.mp4` : shortName(clip);
    const tmp = path.join(outDir, `.rendering_${clip.id}${draft ? '_draft' : ''}.mp4`);
    job.message = draft ? 'Rendering quick draft' : 'Rendering video';
    const crf = Number(ep.style.crf) || 20;
    const cpu = cpuEncoderArgs(!!draft, crf);
    await ffmpeg.detectHardware();
    const gpu = !draft && ep.style.encoder === 'gpu' ? ffmpeg.gpuArgs(crf) : null;
    const encode = enc => ffmpeg.run(job, ['-hide_banner', '-nostats', '-progress', 'pipe:1', '-y',
      '-ss', String(seg.start), '-t', String(dur), '-i', path.join(sourceDir, p.video),
      ffmpeg.filterArg, 'filter.txt', '-map', '[v]', '-map', '[a]',
      ...enc, '-movflags', '+faststart', '-t', String(dur), tmp],
    { cwd: work, duration: dur, base, span: 1 - base });
    try {
      if (gpu) {
        try { await encode([...gpu, '-c:a', 'aac', '-b:a', '160k']); }
        catch (e) {
          if (job.cancelled) throw e;
          job.message = 'Graphics encoder failed, using the processor';
          log.error(`[job ${job.id}] GPU encode failed, retrying on CPU: ${e.message.split('\n')[0]}`);
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
    await repo.update(slug, q => {
      const c = q.clips.find(x => x.id === clipId);
      if (c) { c.output = outName; c.renderedAt = Date.now(); c.renderSig = sig; }
    });
    await writeUploadText(p, { ...clip, output: outName }, outDir).catch(e => log.error('upload text: ' + e.message));
  }

  // Remove half-written shorts (.rendering_*.mp4) left in output/ when the app was closed or crashed
  // during a render. Finished shorts are never touched. Call once at startup, before tasks resume.
  async function cleanupPartial() {
    let n = 0;
    const dirs = await fsp.readdir(outputDir, { withFileTypes: true }).catch(() => []);
    for (const d of dirs.filter(x => x.isDirectory())) {
      const names = await fsp.readdir(path.join(outputDir, d.name)).catch(() => []);
      for (const name of names.filter(x => /^.rendering_.+.mp4$/.test(x))) {
        await fsp.rm(path.join(outputDir, d.name, name), { force: true }).then(() => n++, () => {});
      }
    }
    return n;
  }

  return { render, draftFile, writeUploadText, outputDirOf, cleanupPartial };
}

module.exports = { createRenderingService, DRAFT_SECONDS };
