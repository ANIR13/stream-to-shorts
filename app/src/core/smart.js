'use strict';
// Smart detection: a multi-signal scoring engine (optional; the fast engine in detection.js stays the
// default). Pure functions: no files, no programs, no network.
//
//   Score = wA·A + wV·V + wS·S + wE·E + wC·C   (weights normalized to sum to 1; result shown as 0-100)
//
//   A  audio excitement      loudness and sudden spikes (same measurements as the fast engine)
//   V  visual activity       on-screen change
//   S  semantic importance   what is said: gaming events, insights and facts, questions, numbers,
//                            the user's hint words, rare topic words, how much is said
//   E  emotion               laughter, excitement, surprise, frustration, enthusiasm (words, laughter
//                            tags from whisper, exclamations, stretched words, capitals)
//   C  context completeness  per clip: starts and ends on complete sentences, a question and its
//                            answer, a setup followed by a reaction, a story
//
// S and E come from the transcript (whisper), analysed with word lists in English and French and with
// language-independent cues; there is no language model. Each signal is a 0-1 value per second, so
// another analyser (for example a local language model) can replace or add a signal later without
// changing the rest. The default weights are starting points, not validated optimal values.

const { movingAvg, median, clampNum } = require('../shared/stats');
const Timing = require('../../public/timing.js');

const SMART_DEFAULTS = { engine: 'fast', wA: 0.20, wV: 0.15, wS: 0.35, wE: 0.20, wC: 0.10 };
const SIGNALS = ['audio', 'visual', 'semantic', 'emotion', 'context'];
const WEIGHT_KEYS = { audio: 'wA', visual: 'wV', semantic: 'wS', emotion: 'wE', context: 'wC' };

function smartSettings(d = {}) {
  const o = { engine: d.engine === 'smart' ? 'smart' : 'fast' };
  for (const k of ['wA', 'wV', 'wS', 'wE', 'wC']) o[k] = Math.round(clampNum(d[k], 0, 1, SMART_DEFAULTS[k]) * 100) / 100;
  if (!o.wA && !o.wV && !o.wS && !o.wE && !o.wC) Object.assign(o, { wA: 0.20, wV: 0.15, wS: 0.35, wE: 0.20, wC: 0.10 });
  return o;
}

