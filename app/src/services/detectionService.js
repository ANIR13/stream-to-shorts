'use strict';
// Detection service: analyzes a recording (loudness, on-screen action, preview copy) and turns the
// analysis into suggested clips.
const fsp = require('fs').promises;
const path = require('path');
const { round1 } = require('../shared/fsutil');
const { httpError } = require('../shared/errors');
const { detectSettings, findCandidates, candidatesToClips, mergeDetected, parseMeta } = require('../core/detection');
const { smartSettings, findSmartCandidates } = require('../core/smart');

// The preview copy played in the app: 360p (fast to build, light) or 720p (sharper player and 9:16 preview).
const proxyHeight = p => (Number(p.proxyHeight) === 720 ? 720 : 360);
const proxyEnc = h => ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', h === 720 ? '25' : '28', '-g', '60',
  '-c:a', 'aac', '-b:a', '96k', '-ac', '2', '-movflags', '+faststart'];

function createDetectionService({ repo, ffmpeg, sourceDir }) {
  // Rebuild only the preview copy (after changing the preview quality).
  async function buildProxy(job, slug) {
    const p = await repo.load(slug);
    const dir = repo.projDir(slug), h = proxyHeight(p);
    job.message = 'Building preview';
    try {
      await ffmpeg.run(job, ['-hide_banner', '-nostats', '-progress', 'pipe:1', '-y', '-i', path.join(sourceDir, p.video),
        '-vf', `fps=30,scale=-2:${h},format=yuv420p`, '-map', '0:v:0', '-map', '0:a?', ...proxyEnc(h), 'proxy.tmp.mp4'],
      { cwd: dir, duration: p.meta.duration });
    } catch (e) { await fsp.rm(path.join(dir, 'proxy.tmp.mp4'), { force: true }).catch(() => {}); throw e; }
    await fsp.rename(path.join(dir, 'proxy.tmp.mp4'), path.join(dir, 'proxy.mp4'));
    await repo.update(slug, q => { q.proxyVer = Date.now(); q.proxyBuiltHeight = h; });
  }

  // Measure loudness per second, scan on-screen action, build the preview copy; suggest clips
  // if the project has none yet.
  async function analyze(job, slug) {
    const p = await repo.load(slug);
    const dir = repo.projDir(slug);
    const src = path.join(sourceDir, p.video);
    const dur = p.meta.duration;

    job.message = 'Measuring audio loudness';
    if (p.meta.hasAudio) {
      await ffmpeg.run(job, ['-hide_banner', '-nostats', '-progress', 'pipe:1', '-y', '-i', src, '-vn',
        '-af', 'aresample=8000,asetnsamples=8000,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=rms.txt',
        '-f', 'null', '-'], { cwd: dir, duration: dur, base: 0, span: 0.2 });
    }

    job.message = 'Building fast preview + scanning action';
    const ph = proxyHeight(p);
    const fc = `[0:v]fps=30,scale=-2:${ph},format=yuv420p[p];[0:v]fps=2,scale=160:-2,select='gte(scene,0)',metadata=print:key=lavfi.scene_score:file=scene.txt,nullsink`;
    await ffmpeg.run(job, ['-hide_banner', '-nostats', '-progress', 'pipe:1', '-y', '-i', src, '-filter_complex', fc,
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
    await repo.writeAnalysis(slug, { rms, scene, created: Date.now() });
    await repo.update(slug, q => {
      q.analyzed = true;
      q.proxyVer = Date.now(); q.proxyBuiltHeight = ph;
      if (!q.clips.length) q.clips = candidatesToClips(findCandidates(rms, scene, q.detect));
    });
  }

  // Suggest clips from the analysis with the given settings; mode 'replace' or 'add'.
  // settings.engine: 'fast' (sound and action) or 'smart' (also what is said: needs the transcript).
  async function detect(slug, settings, mode) {
    const a = await repo.readAnalysis(slug);
    if (!a) throw httpError(400, 'Analyze the video first');
    const opts = { ...detectSettings(settings), ...smartSettings(settings) };
    let fresh;
    if (opts.engine === 'smart') {
      const t = await repo.readTranscript(slug);
      if (!t || !Array.isArray(t.words) || !t.words.length) throw httpError(400, 'Smart detection needs the transcript of the whole stream. Click "Transcribe whole stream" in the Captions & AI tab first, or use Fast detection.');
      const p = await repo.load(slug);
      const hints = String(p.whisper.prompt || '').split(/[\s,;]+/).concat((p.whisper.fixes || []).map(f => f.to)).filter(Boolean);
      const words = t.words.concat((t.events || []).map(ev => ({ w: ev.w, s: ev.s, e: ev.e })));
      fresh = findSmartCandidates({ rms: a.rms, scene: a.scene, words, hints }, opts);
    } else fresh = findCandidates(a.rms, a.scene, opts);
    return repo.update(slug, q => {
      q.detect = opts;
      q.clips = mergeDetected(q.clips, candidatesToClips(fresh), mode);
    });
  }

  return { analyze, buildProxy, detect };
}

module.exports = { createDetectionService, proxyHeight };
