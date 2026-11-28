'use strict';
// Transcription service: speech recognition with whisper.cpp and caption generation for clips.
const fsp = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const Layout = require('../../public/layout.js');
const { exists, readJSON, writeJSON } = require('../shared/fsutil');
const { whisperKey, applyFixes, dropEcho, parseWhisper, parseWhisperEvents, chunkWords, keepChunks } = require('../core/captions');

const shortHash = s => crypto.createHash('md5').update(s).digest('hex').slice(0, 8);

// whisperPath: whisper-cli program (or null when not installed); modelsDir: ggml-*.bin models.
function createTranscriptionService({ repo, ffmpeg, runner, whisperPath, modelsDir, threads, sourceDir, isWin }) {
  const available = !!whisperPath;

  // Words spoken between start and end (seconds). Uses the whole-stream transcript when it covers
  // the range, else a per-range cache, else runs whisper on that part of the audio.
  const transcribeRange = (...args) => transcribeRangeFull(...args).then(r => r.words);
  // Same, with whisper's non-speech tags (laughter, applause…): { words, events }.
  async function transcribeRangeFull(job, slug, start, end, w, base = 0, span = 1) {
    if (!whisperPath) throw new Error(isWin ? 'whisper-cli.exe not found in tools/whisper' : 'whisper-cli not found (tools/whisper/whisper-cli or on the PATH)');
    const model = path.join(modelsDir, w.model);
    if (!(await exists(model))) throw new Error(`Speech model not found: tools/whisper/models/${w.model}`);
    const dir = repo.fileIn(slug, 'transcripts');
    await fsp.mkdir(dir, { recursive: true });
    const key = whisperKey(w);

    const full = await readJSON(path.join(dir, 'full.json'), null);
    if (full && full.key === key && start >= full.start && end <= full.end) {
      return { words: full.words.filter(x => x.e > start && x.s < end), events: (full.events || []).filter(x => x.e > start && x.s < end) };
    }
    const name = `r_${Math.round(start * 10)}_${Math.round(end * 10)}_${shortHash(key)}`;
    const cached = await readJSON(path.join(dir, name + '.json'), null);
    if (cached) return { words: cached.words, events: cached.events || [] };

    const p = await repo.load(slug);
    const src = path.join(sourceDir, p.video);
    job.message = 'Extracting audio';
    await ffmpeg.run(job, ['-hide_banner', '-nostats', '-progress', 'pipe:1', '-y', '-ss', String(start), '-t', String(end - start),
      '-i', src, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', name + '.wav'],
    { cwd: dir, duration: end - start, base, span: span * 0.1 });
    job.message = 'Transcribing speech (AI)';
    const args = ['-m', model, '-f', name + '.wav', '-l', w.language || 'auto', '-t', String(threads),
      '-ml', '1', '-sow', '-oj', '-of', name + '.w', '-pp'];
    if (w.translate) args.push('-tr');
    if (w.prompt && String(w.prompt).trim()) args.push('--prompt', String(w.prompt).trim());
    await runner.runProc(job, whisperPath, args, {
      cwd: dir,
      onStderr: s => {
        const m = [...s.matchAll(/progress\s*=\s*(\d+)%/g)].pop();
        if (m) job.progress = base + span * (0.1 + 0.9 * Number(m[1]) / 100);
      },
    });
    const raw = await fsp.readFile(path.join(dir, name + '.w.json'));
    const j = JSON.parse(raw.toString('utf8'));
    const words = parseWhisper(j, start);
    const events = parseWhisperEvents(j, start);
    await writeJSON(path.join(dir, name + '.json'), { key, start, end, language: j.result && j.result.language, words, events });
    await fsp.unlink(path.join(dir, name + '.wav')).catch(() => {});
    await fsp.unlink(path.join(dir, name + '.w.json')).catch(() => {});
    return { words, events };
  }

  // Caption lines for one clip.
  // merge = true: after a retrim, keep existing (possibly hand-edited) captions and only
  // transcribe the seconds that were added. merge = false: transcribe everything again.
  async function captionClip(job, slug, clipId, base = 0, span = 1, { merge = false } = {}) {
    const p = await repo.load(slug);
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
    await repo.update(slug, q => {
      const c = q.clips.find(x => x.id === clipId);
      if (c) { c.captions = chunks; c.captionsRange = [clip.start, clip.end]; c.captionsVer = (c.captionsVer || 0) + 1; }
    });
    return chunks;
  }

  // Transcribe the whole recording once (makes every clip's captions instant, enables search).
  async function transcribeAll(job, slug) {
    const p = await repo.load(slug);
    const r = await transcribeRangeFull(job, slug, 0, p.meta.duration, p.whisper);
    const words = dropEcho(r.words, p.whisper.prompt);
    await writeJSON(repo.fileIn(slug, 'transcripts', 'full.json'), { key: whisperKey(p.whisper), start: 0, end: p.meta.duration, words, events: r.events });
  }

  return { available, transcribeRange, captionClip, transcribeAll };
}

module.exports = { createTranscriptionService };
