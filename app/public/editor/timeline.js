'use strict';
// The timeline (zoom, drag, clip edges) and speech-aware trimming.

const tl = { cv: $('#timeline'), drag: null, hover: null };
tl.cv.tabIndex = 0;
tl.cv.setAttribute('role', 'application');
tl.cv.setAttribute('aria-label', 'Timeline. Left and right arrows seek, I and O set the clip start and end, comma and period move the selected clip, plus and minus zoom.');
function tlSize() {
  const r = tl.cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  if (tl.cv.width !== Math.round(r.width * dpr)) { tl.cv.width = Math.round(r.width * dpr); tl.cv.height = Math.round(r.height * dpr); }
  return { w: r.width, h: r.height, dpr };
}
const t2x = (t, w) => (t - S.view[0]) / (S.view[1] - S.view[0]) * w;
const x2t = (x, w) => S.view[0] + x / w * (S.view[1] - S.view[0]);
function drawTimeline() {
  if (!S.p) return;
  const { w, h, dpr } = tlSize();
  const ctx = tl.cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const [v0, v1] = S.view, span = v1 - v0;
  // ticks
  const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800];
  const step = steps.find(s => s / span * w >= 70) || 3600;
  ctx.fillStyle = '#5c6170'; ctx.font = '10px Segoe UI'; ctx.textBaseline = 'top';
  for (let t = Math.ceil(v0 / step) * step; t <= v1; t += step) {
    const x = t2x(t, w);
    ctx.fillRect(x, 0, 1, 6);
    ctx.fillText(fmt(t, false), x + 3, 1);
  }
  // loudness
  const top = 16, bh = h - top - 4;
  if (S.loudNorm) {
    const L = S.loudNorm, sc = S.analysis.scene;
    ctx.fillStyle = '#3b4252';
    for (let x = 0; x < w; x++) {
      const a = Math.floor(x2t(x, w)), b = Math.max(a + 1, Math.floor(x2t(x + 1, w)));
      let m = 0; for (let i = a; i < b && i < L.length; i++) if (L[i] > m) m = L[i];
      const y = bh * m;
      ctx.fillRect(x, top + bh - y, 1, y);
    }
    ctx.strokeStyle = 'rgba(90,169,255,.55)'; ctx.lineWidth = 1; ctx.beginPath();
    for (let x = 0; x < w; x += 2) {
      const i = Math.floor(x2t(x, w));
      const y = top + bh - clamp((sc[i] || 0) * 3, 0, 1) * bh * 0.6;
      x ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();
  } else {
    ctx.fillStyle = '#5c6170'; ctx.font = '12px Segoe UI';
    ctx.fillText(tr('Analyze the video to see loudness and action here'), 10, h / 2 - 6);
  }
  // ruler strip (drag it to pan)
  ctx.fillStyle = 'rgba(255,255,255,.035)'; ctx.fillRect(0, 0, w, 15);
  // clips
  S.p.clips.forEach(c => {
    const x0 = t2x(c.start, w), x1 = t2x(c.end, w);
    if (x1 < 0 || x0 > w) return;
    const active = c.id === S.sel;
    ctx.fillStyle = active ? 'rgba(255,212,0,.22)' : 'rgba(255,212,0,.09)';
    ctx.fillRect(x0, top, x1 - x0, bh);
    ctx.fillStyle = active ? '#ffd400' : 'rgba(255,212,0,.5)';
    ctx.fillRect(x0, top, x1 - x0, 2);
    ctx.font = 'bold 10px Segoe UI'; ctx.fillText('#' + clipNo(c), x0 + 4, top + 4);
    if (active) { ctx.fillRect(x0 - 2, top, 4, bh); ctx.fillRect(x1 - 2, top, 4, bh); }
    else { ctx.fillStyle = 'rgba(255,212,0,.35)'; ctx.fillRect(x0, top, 1.5, bh); ctx.fillRect(x1 - 1.5, top, 1.5, bh); }
  });
  // overlapping footage (red)
  const cs = [...S.p.clips].sort((a, b) => a.start - b.start);
  ctx.fillStyle = 'rgba(255,93,93,.55)';
  for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length && cs[j].start < cs[i].end; j++) {
    const a = t2x(Math.max(cs[i].start, cs[j].start), w), b = t2x(Math.min(cs[i].end, cs[j].end), w);
    ctx.fillRect(a, top, Math.max(1, b - a), bh);
  }
  // new clip being drawn
  const g = tl.drag && tl.drag.ghost;
  if (g) {
    const a = t2x(g[0], w), b = t2x(g[1], w);
    ctx.fillStyle = 'rgba(90,169,255,.25)'; ctx.fillRect(a, top, b - a, bh);
    ctx.strokeStyle = '#5aa9ff'; ctx.lineWidth = 1; ctx.strokeRect(a + 0.5, top + 0.5, b - a - 1, bh - 1);
    ctx.fillStyle = '#5aa9ff'; ctx.font = 'bold 11px Segoe UI'; ctx.fillText(`${tr('new clip')} · ${(g[1] - g[0]).toFixed(1)} s`, a + 4, top + 4);
  }
  // playhead
  // speech (blue line at the bottom)
  const sp = speechSegs();
  if (sp.length) {
    ctx.fillStyle = 'rgba(90,169,255,.85)';
    for (const g of sp) {
      if (g[1] < v0 || g[0] > v1) continue;
      const a = t2x(g[0], w), b = t2x(g[1], w);
      ctx.fillRect(a, h - 4, Math.max(1, b - a), 3);
    }
  }
  const px = t2x(player.currentTime || 0, w);
  ctx.fillStyle = '#fff'; ctx.fillRect(px - 0.5, 0, 1.5, h);
}
const EDGE = 7;
function tlHit(x, y, w) {
  if (y < 15) return { kind: 'ruler' };
  const sel = selClip();
  const order = sel ? [sel, ...S.p.clips.filter(c => c !== sel)] : S.p.clips;
  for (const c of order) {
    if (Math.abs(x - t2x(c.start, w)) < EDGE) return { kind: 'start', c };
    if (Math.abs(x - t2x(c.end, w)) < EDGE) return { kind: 'end', c };
  }
  const t = x2t(x, w);
  const inside = sel && t >= sel.start && t <= sel.end ? sel : S.p.clips.find(k => t >= k.start && t <= k.end);
  return { kind: inside ? 'clip' : 'bg', c: inside };
}
const TL_CURSOR = { ruler: 'grab', start: 'ew-resize', end: 'ew-resize', clip: 'move', bg: 'crosshair' };
tl.cv.addEventListener('mousedown', e => {
  if (!S.p || e.button !== 0) return;
  const { w } = tlSize(); const x = e.offsetX;
  const hit = e.shiftKey ? { kind: 'ruler' } : tlHit(x, e.offsetY, w);
  if (hit.c && hit.c.id !== S.sel) selectClip(hit.c.id, false);
  tl.drag = { ...hit, x0: x, t0: x2t(x, w), view0: [...S.view], moved: false, orig: hit.c ? { start: hit.c.start, end: hit.c.end } : null };
  if (hit.kind === 'ruler') tl.cv.style.cursor = 'grabbing';
});
window.addEventListener('mousemove', e => {
  if (!S.p) return;
  const r = tl.cv.getBoundingClientRect(); const w = r.width; const x = e.clientX - r.left;
  const d = tl.drag;
  if (!d) {
    if (e.target !== tl.cv) { $('#tlTip').classList.add('hidden'); return; }
    tl.cv.style.cursor = e.shiftKey ? 'grab' : TL_CURSOR[tlHit(x, e.clientY - r.top, w).kind];
    const tip = $('#tlTip'); tip.classList.remove('hidden'); tip.style.left = x + 'px'; tip.textContent = fmt(x2t(x, w));
    return;
  }
  if (Math.abs(x - d.x0) > 3) d.moved = true;
  if (!d.moved) return;
  const dur = S.p.meta.duration;
  const t = clamp(x2t(x, w), 0, dur);
  if (d.kind === 'start' || d.kind === 'end') {
    const sn = e.altKey ? { t: r1(t) } : snapEdge(r1(t), d.kind);
    const v = sn.t;
    Object.assign(d.c, Timing.setEdge(d.c, d.kind, v, dur));
    seek(d.kind === 'start' ? d.c.start : d.c.end);
    const tip = $('#tlTip'); tip.classList.remove('hidden'); tip.style.left = x + 'px';
    tip.textContent = fmt(d.kind === 'start' ? d.c.start : d.c.end) + (sn.how ? ' · ' + tr(sn.how) : '');
    renderEditor(); drawTimeline(); drawPreview();
  } else if (d.kind === 'clip') {
    const len = d.orig.end - d.orig.start;
    const ns = r1(clamp(d.orig.start + (t - d.t0), 0, Math.max(0, dur - len)));
    d.c.start = ns; d.c.end = r1(ns + len);
    seek(d.c.start); renderEditor(); drawTimeline(); drawPreview();
    const tip = $('#tlTip'); tip.classList.remove('hidden'); tip.style.left = x + 'px'; tip.textContent = `${fmt(d.c.start)} → ${fmt(d.c.end)}`;
  } else if (d.kind === 'ruler') {
    const span = d.view0[1] - d.view0[0];
    const s0 = clamp(d.view0[0] - (x - d.x0) / w * span, 0, dur - span);
    S.view = [s0, s0 + span]; drawTimeline();
  } else if (d.kind === 'bg') {
    d.ghost = [r1(Math.min(d.t0, t)), r1(Math.max(d.t0, t))];
    const tip = $('#tlTip'); tip.classList.remove('hidden'); tip.style.left = x + 'px'; tip.textContent = `${(d.ghost[1] - d.ghost[0]).toFixed(1)} s`;
    drawTimeline();
  }
});
window.addEventListener('mouseup', e => {
  const d = tl.drag; tl.drag = null;
  if (!d) return;
  const { w } = tlSize();
  if (d.moved && ['start', 'end', 'clip'].includes(d.kind)) {
    S.p.clips.sort((a, b) => a.start - b.start);
    scheduleSave(); renderClipList(); renderEditor(); drawTimeline(); return;
  }
  if (d.moved && d.kind === 'bg' && d.ghost) {
    const [a, b] = d.ghost;
    drawTimeline();
    if (b - a >= 2) return addClipAt(a, Math.min(b, a + 60));
    toast('Drag at least 2 seconds to create a clip', '', 2000);
  }
  if (!d.moved) { S.playUntil = null; seek(x2t(e.clientX - tl.cv.getBoundingClientRect().left, w)); }
  if (d.kind === 'ruler') tl.cv.style.cursor = 'grab';
});
tl.cv.addEventListener('mouseleave', () => $('#tlTip').classList.add('hidden'));
tl.cv.addEventListener('wheel', e => {
  if (!S.p) return;
  e.preventDefault();
  const { w } = tlSize();
  const dur = S.p.meta.duration, span0 = S.view[1] - S.view[0];
  if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
    // pan
    const s0 = clamp(S.view[0] + (e.deltaX || e.deltaY) / w * span0, 0, dur - span0);
    S.view = [s0, s0 + span0]; drawTimeline(); return;
  }
  const t = x2t(e.offsetX, w);
  const span = clamp(span0 * (e.deltaY > 0 ? 1.25 : 0.8), 10, dur);
  const f = e.offsetX / w;
  const s0 = clamp(t - span * f, 0, dur - span);
  S.view = [s0, s0 + span]; drawTimeline();
}, { passive: false });
tl.cv.addEventListener('dblclick', () => { S.view = [0, S.p.meta.duration]; drawTimeline(); });
window.addEventListener('resize', () => { drawTimeline(); drawLayoutCanvas(); });

