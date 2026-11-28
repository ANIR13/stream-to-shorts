'use strict';
// The live 9:16 preview (shared layout maths in layout.js).

const pv = $('#preview');
function wrapWords(ctx, words, maxW, hiIdx, scale) {
  const lines = [[]]; let lw = 0; const space = ctx.measureText(' ').width;
  words.forEach((w, i) => {
    const ww = ctx.measureText(w).width * (i === hiIdx ? scale : 1);
    if (lines[lines.length - 1].length && lw + space + ww > maxW) { lines.push([]); lw = 0; }
    lines[lines.length - 1].push({ w, i, ww }); lw += (lw ? space : 0) + ww;
  });
  return { lines, space };
}
function drawPreview() {
  const ctx = pv.getContext('2d');
  const W = pv.width, H = pv.height, k = W / 1080;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#0e0e12'; ctx.fillRect(0, 0, W, H);
  if (!S.p) return;
  const c = selClip(), E = c ? eff(c) : S.p, st = E.style;
  const up = t => st.uppercase ? String(t).toLocaleUpperCase() : String(t);
  const hasTitle = !!(c && (c.title1 || c.title2)) && !(c && isHidden(c, 'title'));
  const L = Layout.compute(E.layout, S.p.meta, st, hasTitle);
  const ready = player.readyState >= 2 && player.videoWidth;
  const sx = ready ? player.videoWidth / S.p.meta.width : 1;
  if (ready && st.background !== 'dark') {
    ctx.save(); ctx.filter = 'blur(10px) brightness(0.7) saturate(1.15)';
    const s = Math.max(W / player.videoWidth, H / player.videoHeight);
    const dw = player.videoWidth * s, dh = player.videoHeight * s;
    ctx.drawImage(player, (W - dw) / 2, (H - dh) / 2, dw, dh); ctx.restore();
  }
  for (const it of L.items) {
    const { src, dst } = it;
    if (ready) {
      ctx.save();
      if (it.key === 'cam' && st.camBoost) ctx.filter = 'brightness(1.08) contrast(1.08)';
      ctx.drawImage(player, src.x * sx, src.y * sx, src.w * sx, src.h * sx, dst.x * k, dst.y * k, dst.w * k, dst.h * k);
      ctx.restore();
    } else {
      ctx.fillStyle = '#1d2029'; ctx.fillRect(dst.x * k, dst.y * k, dst.w * k, dst.h * k);
    }
    if (it.key === 'cam' && st.camBorder && E.layout.mode === 'split') {
      ctx.strokeStyle = st.accent; ctx.lineWidth = 6 * k; ctx.strokeRect(dst.x * k + 3 * k, dst.y * k + 3 * k, dst.w * k - 6 * k, dst.h * k - 6 * k);
    }
  }
  ctx.lineJoin = 'round'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  if (hasTitle) {
    const t1 = up(c.title1 || ''), t2 = up(c.title2 || '');
    const size = Layout.titleSize(st, t1, t2);
    ctx.font = `${size * k}px "${st.titleFont}"`;
    let y = (L.titleTop || 26) * k;
    for (const [t, col] of [[t1, st.titleColor1], [t2, st.titleColor2]]) {
      if (!t) continue;
      ctx.lineWidth = 12 * k; ctx.strokeStyle = '#000'; ctx.strokeText(t, W / 2, y);
      ctx.fillStyle = col; ctx.fillText(t, W / 2, y);
      y += size * 1.12 * k;
    }
  }
  // captions
  if (st.captions && c && c.captionsOn !== false && !isHidden(c, 'captions')) {
    const t = player.currentTime;
    let words = null, hi = -1;
    if (Array.isArray(c.captions) && c.captions.length) {
      const ch = c.captions.find(x => t >= x.s && t < x.e);
      if (ch) { words = ch.words.map(w => up(w.w)); hi = st.highlightMode === 'word' ? Math.max(0, ch.words.findIndex((w, i) => t >= w.s && (i === ch.words.length - 1 || t < ch.words[i + 1].s))) : -1; }
    } else {
      words = tr('CAPTIONS APPEAR HERE').split(' ').slice(0, Math.max(1, Math.min(3, st.wordsPerChunk))).map(up);
      hi = st.highlightMode === 'word' ? Math.min(1, words.length - 1) : -1;
    }
    if (words && words.length) {
      const size = st.captionSize * k;
      ctx.font = `${size}px "${st.captionFont}"`; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
      const { lines, space } = wrapWords(ctx, words, W - 140 * k, hi, 1.1);
      const lh = size * 1.15;
      let y = L.captionY * k - (lines.length - 1) * lh / 2;
      for (const line of lines) {
        const total = line.reduce((a, w) => a + w.ww, 0) + space * (line.length - 1);
        let x = (W - total) / 2;
        for (const w of line) {
          const isHi = w.i === hi;
          ctx.save();
          if (isHi) { ctx.translate(x + w.ww / 2, y); ctx.scale(1.1, 1.1); ctx.translate(-(x + w.ww / 2), -y); x += (w.ww - w.ww / 1.1) / 2; }
          ctx.lineWidth = 14 * k; ctx.strokeStyle = '#000'; ctx.strokeText(w.w, x, y);
          ctx.fillStyle = isHi ? st.captionHighlight : st.captionColor; ctx.fillText(w.w, x, y);
          ctx.restore();
          x += (isHi ? w.ww / 1.1 + (w.ww - w.ww / 1.1) / 2 : w.ww) + space;
        }
        y += lh;
      }
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    }
  }
  if (c) drawOverlays(ctx, c, k, W);   // text overlays and pictures (Tracks tab)
  if (st.progressBar && c) {
    const f = clamp((player.currentTime - c.start) / (c.end - c.start), 0, 1);
    ctx.fillStyle = st.accent; ctx.fillRect(0, 1906 * k, W * f, 14 * k);
  }
  if (c && (player.currentTime < c.start - 0.05 || player.currentTime > c.end + 0.05)) {
    ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(0, H - 34, W, 34);
    ctx.fillStyle = '#c9ccd6'; ctx.font = '13px Segoe UI'; ctx.textBaseline = 'middle';
    ctx.fillText(tr('Playhead is outside this clip'), W / 2, H - 17);
  }
  // what the apps' interface covers
  const SZ = Layout.SAFE;
  if (S.safe) {
    ctx.save();
    ctx.fillStyle = 'rgba(255,70,70,.30)';
    ctx.fillRect(0, 0, W, SZ.top * k);
    ctx.fillRect(0, SZ.bottom * k, W, H - SZ.bottom * k);
    ctx.fillRect(SZ.right * k, SZ.rightTop * k, W - SZ.right * k, (SZ.bottom - SZ.rightTop) * k);
    ctx.setLineDash([6, 5]); ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = 1;
    ctx.strokeRect(SZ.left * k, SZ.top * k, (SZ.right - SZ.left) * k, (SZ.bottom - SZ.top) * k);
    ctx.setLineDash([]);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 12px Segoe UI'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(tr('App top bar'), W / 2, SZ.top * k / 2);
    ctx.fillText(tr('Description, music, buttons'), W / 2, (SZ.bottom + (1920 - SZ.bottom) / 2) * k);
    ctx.save(); ctx.translate((SZ.right + (1080 - SZ.right) / 2) * k, (SZ.rightTop + SZ.bottom) / 2 * k); ctx.rotate(-Math.PI / 2);
    ctx.fillText(tr('Like / comment / share'), 0, 0); ctx.restore();
    ctx.restore();
  }
  renderSafeWarn(c ? Layout.safeIssues(L, st, hasTitle) : []);
}
