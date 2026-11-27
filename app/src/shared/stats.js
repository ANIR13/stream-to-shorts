'use strict';
// Small numeric helpers for signal analysis.

const median = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] || 0; };

// Centered moving average over a window of w samples.
function movingAvg(a, w) {
  const out = new Array(a.length); const h = Math.floor(w / 2);
  const pre = [0]; for (const v of a) pre.push(pre[pre.length - 1] + v);
  for (let i = 0; i < a.length; i++) {
    const lo = Math.max(0, i - h), hi = Math.min(a.length, i + h + 1);
    out[i] = (pre[hi] - pre[lo]) / (hi - lo);
  }
  return out;
}

// Robust z-score: distance from the median in units of (scaled) median absolute deviation.
function zscore(a) {
  const m = median(a); const mad = median(a.map(v => Math.abs(v - m))) || 1;
  return a.map(v => (v - m) / (1.4826 * mad));
}

// A number clamped to [lo, hi], or def when it isn't a number.
const clampNum = (v, lo, hi, def) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def; };

module.exports = { median, movingAvg, zscore, clampNum };
