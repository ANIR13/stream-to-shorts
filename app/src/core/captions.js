'use strict';
// Caption text processing: word fixes, hint-word echo removal, whisper output parsing, caption lines.
// Pure functions (no files, no programs).

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
// Apply word fixes to caption lines in place; returns how many places changed.
function fixChunks(chunks, fixes) {
  let count = 0;
  for (const ch of chunks || []) { const r = applyFixes(ch.words, fixes); ch.words = r.words; count += r.count; }
  return count;
}

// whisper-cli JSON (-oj, one segment per word with -ml 1) -> [{ w, s, e }] in seconds from `offset`.
function parseWhisper(j, offset) {
  const words = [];
  for (const seg of j.transcription || []) {
    const text = String(seg.text || '').replace(/�/g, '').trim();
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

// Words -> caption lines of at most maxWords, breaking at pauses and punctuation.
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

module.exports = { whisperKey, normFixes, applyFixes, echoMask, dropEcho, stripEchoChunks, fixChunks, parseWhisper, chunkWords, keepChunks };
