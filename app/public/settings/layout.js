'use strict';
// Layout tab: facecam and gameplay boxes.

const lc = { cv: $('#layoutCanvas'), drag: null, active: 'game' };
lc.cv.tabIndex = 0;
lc.cv.setAttribute('role', 'application');
lc.cv.setAttribute('aria-label', 'Layout editor. Enter switches between the facecam and gameplay boxes. Arrow keys move the box, Shift plus arrow keys resize it, hold Alt for fine steps.');
lc.cv.addEventListener('focus', () => drawLayoutCanvas());
lc.cv.addEventListener('blur', () => drawLayoutCanvas());
lc.cv.addEventListener('keydown', e => {
  const keys = layoutRects().map(r => r[0]);
  if (!keys.includes(lc.active)) lc.active = keys[0];
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault(); e.stopPropagation();
    lc.active = keys[(keys.indexOf(lc.active) + 1) % keys.length];
    drawLayoutCanvas(); toast(`${lc.active === 'cam' ? 'Facecam' : 'Gameplay'} box selected`, '', 1200); return;
  }
  const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
  if (!dir) return;
  e.preventDefault(); e.stopPropagation();
  const M = S.p.meta, step = e.altKey ? 2 : 16, q = { ...S.p.layout[lc.active] };
  if (e.shiftKey) {
    q.w = clamp(q.w + dir[0] * step, 40, M.width - q.x);
    q.h = clamp(q.h + dir[1] * step, 40, M.height - q.y);
  } else {
    q.x = clamp(q.x + dir[0] * step, 0, M.width - q.w);
    q.y = clamp(q.y + dir[1] * step, 0, M.height - q.h);
  }
  S.p.layout[lc.active] = q;
  markLayoutChecked();
  scheduleSave(); drawLayoutCanvas(); drawPreview(); renderLayoutTab();
});
function renderLayoutTab() {
  const L = S.p.layout;
  $$('#layoutMode button').forEach(b => b.classList.toggle('active', b.dataset.mode === L.mode));
  $('#camOnTop').checked = L.camOnTop !== false;
  $('#camOnTop').closest('label').classList.toggle('hidden', L.mode !== 'split');
  const r = k => { const x = L[k]; return `${k === 'cam' ? 'Facecam' : 'Gameplay'}: ${Math.round(x.w)}×${Math.round(x.h)} at ${Math.round(x.x)},${Math.round(x.y)}`; };
  $('#rectInfo').innerHTML = [L.mode !== 'gameplay' ? r('cam') : '', L.mode !== 'cam' ? r('game') : ''].filter(Boolean).map(s => `<span>${s}</span>`).join('');
}
$('#layoutMode').addEventListener('click', e => {
  const m = e.target.dataset.mode; if (!m) return;
  S.p.layout.mode = m; markLayoutChecked(); scheduleSave(); renderLayoutTab(); drawLayoutCanvas(); drawPreview();
});
$('#camOnTop').addEventListener('change', e => { S.p.layout.camOnTop = e.target.checked; scheduleSave(); drawPreview(); });
$('#btnResetGame').addEventListener('click', () => { S.p.layout.game = { x: 0, y: 0, w: S.p.meta.width, h: S.p.meta.height }; scheduleSave(); renderLayoutTab(); drawLayoutCanvas(); drawPreview(); });
function layoutRects() {
  const m = S.p.layout.mode;
  return [m !== 'cam' && ['game', '#5aa9ff', 'GAMEPLAY'], m !== 'gameplay' && ['cam', '#ffd400', 'FACECAM']].filter(Boolean);
}
function drawLayoutCanvas() {
  if (!S.p || currentTab() !== 'layout') return;
  const cv = lc.cv, r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  const w = r.width, h = w * S.p.meta.height / S.p.meta.width;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); cv.style.height = h + 'px'; }
  const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const k = w / S.p.meta.width;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
  if (player.readyState >= 2) ctx.drawImage(player, 0, 0, w, h);
  ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(0, 0, w, h);
  for (const [key, color, label] of layoutRects()) {
    const q = S.p.layout[key];
    const x = q.x * k, y = q.y * k, rw = q.w * k, rh = q.h * k;
    if (player.readyState >= 2) ctx.drawImage(player, q.x * player.videoWidth / S.p.meta.width, q.y * player.videoHeight / S.p.meta.height, q.w * player.videoWidth / S.p.meta.width, q.h * player.videoHeight / S.p.meta.height, x, y, rw, rh);
    ctx.strokeStyle = color; ctx.lineWidth = document.activeElement === cv && lc.active === key ? 5 : 2; ctx.strokeRect(x, y, rw, rh);
    ctx.fillStyle = color; ctx.font = 'bold 12px Segoe UI'; ctx.textBaseline = 'top';
    const tw = ctx.measureText(label).width + 10;
    ctx.fillRect(x, y, tw, 18); ctx.fillStyle = '#000'; ctx.fillText(label, x + 5, y + 3);
    ctx.fillStyle = color;
    for (const [hx, hy] of [[x, y], [x + rw, y], [x, y + rh], [x + rw, y + rh]]) ctx.fillRect(hx - 5, hy - 5, 10, 10);
  }
}
function lcHit(mx, my) {
  const k = lc.cv.getBoundingClientRect().width / S.p.meta.width;
  for (const [key] of layoutRects().reverse()) {
    const q = S.p.layout[key];
    const corners = { nw: [q.x, q.y], ne: [q.x + q.w, q.y], sw: [q.x, q.y + q.h], se: [q.x + q.w, q.y + q.h] };
    for (const [name, [cx, cy]] of Object.entries(corners)) if (Math.abs(mx - cx * k) < 9 && Math.abs(my - cy * k) < 9) return { key, mode: name };
    if (mx >= q.x * k && mx <= (q.x + q.w) * k && my >= q.y * k && my <= (q.y + q.h) * k) return { key, mode: 'move' };
  }
  return null;
}
lc.cv.addEventListener('mousedown', e => {
  const hit = lcHit(e.offsetX, e.offsetY); if (!hit) return;
  lc.drag = { ...hit, mx: e.offsetX, my: e.offsetY, orig: { ...S.p.layout[hit.key] } };
});
lc.cv.addEventListener('mousemove', e => {
  if (!lc.drag) {
    const hit = lcHit(e.offsetX, e.offsetY);
    lc.cv.style.cursor = !hit ? 'default' : hit.mode === 'move' ? 'move' : (hit.mode === 'nw' || hit.mode === 'se') ? 'nwse-resize' : 'nesw-resize';
    return;
  }
  const d = lc.drag, M = S.p.meta;
  const k = lc.cv.getBoundingClientRect().width / M.width;
  const dx = (e.offsetX - d.mx) / k, dy = (e.offsetY - d.my) / k;
  const o = d.orig; let { x, y, w, h } = o;
  if (d.mode === 'move') { x = clamp(o.x + dx, 0, M.width - o.w); y = clamp(o.y + dy, 0, M.height - o.h); }
  else {
    if (d.mode.includes('w')) { x = clamp(o.x + dx, 0, o.x + o.w - 40); w = o.x + o.w - x; }
    if (d.mode.includes('e')) { w = clamp(o.w + dx, 40, M.width - o.x); }
    if (d.mode.includes('n')) { y = clamp(o.y + dy, 0, o.y + o.h - 40); h = o.y + o.h - y; }
    if (d.mode.includes('s')) { h = clamp(o.h + dy, 40, M.height - o.y); }
  }
  S.p.layout[d.key] = { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
  drawLayoutCanvas(); drawPreview(); renderLayoutTab();
});
window.addEventListener('mouseup', () => { if (lc.drag) { lc.drag = null; markLayoutChecked(); scheduleSave(); } });
$('#btnLayoutOk').addEventListener('click', () => { markLayoutChecked(); scheduleSave(); toast(tr('Layout marked as checked'), 'ok', 2000); });
