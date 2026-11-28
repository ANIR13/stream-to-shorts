// Shared 9:16 layout math — used by the server (ffmpeg render) and the browser (live preview).
(function (root) {
  const W = 1080, H = 1920;
  const BOTTOM = 1880; // keep clear of the progress bar
  // Areas that TikTok, YouTube Shorts and Instagram Reels cover with their own interface
  // (top bar, like/comment/share buttons on the right, description and music at the bottom).
  const SAFE = { top: 150, bottom: 1470, right: 960, rightTop: 760, left: 60 };
  const evenFloor = v => Math.max(2, Math.floor(v / 2) * 2);
  const even = v => Math.max(2, Math.round(v / 2) * 2);
  // Positions may be 0 (sizes may not): a full-width layer must start at x = 0, not 2.
  const evenPos = v => Math.max(0, Math.round(v / 2) * 2);

  function clampRect(r, meta) {
    const x = Math.min(Math.max(0, Math.floor(r.x / 2) * 2), meta.width - 16);
    const y = Math.min(Math.max(0, Math.floor(r.y / 2) * 2), meta.height - 16);
    const w = evenFloor(Math.min(Math.max(16, r.w), meta.width - x));
    const h = evenFloor(Math.min(Math.max(16, r.h), meta.height - y));
    return { x, y, w, h };
  }

  function compute(layout, meta, style, hasTitle) {
    // titleSafe moves the title below the apps' top bar.
    const titleTop = style && style.titleSafe ? SAFE.top + 10 : 26;
    const titleH = hasTitle ? titleTop + 210 : 40;
    const cam = clampRect(layout.cam, meta);
    const game = clampRect(layout.game, meta);
    const items = [];
    let captionY;

    if (layout.mode === 'split') {
      const gap = 14;
      const avail = BOTTOM - titleH;
      const parts = layout.camOnTop === false
        ? [['game', game], ['cam', cam]]
        : [['cam', cam], ['game', game]];
      const heights = parts.map(([, r]) => W * r.h / r.w);
      const total = heights[0] + heights[1] + gap;
      const f = Math.min(1, avail / total);
      const w = even(W * f);
      const x = evenPos((W - w) / 2);
      let y = titleH + Math.max(0, (avail - total * f) / 2);
      parts.forEach(([key, src], i) => {
        const h = even(heights[i] * f);
        items.push({ key, src, dst: { x, y: evenPos(y), w, h } });
        y += h + gap;
      });
      captionY = items[0].dst.y + items[0].dst.h + gap / 2;
    } else if (layout.mode === 'cam') {
      // Facecam fills the frame, cropped to 9:16 around its centre.
      let { x, y, w, h } = cam;
      const target = 9 / 16;
      if (w / h > target) { const nw = h * target; x += (w - nw) / 2; w = nw; }
      else { const nh = w / target; y += (h - nh) / 2; h = nh; }
      const src = clampRect({ x, y, w, h }, meta);
      items.push({ key: 'cam', src, dst: { x: 0, y: 0, w: W, h: H } });
      captionY = H * 0.68;
    } else {
      // Gameplay only, centred on a blurred background.
      const avail = BOTTOM - titleH;
      let w = W, h = W * game.h / game.w;
      if (h > avail) { h = avail; w = h * game.w / game.h; }
      const x = evenPos((W - w) / 2), y = evenPos(titleH + (avail - h) / 2);
      items.push({ key: 'game', src: game, dst: { x, y, w: even(w), h: even(h) } });
      captionY = h > avail * 0.75 ? y + h * 0.8 : Math.min(y + h + 140, 1700);
    }

    if (style && style.captionAuto === false && style.captionPos != null) {
      captionY = H * Number(style.captionPos) / 100;
    } else {
      captionY = Math.min(captionY, SAFE.bottom - 70); // automatic position never goes under the apps' description
    }
    return { W, H, titleH, titleTop, items, captionY: Math.round(captionY) };
  }

  // The project as seen by one clip: its own layout mode / style preset on top of the project defaults.
  function effective(p, clip) {
    if (!p || !clip) return p;
    const style = clip.style ? Object.assign({}, p.style, clip.style) : p.style;
    const layout = clip.layoutMode ? Object.assign({}, p.layout, { mode: clip.layoutMode }) : p.layout;
    return Object.assign({}, p, { style, layout });
  }

  // Title font size after auto-shrinking long titles to fit the 1080 px width.
  function titleSize(style, t1, t2) {
    const longest = Math.max(String(t1 || '').length, String(t2 || '').length, 1);
    return Math.min(Number(style.titleSize) || 86, Math.floor(1000 / (0.5 * longest)));
  }

  // Fingerprint of everything that changes a rendered short. Stored at render time;
  // when it no longer matches, the short is out of date.
  function stable(v) {
    if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
    if (v && typeof v === 'object') return '{' + Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
    return JSON.stringify(v === undefined ? null : v);
  }
  function hash(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(16).padStart(8, '0') + ':' + s.length.toString(36);
  }
  // Timeline additions (cuts, overlays, music, hidden or locked tracks): part of the fingerprint only
  // when a clip uses them, so shorts rendered before they existed stay up to date.
  function extrasOf(clip) {
    const out = {};
    for (const k of ['cuts', 'texts', 'images', 'music', 'tracks']) {
      const v = clip[k];
      if (v && (Array.isArray(v) ? v.length : Object.keys(v).length)) out[k] = v;
    }
    if (out.tracks) out.tracks = Object.fromEntries(Object.entries(out.tracks).filter(([, t]) => t && t.hidden).map(([k]) => [k, 'hidden']));
    if (out.tracks && !Object.keys(out.tracks).length) delete out.tracks;
    return Object.keys(out).length ? out : undefined;
  }
  function renderSig(p, clip) {
    const e = effective(p, clip);
    const st = Object.assign({}, e.style);
    delete st.encoder;
    const capOn = !!(st.captions && clip.captionsOn !== false);
    const captions = capOn && Array.isArray(clip.captions)
      ? clip.captions.map(ch => [ch.s, ch.e, (ch.words || []).map(w => [w.w, w.s, w.e])]) : null;
    return hash(stable({
      v: 1, video: p.video, start: clip.start, end: clip.end, num: clip.num || null,
      title1: clip.title1 || '', title2: clip.title2 || '', style: st,
      layout: { mode: e.layout.mode, camOnTop: e.layout.camOnTop !== false, cam: e.layout.cam, game: e.layout.game },
      captions,
      extras: extrasOf(clip),
    }));
  }

  // What the apps' interface would hide in this layout.
  function safeIssues(L, style, hasTitle) {
    const out = [];
    if (hasTitle && L.titleTop < SAFE.top) out.push('title');
    if (style.captions !== false) {
      const half = (Number(style.captionSize) || 84) * 0.6;
      if (L.captionY + half > SAFE.bottom) out.push('captionsLow');
      else if (L.captionY - half < SAFE.top) out.push('captionsHigh');
    }
    return out;
  }

  const api = { compute, clampRect, effective, titleSize, renderSig, safeIssues, SAFE, W, H };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Layout = api;
})(this);
