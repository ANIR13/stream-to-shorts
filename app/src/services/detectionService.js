'use strict';
// Detection service: analyzes a recording (loudness, on-screen action, preview copy) and turns the
// analysis into suggested clips.
const fsp = require('fs').promises;
const path = require('path');
const { round1, exists, readJSON, writeJSON } = require('../shared/fsutil');
const { httpError } = require('../shared/errors');
const { detectSettings, findCandidates, candidatesToClips, mergeDetected, parseMeta } = require('../core/detection');
const { audioMix } = require('../infrastructure/ffmpeg');
const { smartSettings, findSmartCandidates } = require('../core/smart');

// The preview copy played in the app: 360p (fast to build, light) or 720p (sharper player and 9:16 preview).
const proxyHeight = p => (Number(p.proxyHeight) === 720 ? 720 : 360);
const proxyEnc = h => ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', h === 720 ? '25' : '28', '-g', '60',
  '-c:a', 'aac', '-b:a', '96k', '-ac', '2', '-movflags', '+faststart'];

// fingerprint(file): see infrastructure/fingerprint.js (optional); partSeconds: length of an analysis part;
// parallelParts: parts analyzed at once.
function createDetectionService({ repo, ffmpeg, sourceDir, fingerprint = null, partSeconds = 900, parallelParts = 1 }) {
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

  // Measure loudness per second, scan on-screen action, build the preview copy; suggest clips if the
  // project has none yet. Long recordings are done in parts of `partSeconds` (15 min): each part is one
  // pass over its piece of the file (loudness + action + its piece of the preview), several parts run
  // at once, and finished parts are kept, so an interrupted analysis continues where it stopped.
  async function analyze(job, slug) {
    const p = await repo.load(slug);
    const dir = repo.projDir(slug);
    const src = path.join(sourceDir, p.video);
    const dur = p.meta.duration;
    const ph = proxyHeight(p);
    const fp = fingerprint ? await fingerprint(src) : null;
    const partsDir = path.join(dir, 'analysis-parts');
    const state = await readJSON(path.join(partsDir, 'state.json'), null);
    if (!state || state.fingerprint !== fp || state.height !== ph || state.part !== partSeconds || state.audio !== !!p.meta.hasAudio) {
      await fsp.rm(partsDir, { recursive: true, force: true });   // other file or settings: start over
    }
    await fsp.mkdir(partsDir, { recursive: true });
    await writeJSON(path.join(partsDir, 'state.json'), { fingerprint: fp, height: ph, part: partSeconds, audio: !!p.meta.hasAudio });

    const n = Math.max(1, Math.ceil(dur / partSeconds));
    const parts = Array.from({ length: n }, (_, i) => ({ i, start: i * partSeconds, length: Math.min(partSeconds, dur - i * partSeconds) }));
    const isDone = async q => (await exists(path.join(partsDir, `part_${q.i}.json`))) && (await exists(path.join(partsDir, `part_${q.i}.mp4`)));
    const todo = [];
    for (const q of parts) if (!(await isDone(q))) todo.push(q);
    const resumed = n - todo.length;
    job.message = n === 1 ? 'Measuring loudness, scanning action, building preview' : resumed ? `Analyzing: ${resumed} of ${n} parts already done` : `Analyzing in ${n} parts`;

    // progress of the parts running now; cancelling the task stops every part (job.children)
    const mix = audioMix(p.meta, '[mixed]');   // several audio tracks: analyze and preview the mix
    const running = new Map();
    job.children = new Set();
    const report = () => { const now = [...running.values()].reduce((x, r) => x + r.progress, 0); job.progress = Math.min(0.97, (resumed + doneHere + now) / n); };
    let doneHere = 0;
    const one = async q => {
      const sub = { id: `${job.id}.${q.i}`, progress: 0, get cancelled() { return job.cancelled; }, set child(c) { if (c) job.children.add(c); } };
      running.set(q.i, sub);
      const fc = `[0:v]fps=30,scale=-2:${ph},format=yuv420p[p];[0:v]fps=2,scale=160:-2,select='gte(scene,0)',metadata=print:key=lavfi.scene_score:file=scene_${q.i}.txt,nullsink`
        + (p.meta.hasAudio ? `;${mix ? mix + ';[mixed]asplit=2[ma][pa];[ma]' : '[0:a]'}aresample=8000,asetnsamples=8000,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=rms_${q.i}.txt,anullsink` : '');
      const tick = setInterval(report, 500);
      try {
        await ffmpeg.run(sub, ['-hide_banner', '-nostats', '-progress', 'pipe:1', '-y', '-ss', String(q.start), '-t', String(q.length), '-i', src,
          '-filter_complex', fc, '-map', '[p]', '-map', mix ? '[pa]' : '0:a?', ...proxyEnc(ph), `part_${q.i}.tmp.mp4`], { cwd: partsDir, duration: q.length });
      } finally { clearInterval(tick); }
      const len = Math.ceil(q.length);
      const rms = new Array(len).fill(-90), scene = new Array(len).fill(0);
      if (p.meta.hasAudio) for (const [t, v] of parseMeta(await fsp.readFile(path.join(partsDir, `rms_${q.i}.txt`), 'utf8'), 'lavfi.astats.Overall.RMS_level')) {
        const k = Math.min(len - 1, Math.floor(t)); rms[k] = round1(v);
      }
      for (const [t, v] of parseMeta(await fsp.readFile(path.join(partsDir, `scene_${q.i}.txt`), 'utf8'), 'lavfi.scene_score')) {
        const k = Math.min(len - 1, Math.floor(t)); scene[k] = Math.max(scene[k], Math.round(v * 1000) / 1000);
      }
      await fsp.rename(path.join(partsDir, `part_${q.i}.tmp.mp4`), path.join(partsDir, `part_${q.i}.mp4`));
      await writeJSON(path.join(partsDir, `part_${q.i}.json`), { rms, scene });   // written last: the part is done
      await fsp.rm(path.join(partsDir, `rms_${q.i}.txt`), { force: true }).catch(() => {});
      await fsp.rm(path.join(partsDir, `scene_${q.i}.txt`), { force: true }).catch(() => {});
      running.delete(q.i); doneHere++; report();
    };
    // several parts at once on big computers (each is a full ffmpeg pass)
    const width = Math.max(1, Math.min(parallelParts, todo.length));
    let next = 0, failure = null;
    await Promise.all(Array.from({ length: width }, async () => {
      while (!failure && next < todo.length && !job.cancelled) {
        const q = todo[next++];
        try { await one(q); } catch (e) { failure = failure || e; for (const c of job.children) { try { c.kill(); } catch { /* gone */ } } }
      }
    }));
    if (failure) throw failure;
    if (job.cancelled) throw new Error('Cancelled');

    // the parts become one analysis and one preview copy (joined without re-encoding)
    job.message = n > 1 ? 'Joining the parts' : 'Saving';
    const rms = [], scene = [];
    for (const q of parts) {
      const part = await readJSON(path.join(partsDir, `part_${q.i}.json`), null);
      if (!part) throw new Error('An analysis part is missing. Analyze again.');
      rms.push(...part.rms); scene.push(...part.scene);
    }
    const total = Math.ceil(dur);
    rms.length = scene.length = total;
    for (let i = 0; i < total; i++) { if (rms[i] == null) rms[i] = -90; if (scene[i] == null) scene[i] = 0; }
    if (n === 1) await fsp.rename(path.join(partsDir, 'part_0.mp4'), path.join(dir, 'proxy.tmp.mp4'));
    else {
      await fsp.writeFile(path.join(partsDir, 'parts.txt'), parts.map(q => `file 'part_${q.i}.mp4'`).join('\n') + '\n');
      await ffmpeg.run(job, ['-hide_banner', '-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', 'parts.txt', '-c', 'copy', '-movflags', '+faststart', path.join(dir, 'proxy.tmp.mp4')], { cwd: partsDir });
    }
    await fsp.rename(path.join(dir, 'proxy.tmp.mp4'), path.join(dir, 'proxy.mp4'));
    await repo.writeAnalysis(slug, { rms, scene, created: Date.now(), fingerprint: fp });
    await repo.update(slug, q => {
      q.analyzed = true;
      q.proxyVer = Date.now(); q.proxyBuiltHeight = ph;
      if (fp) q.sourceFingerprint = fp;
      if (!q.clips.length) q.clips = candidatesToClips(findCandidates(rms, scene, q.detect));
    });
    await fsp.rm(partsDir, { recursive: true, force: true }).catch(() => {});
    job.children = null;
  }

  // Loudness every 0.1 s for the detailed waveform of the zoomed-in timeline (a background task after
  // the analysis). Stored as one byte per step: 0 = -60 dB or quieter, 255 = 0 dB.
  async function waveform(job, slug) {
    const p = await repo.load(slug);
    if (!p.meta.hasAudio) return;
    const dir = repo.projDir(slug);
    job.message = 'Building the detailed waveform';
    const mix = audioMix(p.meta, '[mixed]');
    const chain = 'aresample=8000,asetnsamples=800,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.Peak_level:file=wave.txt';
    await ffmpeg.run(job, ['-hide_banner', '-nostats', '-progress', 'pipe:1', '-y', '-i', path.join(sourceDir, p.video), '-vn',
      ...(mix ? ['-filter_complex', `${mix};[mixed]${chain}[w]`, '-map', '[w]'] : ['-af', chain]),
      '-f', 'null', '-'], { cwd: dir, duration: p.meta.duration });
    const steps = Math.ceil(p.meta.duration * 10);
    const bytes = Buffer.alloc(steps);
    for (const [t, v] of parseMeta(await fsp.readFile(path.join(dir, 'wave.txt'), 'utf8'), 'lavfi.astats.Overall.Peak_level')) {
      const k = Math.min(steps - 1, Math.round(t * 10));
      bytes[k] = Math.max(bytes[k], Math.max(0, Math.min(255, Math.round((v + 60) / 60 * 255))));
    }
    await writeJSON(path.join(dir, 'waveform.json'), { step: 0.1, fingerprint: p.sourceFingerprint || null, data: bytes.toString('base64') });
    await fsp.rm(path.join(dir, 'wave.txt'), { force: true }).catch(() => {});
  }

  // Suggest clips from the analysis with the given settings; mode 'replace' or 'add'.
  // settings.engine: 'fast' (sound and action) or 'smart' (also what is said: needs the transcript).
  async function detect(slug, settings, mode) {
    const a = await repo.readAnalysis(slug);
    if (!a) throw httpError(400, 'Analyze the video first');
    if (fingerprint && a.fingerprint) {
      const p0 = await repo.load(slug);
      const now = await fingerprint(path.join(sourceDir, p0.video)).catch(() => null);
      if (now && !require('../infrastructure/fingerprint').sameContent(now, a.fingerprint)) throw httpError(409, 'The video file changed since it was analyzed. Analyze it again first.');
    }
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

  return { analyze, waveform, buildProxy, detect };
}

module.exports = { createDetectionService, proxyHeight };