// ---- text ----
// Lower case, no accents, curly quotes straightened; runs of 3+ identical letters become 2
// ("noooon" -> "noon", "gooo" -> "goo") and are reported as "stretched".
function normWord(raw) {
  const s = String(raw || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’`]/g, "'").toLowerCase();
  const core = s.replace(/^[^\p{L}\p{N}([]+|[^\p{L}\p{N})\]%']+$/gu, '');
  const stretched = /(\p{L})\1\1/u.test(core);
  return { t: core.replace(/(\p{L})\1{2,}/gu, '$1$1'), stretched };
}

const STOP = new Set(('the a an and or but so to of in on at for with is are was were be been it its this that these those i you he she we they me my your our their not no yes do does did have has had ' +
  'just like what when where who how why there here then than very really can could would should will about from into out up down over get got go going gonna ' +
  'le la les un une des du de et ou mais donc or ni car a au aux en dans sur pour par avec est sont etait etre ce cette ces il elle on nous vous ils elles je tu me te se ' +
  'mon ton son ma ta sa mes tes ses pas ne plus tres trop bien alors ca c\'est j\'ai qui que quoi comme tout tous faire fait').split(' '));

// Phrase lists. Each entry is matched as a sequence of normalized words (accents removed, so "génial"
// is written "genial"). Single words may end with * to match any ending ("kill*" = kill, killed, kills).
const LEX = {
  laughter: ['haha', 'hahaha', 'hehe', 'hihi', 'lol', 'lmao', 'xd', 'mdr', 'ptdr', 'rires', '(laughs)', '(laughing)', '[laughter]', '[laughs]', '(rires)', '*rires*'],
  excitement: ["let's go", 'lets go', "let's goo", 'oh my god', 'omg', 'no way', 'wow', 'insane', 'crazy', 'unbelievable', 'yes yes', 'yess', 'hype',
    "c'est ouf", 'ouf', 'incroyable', 'trop fort', 'trop bien', 'allez', 'vas-y', 'oh la la', 'on y va', 'genial', 'enorme', 'de ouf', 'dingue', 'masterclass'],
  surprise: ['wait what', 'whoa', 'wtf', 'seriously', 'are you kidding', 'attends', 'serieux', "c'est pas vrai", 'comment ca', 'quoi quoi', 'what the'],
  frustration: ['come on', 'damn', 'oh no', 'no no', 'noo', 'why why', 'merde', 'putain', "c'est pas possible", 'nul', "j'en ai marre", 'argh', 'rage', 'non non'],
  enthusiasm: ['love', 'amazing', 'awesome', 'perfect', 'beautiful', 'best', "j'adore", 'parfait', 'magnifique', 'le meilleur', 'trop beau', 'excellent', 'incredible'],
  event: ['kill*', 'headshot', 'ace', 'clutch*', 'victory', 'victoire', 'won', 'win', 'winner', 'gagne', 'gg', 'top 1', 'first place', 'premier', 'dead', 'died', 'die',
    'mort', 'tue', 'perdu', 'lost', 'defeat', 'defaite', 'boss', 'level up', 'ranked', 'triple', 'quadra', 'penta', 'double kill', 'team wipe', 'wipe', 'revive',
    'game over', 'one shot', 'sniper', 'last one', 'flawless', 'comeback', 'record', 'speedrun', 'checkmate', 'echec et mat', 'goal'],
  insight: ['did you know', 'fun fact', 'the secret', 'the trick', 'the key', "here's why", 'the reason', 'pro tip', 'tip', 'important', 'actually', 'in fact',
    'the truth', 'the problem', 'the thing is', 'never', 'always', 'le secret', "l'astuce", 'astuce', 'le truc', 'la cle', 'en fait', 'la verite', 'le probleme',
    'tu savais', 'vous saviez', 'conseil', 'jamais', 'toujours', 'en vrai', 'franchement', 'retenez', 'remember'],
  story: ['so', 'and then', 'anyway', 'long story', 'one day', 'once', 'story', 'suddenly', 'finally', 'et la', 'du coup', 'bref', 'un jour', 'histoire', 'soudain', 'enfin', 'et puis'],
  question: ['why', 'how', 'what', 'who', 'which', 'pourquoi', 'comment', 'qui', "est-ce que", 'combien'],
};
const normPat = w => (w.endsWith('*') ? normWord(w.slice(0, -1)).t + '*' : normWord(w).t || w);
const LEX_SPLIT = Object.fromEntries(Object.entries(LEX).map(([k, list]) => [k, list.map(p => p.split(' ').map(normPat))]));

// Words (from the transcript) -> one record per word with its matches.
function tagWords(words) {
  const toks = words.map(w => ({ ...normWord(w.w), raw: String(w.w || ''), s: w.s, e: w.e }));
  const tags = toks.map(() => []);
  const match = (tok, pat) => (pat.endsWith('*') ? tok.startsWith(pat.slice(0, -1)) : tok === pat);
  for (const [kind, phrases] of Object.entries(LEX_SPLIT)) {
    for (let i = 0; i < toks.length; i++) {
      for (const ph of phrases) {
        if (ph.every((p, k) => toks[i + k] && match(toks[i + k].t, p))) { tags[i].push({ kind, phrase: ph.join(' ') }); break; }
      }
    }
  }
  return toks.map((t, i) => ({
    ...t, tags: tags[i],
    exclaim: /!/.test(t.raw), ask: /\?/.test(t.raw), endSentence: /[.!?…]["»”]?$/.test(t.raw),
    caps: t.raw.length >= 3 && /\p{Lu}/u.test(t.raw) && t.raw === t.raw.toUpperCase() && /\p{L}{3}/u.test(t.raw),
    number: /\d/.test(t.t),
  }));
}

const clamp01 = v => Math.max(0, Math.min(1, v));
// For sparse signals (zero most of the time, like words of emotion): 1 = the strongest few percent of
// the stream, so a stream with little talk still has clear highs.
function scaleTop(arr, q = 0.97) {
  const max = Math.max(0, ...arr);
  if (!max) return arr.map(() => 0);
  const sorted = arr.filter(v => v > 0).sort((a, b) => a - b);
  const p = sorted[Math.floor(q * (sorted.length - 1))] || max;
  return arr.map(v => Math.min(1, Math.max(0, v) / p));
}

// ---- per-second signals ----
// rms, scene: the analysis (per second). words: transcript words [{w, s, e}]. hints: words the user
// expects (Captions & AI → words to expect, word fixes). Returns { A, V, S, E, tagged, n }.
function computeSignals({ rms, scene, words = [], hints = [] }) {
  const n = rms.length;
  const energy = rms.map(d => Math.pow(10, d / 10));
  const loud = movingAvg(energy, 12).map(v => 10 * Math.log10(v + 1e-12));
  const peak = rms.map((_, i) => Math.max(...rms.slice(Math.max(0, i - 2), i + 3)));
  // Physical thresholds rather than statistics: smoothed background noise is so regular that
  // "deviations above typical" would turn tiny wobbles into excitement.
  //   A: sustained loudness from 2 dB above the stream's usual level (full at 14 dB), and sudden
  //      peaks from 4 dB above (full at 18 dB)
  //   V: on-screen change above the usual amount (full when a quarter of the picture changes)
  const mLoud = median(loud), mPeak = median(peak);
  const A = loud.map((v, i) => clamp01(0.7 * clamp01((v - mLoud - 2) / 12) + 0.3 * clamp01((peak[i] - mPeak - 4) / 14)));
  const act = movingAvg(scene, 8), mAct = median(act);
  const V = act.map(v => clamp01((v - mAct - 0.02) / 0.25));
  const pz = peak.map(v => (v - mPeak) / 6);   // "a clear peak" for the excited-voice cue below

  const tagged = tagWords(words.filter(w => Number.isFinite(w.s) && Number.isFinite(w.e) && w.s < n + 1));
  const sec = w => Math.max(0, Math.min(n - 1, Math.floor(w.s)));
  const sem = new Array(n).fill(0), emo = new Array(n).fill(0), dens = new Array(n).fill(0);
  // how specific a word is in this stream: rare content words carry the topic
  const freq = new Map();
  for (const w of tagged) if (w.t.length >= 4 && !STOP.has(w.t)) freq.set(w.t, (freq.get(w.t) || 0) + 1);
  const total = Math.max(1, [...freq.values()].reduce((a, b) => a + b, 0));
  const hintSet = new Set(hints.map(h => normWord(h).t).filter(h => h.length >= 3));
  for (const w of tagged) {
    const i = sec(w);
    dens[i] += 1;
    const kinds = new Set(w.tags.map(t => t.kind));
    if (kinds.has('event')) sem[i] += 1.0;
    if (kinds.has('insight')) sem[i] += 0.8;
    if (w.ask || kinds.has('question')) sem[i] += 0.4;
    if (w.number) sem[i] += 0.3;
    if (hintSet.has(w.t)) sem[i] += 0.6;
    const f = freq.get(w.t);
    if (f) sem[i] += 0.15 * Math.max(0, Math.log(total / (f * 20)));      // only clearly rare words count
    if (kinds.has('laughter')) emo[i] += 1.0;
    if (kinds.has('excitement')) emo[i] += 0.8;
    if (kinds.has('surprise')) emo[i] += 0.5;
    if (kinds.has('frustration')) emo[i] += 0.6;
    if (kinds.has('enthusiasm')) emo[i] += 0.6;
    if (w.exclaim) emo[i] += 0.3;
    if (w.stretched) emo[i] += 0.4;
    if (w.caps) emo[i] += 0.3;
  }
  // speaking fast while it's loud: an excited voice
  const rate = movingAvg(dens, 4), mRate = median(rate.filter(v => v > 0)) || 0;
  for (let i = 0; i < n; i++) {
    if (dens[i]) sem[i] += 0.1 * Math.min(4, dens[i]);
    if (dens[i] && mRate && rate[i] > 1.4 * mRate && pz[i] > 1) emo[i] += 0.5;
  }
  const hasWords = tagged.length > 0;
  const S = hasWords ? scaleTop(movingAvg(sem, 6)) : new Array(n).fill(0);
  const E = hasWords ? scaleTop(movingAvg(emo, 4)) : new Array(n).fill(0);
  return { A, V, S, E, tagged, n };
}

// ---- context completeness of one window [s, e] ----
// Returns { value: 0-1, reasons: [...] }.
function contextOf(tagged, s, e) {
  const inside = tagged.filter(w => w.e > s && w.s < e);
  if (!inside.length) return { value: 0, reasons: [] };
  const reasons = [];
  let v = 0;
  const before = tagged.filter(w => w.e <= s + 0.05).pop();
  const after = tagged.find(w => w.s >= e - 0.05);
  const cut = (t) => tagged.some(w => w.s < t - 0.05 && w.e > t + 0.05);
  const cleanStart = !cut(s) && (!before || before.endSentence || inside[0].s - before.e >= 0.3);
  const lastIn = inside[inside.length - 1];
  const cleanEnd = !cut(e) && (lastIn.endSentence || !after || after.s - lastIn.e >= 0.3);
  if (cleanStart) v += 0.25;
  if (cleanEnd) v += 0.25;
  if (cleanStart && cleanEnd) reasons.push({ k: 'complete' });
  // a question and its answer
  const qi = inside.findIndex(w => w.ask || w.tags.some(t => t.kind === 'question'));
  if (qi >= 0) {
    const q = inside[qi];
    const answer = inside.slice(qi + 1).filter(w => w.s > q.e && w.s < q.e + 10);
    if (answer.length >= 3) { v += 0.2; reasons.push({ k: 'qa', t: q.s }); }
  }
  // a setup followed by a reaction (laughter, excitement, surprise) in the second half
  const mid = s + (e - s) / 2;
  const reaction = inside.find(w => w.s >= mid && w.tags.some(t => ['laughter', 'excitement', 'surprise'].includes(t.kind)));
  if (reaction && inside.filter(w => w.s < reaction.s).length >= 8) { v += 0.2; reasons.push({ k: 'punchline', t: reaction.s }); }
  // a story: a story marker early on, and the clip ends cleanly
  const story = inside.find(w => w.s < mid && w.tags.some(t => t.kind === 'story'));
  if (story && cleanEnd) { v += 0.1; reasons.push({ k: 'story', t: story.s }); }
  return { value: Math.round(Math.min(1, v) * 100) / 100, reasons };
}

// An edge inside a word moves to that word's start (clip start) or end (clip end).
function outsideWords(t, which, words) {
  const w = words.find(x => t > x.s + 1e-9 && t < x.e - 1e-9);
  return w ? (which === 'start' ? w.s : w.e) : t;
}

const mean = (arr, a, b) => { let s = 0, c = 0; for (let i = Math.max(0, a); i < Math.min(arr.length, b); i++) { s += arr[i]; c++; } return c ? s / c : 0; };
// Average of the strongest part of a window: a short great moment shouldn't be diluted by its lead-in.
const topMean = (arr, a, b, frac = 0.4) => {
  const v = arr.slice(Math.max(0, a), Math.min(arr.length, b)).sort((x, y) => y - x);
  const k = Math.max(1, Math.round(v.length * frac));
  return v.length ? v.slice(0, k).reduce((x, y) => x + y, 0) / k : 0;
};

// What made a window strong, for the "Why this moment?" panel (at most 8 reasons).
function reasonsOf(sig, s, e, parts, ctx) {
  const out = [];
  const seen = new Set();   // one reason per kind: the first time it happens in the clip
  const T = sig.tagged;
  for (let i = 0; i < T.length; i++) {
    const w = T[i];
    if (w.s < s || w.s >= e) continue;
    for (const t of w.tags) {
      if (!['event', 'insight', 'laughter', 'excitement', 'surprise', 'frustration', 'enthusiasm'].includes(t.kind) || seen.has(t.kind)) continue;
      seen.add(t.kind);
      // the words as spoken, for the whole matched phrase ("Did you know", not just "Did")
      const spoken = T.slice(i, i + t.phrase.split(' ').length).map(x => x.raw).join(' ');
      out.push({ k: t.kind, w: t.kind === 'laughter' ? undefined : spoken.replace(/[^\p{L}\p{N}' -]/gu, '').trim().slice(0, 30), t: Math.round(w.s * 10) / 10 });
    }
  }
  // at most 3 words, then the context reasons, so every kind of reason gets shown
  const quiet = parts.audio < 0.15 && (parts.semantic >= 0.35 || parts.emotion >= 0.35) ? [{ k: 'quiet' }] : [];
  return quiet.concat(out.slice(0, 3), ctx.reasons).slice(0, 8);
}

// ---- candidates ----
// opts: detectSettings (count, length, gap) + smartSettings (weights). words/hints optional: without a
// transcript, S, E and C are 0 and the result follows sound and action only.
function findSmartCandidates({ rms, scene, words = [], hints = [] }, opts = {}) {
  const { count, length, gap } = opts;
  const w = smartSettings(opts);
  const sig = computeSignals({ rms, scene, words, hints });
  const { n } = sig;
  if (!n) return [];
  const sumW = w.wA + w.wV + w.wS + w.wE + w.wC;
  const wSec = (w.wA + w.wV + w.wS + w.wE) || 1;
  const perSecond = sig.A.map((a, i) => (w.wA * a + w.wV * sig.V[i] + w.wS * sig.S[i] + w.wE * sig.E[i]) / wSec);
  const smooth = movingAvg(perSecond, 5);
  const L = Math.min(length, Math.max(10, n - 2));
  const segs = Timing.speechSegments(words);
  const order = smooth.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  const picked = [];
  const r2 = v => Math.round(v * 100) / 100;
  // best window of length L that contains second i (prefix sums of the per-second score)
  const pre = [0]; for (const v of perSecond) pre.push(pre[pre.length - 1] + v);
  const bestStart = i => {
    let best = Math.max(0, Math.min(i - L + 1, n - L)), bestSum = -1;
    for (let s0 = Math.max(0, i - L + 1); s0 <= Math.min(i, n - L); s0++) {
      const sum = pre[s0 + L] - pre[s0];
      if (sum > bestSum + 1e-9) { bestSum = sum; best = s0; }
    }
    return best;
  };
  for (const [, i] of order) {
    if (picked.length >= count * 3) break;
    let start = bestStart(i);
    let end = start + L;
    if (picked.some(c => start < c.end + gap && end > c.start - gap)) continue;
    // start and end on pauses in speech when there is one nearby; never in the middle of a word
    if (segs.length) {
      const a = Timing.snapEdge(start, 'start', { segs, duration: n });
      const b = Timing.snapEdge(end, 'end', { segs, duration: n });
      if (b.t - a.t >= 10 && b.t - a.t <= 60) { start = a.t; end = b.t; }
      start = outsideWords(start, 'start', words); end = Math.min(n, outsideWords(end, 'end', words));
    }
    if (picked.some(c => start < c.end + gap && end > c.start - gap)) continue;
    const a0 = Math.floor(start), b0 = Math.ceil(end);
    const ctx = contextOf(sig.tagged, start, end);
    const parts = {
      audio: r2(topMean(sig.A, a0, b0)), visual: r2(topMean(sig.V, a0, b0)),
      semantic: r2(topMean(sig.S, a0, b0)), emotion: r2(topMean(sig.E, a0, b0)), context: r2(ctx.value),
    };
    const raw = sumW ? (w.wA * parts.audio + w.wV * parts.visual + w.wS * parts.semantic + w.wE * parts.emotion + w.wC * parts.context) / sumW : 0;
    picked.push({ start, end, peak: i, raw, parts, reasons: reasonsOf(sig, start, end, parts, ctx) });
  }
  const weights = { audio: w.wA, visual: w.wV, semantic: w.wS, emotion: w.wE, context: w.wC };
  return picked
    .sort((x, y) => y.raw - x.raw || x.start - y.start)
    .slice(0, count)
    .map(c => ({ ...c, score: Math.round(100 * Math.max(0, Math.min(1, c.raw))), weights, engine: 'smart' }));
}

module.exports = { SMART_DEFAULTS, SIGNALS, WEIGHT_KEYS, smartSettings, normWord, tagWords, computeSignals, contextOf, findSmartCandidates, LEX, mean };