// Speech comes from clip captions and (if made) the whole-stream transcript. Gaps between words
// are where a clip can start or end without cutting someone off.
let speechCache = { key: '', segs: [] };
function speechSegs() {
  if (!S.p) return [];
  const key = S.p.slug + ':' + (S.transcript ? S.transcript.words.length : 0) + ':' + S.p.clips.map(c => (c.captions ? c.captions.length : 0) + '/' + (c.captionsVer || 0) + '/' + (c.captionsRange || []).join('-')).join(',');
  if (speechCache.key === key) return speechCache.segs;
  let words = S.transcript ? S.transcript.words.slice() : [];
  for (const c of S.p.clips) for (const ch of c.captions || []) for (const w of ch.words || []) words.push(w);
  const segs = Timing.speechSegments(words); // [start, end, last word]
  speechCache = { key, segs };
  return segs;
}
// Clip edges stick to pauses in speech (rules in timing.js); Alt while dragging turns it off.
function snapEdge(t, which) {
  if (!S.snap || !S.p) return { t };
  return Timing.snapEdge(t, which, { segs: speechSegs(), duration: S.p.meta.duration, loudNorm: S.loudNorm });
}
S.snap = store.get('snapSpeech') !== '0';
$('#snapSpeech').checked = S.snap;
$('#snapSpeech').addEventListener('change', e => { S.snap = e.target.checked; store.set('snapSpeech', S.snap ? '1' : '0'); });
