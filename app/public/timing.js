// Clip timing rules — shared by the browser (timeline, editor) and the server (saving projects).
// Pure functions: no DOM, no files.
(function (root) {
  const MIN_CLIP = 2;      // seconds: the shortest clip the editor allows
  const SNAP_RANGE = 1.5;  // seconds: how far an edge may move to reach a pause in speech
  const r1 = v => Math.round(v * 10) / 10;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  // Words ({ w, s, e } in seconds) -> stretches of continuous speech [start, end, last word].
  // Words less than 0.25 s apart belong to the same stretch, so only real pauses separate them.
  function speechSegments(words) {
    const list = (words || []).filter(w => w && Number.isFinite(w.s) && Number.isFinite(w.e) && w.e >= w.s).sort((a, b) => a.s - b.s);
    const segs = [];
    for (const w of list) {
      const l = segs[segs.length - 1];
      if (l && w.s - l[1] < 0.25) { if (w.e >= l[1]) { l[1] = w.e; l[2] = w.w; } } else segs.push([w.s, w.e, w.w]);
    }
    return segs;
  }

  // Round to 0.1 s without leaving the pause [gs, ge] (rounding must never push an edge into a word).
  function roundInside(t, gs, ge) {
    let v = r1(t);
    if (v > ge) v = r1(v - 0.1);
    if (v < gs) v = r1(v + 0.1);
    return v >= gs && v <= ge ? v : t;
  }

  // Move a clip edge near t to a pause in speech, so clips don't start or end mid-word.
  // which: 'start' | 'end'. opts: { segs (speechSegments), duration, loudNorm (0..1 per second), range }.
  // Returns { t } unchanged when there's nothing better nearby, else { t, how }.
  function snapEdge(t, which, opts = {}) {
    const segs = opts.segs || [];
    const duration = Number(opts.duration) || Infinity;
    const range = opts.range || SNAP_RANGE;
    if (segs.length) {
      let best = null;
      for (let i = -1; i < segs.length; i++) {
        const gs = i < 0 ? 0 : segs[i][1], ge = i + 1 < segs.length ? segs[i + 1][0] : duration;
        if (ge < t - range) continue;
        if (gs > t + range) break;
        // start just before the next words, end just after the last ones
        const target = which === 'start' ? Math.max(gs, ge - 0.15) : Math.min(ge, gs + 0.3);
        const d = Math.abs(target - t);
        if (d > range) continue;
        const sentence = i >= 0 && /[.!?…]["»”]?$/.test(segs[i][2] || '');
        const score = d - (sentence ? 0.5 : 0);
        if (!best || score < best.score) best = { t: roundInside(target, gs, ge), score, how: sentence ? 'end of a sentence' : 'pause in speech' };
      }
      if (best) return { t: best.t, how: best.how };
      if (segs.some(g => t > g[0] - range && t < g[1] + range)) return { t }; // talking without a pause here
    }
    const L = opts.loudNorm;
    if (L && L.length) {
      // no words known here: use the quietest second nearby
      const a = Math.max(0, Math.floor(t - range)), b = Math.min(L.length - 1, Math.ceil(t + range));
      const here = L[clamp(Math.floor(t), 0, L.length - 1)];
      let mi = clamp(Math.round(t), a, b);
      for (let i = a; i <= b; i++) if (L[i] < L[mi]) mi = i;
      if (L[mi] < here - 0.1) return { t: r1(mi + 0.5), how: 'quiet moment' };
    }
    return { t };
  }

  // Set one edge of a clip to t, keeping 0 <= start < end <= duration and at least MIN_CLIP seconds
  // (or the whole video when it is shorter). Returns the new { start, end }; the clip isn't changed.
  function setEdge(clip, which, t, duration) {
    const dur = Number(duration) > 0 ? Number(duration) : Infinity;
    const min = Math.min(MIN_CLIP, dur);
    let start = clip.start, end = clip.end;
    t = r1(clamp(Number(t) || 0, 0, dur));
    if (which === 'start') start = Math.max(0, Math.min(t, r1(end - min)));
    else end = Math.min(dur, Math.max(t, r1(start + min)));
    return normalize({ start, end }, dur);
  }

  // Valid times for any clip: numbers, inside the video, start before end, at least MIN_CLIP long.
  // Used when a project is saved, so a bad value from anywhere can't reach the renderer.
  function normalize(clip, duration) {
    const dur = Number(duration) > 0 ? Number(duration) : Infinity;
    const min = Math.min(MIN_CLIP, dur);
    let s = Number(clip.start), e = Number(clip.end);
    if (!Number.isFinite(s)) s = 0;
    if (!Number.isFinite(e)) e = s + min;
    if (e < s) [s, e] = [e, s];
    s = clamp(s, 0, dur); e = clamp(e, 0, dur);
    if (e - s < min) { e = Math.min(dur, s + min); s = Math.max(0, e - min); }
    return { start: s, end: e };
  }

  const api = { MIN_CLIP, SNAP_RANGE, speechSegments, snapEdge, setEdge, normalize, roundInside };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Timing = api;
})(this);
