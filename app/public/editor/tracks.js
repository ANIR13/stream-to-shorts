'use strict';
// Tracks tab: what a short is made of (see app/src/core/timeline.js). Per clip: show / hide and lock
// each track, cut parts out (jump cuts, "remove pauses"), text and picture overlays, music.
// Overlay times are seconds from the clip start (before cuts), like everything the editor shows.

const TRACKS = [
  ['timing', 'Clip timing', 'Start, end and cuts', false],
  ['title', 'Title', 'The two title lines', true],
  ['captions', 'Captions', 'What is said, word by word', true],
  ['texts', 'Text overlays', 'Extra texts at chosen moments', true],
  ['images', 'Pictures', 'Logos, emojis, screenshots from the source folder', true],
  ['stream', 'Stream sound', 'The sound of the recording', true],
  ['music', 'Music', 'A music track under the stream', true],
];
const IMAGE_POS = ['top-left', 'top', 'top-right', 'middle', 'bottom-left', 'bottom', 'bottom-right'];
const TEXT_Y = { top: 330, middle: 960, bottom: 1450 };
S.assets = { images: [], audio: [] };
let cutMark = null;   // start of a cut being marked at the playhead

const trackOf = (c, id) => (c.tracks && c.tracks[id]) || {};
const isLocked = (c, id) => !!trackOf(c, id).locked;
const isHidden = (c, id) => !!trackOf(c, id).hidden;
function setTrack(c, id, key, val) {
  c.tracks = c.tracks || {};
  c.tracks[id] = { ...trackOf(c, id), [key]: val };
  if (!c.tracks[id].hidden && !c.tracks[id].locked) delete c.tracks[id];
  if (!Object.keys(c.tracks).length) delete c.tracks;
}
// Clip timing locked: the editor refuses to move the clip's edges (called before every timing change).
function timingLocked(c) {
  if (!c || !isLocked(c, 'timing')) return false;
  keyFeedback(tr('Clip timing is locked (Tracks tab)'));
  return true;
}
const rel = t => Math.round((t - selClip().start) * 10) / 10;   // playhead as seconds from the clip start
const fmtRel = t => (Math.round(t * 10) / 10).toFixed(1) + ' s';

async function loadAssets() {
  try { S.assets = await api('/api/assets'); } catch { S.assets = { images: [], audio: [] }; }
}

function renderTracksTab() {
  const c = selClip(), box = $('#tracksBody');
  if (!box) return;
  if (!c) { box.innerHTML = `<p class="muted small">${esc(tr('Select a clip to see its tracks.'))}</p>`; return; }
  const len = Math.round((c.end - c.start) * 10) / 10;
  const kept = keptLength(c);
  const opt = (v, t, sel) => `<option value="${esc(v)}"${v === sel ? ' selected' : ''}>${esc(t)}</option>`;
  const dis = id => isLocked(c, id) ? ' disabled' : '';
  const rows = TRACKS.map(([id, name, hint, canHide]) => `<div class="track-row" data-track="${id}">
      <span class="track-name" title="${esc(tr(hint))}">${esc(tr(name))}</span>
      ${canHide ? `<label class="check small" title="${esc(tr('Leave it out of the video'))}"><input type="checkbox" data-hide${isHidden(c, id) ? '' : ' checked'}> ${esc(tr('Visible'))}</label>` : '<span></span>'}
      <label class="check small" title="${esc(tr('Protect it from changes'))}"><input type="checkbox" data-lock${isLocked(c, id) ? ' checked' : ''}> ${esc(tr('Locked'))}</label>
    </div>`).join('');
  const cuts = (c.cuts || []).map((x, i) => `<li><span class="mono">${fmt(x.start)} → ${fmt(x.end)}</span> <span class="muted">(${(x.end - x.start).toFixed(1)} s)</span>
      <button class="btn small ghost" data-cut-go="${i}" title="${esc(tr('Jump there'))}">↦</button><button class="btn small ghost" data-cut-del="${i}"${dis('timing')} aria-label="${esc(tr('Remove'))}">✕</button></li>`).join('');
  const texts = (c.texts || []).map((o, i) => `<div class="ov-row" data-text="${i}">
      <input type="text" data-f="text" value="${esc(o.text)}" maxlength="120"${dis('texts')} aria-label="${esc(tr('Text'))}">
      <label class="small">${esc(tr('from'))} <input type="number" step="0.1" min="0" max="${len}" data-f="start" value="${o.start}"${dis('texts')}></label>
      <label class="small">${esc(tr('to'))} <input type="number" step="0.1" min="0" max="${len}" data-f="end" value="${o.end}"${dis('texts')}></label>
      <select data-f="pos"${dis('texts')}>${['top', 'middle', 'bottom'].map(p => opt(p, tr(p), o.pos || 'middle')).join('')}</select>
      <input type="number" data-f="size" min="20" max="200" value="${o.size || 72}" title="${esc(tr('Size'))}"${dis('texts')}>
      <input type="color" data-f="color" value="${esc(o.color || '#FFFFFF')}"${dis('texts')}>
      <button class="btn small ghost" data-text-del="${i}"${dis('texts')} aria-label="${esc(tr('Remove'))}">✕</button></div>`).join('');
  const images = (c.images || []).map((o, i) => `<div class="ov-row" data-image="${i}">
      <select data-f="file"${dis('images')}>${S.assets.images.concat(S.assets.images.includes(o.file) ? [] : [o.file]).map(f => opt(f, f, o.file)).join('')}</select>
      <label class="small">${esc(tr('from'))} <input type="number" step="0.1" min="0" max="${len}" data-f="start" value="${o.start}"${dis('images')}></label>
      <label class="small">${esc(tr('to'))} <input type="number" step="0.1" min="0" max="${len}" data-f="end" value="${o.end}"${dis('images')}></label>
      <select data-f="pos"${dis('images')}>${IMAGE_POS.map(p => opt(p, tr(p), o.pos || 'top-right')).join('')}</select>
      <label class="small">${esc(tr('Size'))} <input type="number" data-f="size" min="5" max="100" value="${Math.round((o.size || 0.3) * 100)}"${dis('images')}>%</label>
      <button class="btn small ghost" data-image-del="${i}"${dis('images')} aria-label="${esc(tr('Remove'))}">✕</button></div>`).join('');
  const m = c.music || {};
  box.innerHTML = `
    <p class="muted small">${esc(tr('Everything this short is made of. Hide a track to leave it out of the video; lock it to protect it from changes.'))}</p>
    <div class="track-list">${rows}</div>

    <h4>${esc(tr('Cuts'))} <span class="muted small">${esc(tr('Short length'))}: ${fmtRel(kept)} / ${fmtRel(len)}</span></h4>
    <p class="muted small">${esc(tr('Remove parts of the clip; the rest is joined (jump cuts).'))}</p>
    <div class="row gap wrap">
      <button class="btn small" id="btnCutMark"${dis('timing')}>${esc(tr(cutMark == null ? 'Start a cut at the playhead' : 'End the cut at the playhead'))}</button>
      ${cutMark == null ? '' : `<span class="small muted">${esc(tr('Cut starts at'))} ${fmt(cutMark)}</span><button class="btn small ghost" id="btnCutCancel">${esc(tr('Cancel'))}</button>`}
      <button class="btn small ghost" id="btnCutPauses"${dis('timing')} title="${esc(tr('Uses the clip captions or the transcript'))}">${esc(tr('Remove pauses'))}</button>
      <select id="cutPauseLen" aria-label="${esc(tr('Pauses longer than'))}">${[0.6, 0.8, 1.2, 2].map(v => opt(String(v), `> ${v} s`, '0.8')).join('')}</select>
      ${(c.cuts || []).length ? `<button class="btn small ghost" id="btnCutClear"${dis('timing')}>${esc(tr('Remove all cuts'))}</button>` : ''}
    </div>
    <ul class="cut-list">${cuts}</ul>

    <h4>${esc(tr('Text overlays'))}</h4>
    ${texts}
    <button class="btn small" id="btnTextAdd"${dis('texts')}>${esc(tr('＋ Text at the playhead'))}</button>

    <h4>${esc(tr('Pictures'))}</h4>
    ${S.assets.images.length ? images + `<button class="btn small" id="btnImageAdd"${dis('images')}>${esc(tr('＋ Picture at the playhead'))}</button>`
      : `<p class="muted small">${esc(tr('Put PNG or JPG files in the source folder (or drop them on the window) to use them here.'))}</p>`}

    <h4>${esc(tr('Music'))}</h4>
    ${S.assets.audio.length ? `<div class="ov-row" id="musicRow">
      <select data-f="file"${dis('music')}>${opt('', tr('No music'), m.file || '')}${S.assets.audio.map(f => opt(f, f, m.file || '')).join('')}</select>
      <label class="small">${esc(tr('Volume'))} <input type="range" data-f="volume" min="0" max="1" step="0.05" value="${m.volume == null ? 0.25 : m.volume}"${dis('music')}></label>
      <label class="small">${esc(tr('Start in the song (s)'))} <input type="number" data-f="from" min="0" step="1" value="${m.from || 0}"${dis('music')}></label>
      <label class="check small"><input type="checkbox" data-f="duck"${m.duck === false ? '' : ' checked'}${dis('music')}> ${esc(tr('Quieter while someone speaks'))}</label>
    </div>` : `<p class="muted small">${esc(tr('Put MP3, WAV or M4A files in the source folder (or drop them on the window) to use them here.'))}</p>`}
    <button class="btn small ghost" id="btnAssetsRefresh">${esc(tr('Refresh the file lists'))}</button>`;
}
function keptLength(c) {
  const cuts = (c.cuts || []).map(x => [Math.max(c.start, x.start), Math.min(c.end, x.end)]).filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0]);
  let removed = 0, t = c.start;
  for (const [a, b] of cuts) { removed += Math.max(0, b - Math.max(a, t)); t = Math.max(t, b); }
  return c.end - c.start - removed;
}
function tracksChanged() { scheduleSave(); renderTracksTab(); drawTimeline(); drawPreview(); renderClipList(); }

$('#tracksBody').addEventListener('change', e => {
  const c = selClip(); if (!c) return;
  const row = e.target.closest('[data-track]');
  if (row) {
    const id = row.dataset.track;
    if (e.target.matches('[data-hide]')) setTrack(c, id, 'hidden', !e.target.checked);
    if (e.target.matches('[data-lock]')) setTrack(c, id, 'locked', e.target.checked);
    if (id === 'title') { $('#fTitle1').disabled = $('#fTitle2').disabled = isLocked(c, 'title'); }
    return tracksChanged();
  }
  const f = e.target.dataset.f;
  const ti = e.target.closest('[data-text]'), ii = e.target.closest('[data-image]');
  if (ti && f) {
    const o = c.texts[+ti.dataset.text];
    o[f] = ['start', 'end', 'size'].includes(f) ? Number(e.target.value) : e.target.value;
    if (o.end <= o.start) o.end = Math.round((o.start + 1) * 10) / 10;
    return tracksChanged();
  }
  if (ii && f) {
    const o = c.images[+ii.dataset.image];
    o[f] = f === 'size' ? clamp(Number(e.target.value) / 100, 0.05, 1) : ['start', 'end'].includes(f) ? Number(e.target.value) : e.target.value;
    if (o.end <= o.start) o.end = Math.round((o.start + 1) * 10) / 10;
    return tracksChanged();
  }
  if (e.target.closest('#musicRow') && f) {
    const v = f === 'duck' ? e.target.checked : f === 'file' ? e.target.value : Number(e.target.value);
    if (f === 'file' && !v) delete c.music; else c.music = { volume: 0.25, from: 0, duck: true, ...(c.music || {}), [f]: v };
    return tracksChanged();
  }
});
$('#tracksBody').addEventListener('click', async e => {
  const c = selClip(); if (!c) return;
  const b = e.target.closest('button'); if (!b) return;
  const len = c.end - c.start, t = clamp(rel(player.currentTime), 0, len);
  if (b.id === 'btnAssetsRefresh') { await loadAssets(); return renderTracksTab(); }
  if (b.id === 'btnCutCancel') { cutMark = null; return renderTracksTab(); }
  if (b.id === 'btnCutMark') {
    if (timingLocked(c)) return;
    const now = clamp(player.currentTime, c.start, c.end);
    if (cutMark == null) { cutMark = now; return renderTracksTab(); }
    const a = Math.min(cutMark, now), z = Math.max(cutMark, now);
    cutMark = null;
    if (z - a < 0.2) { toast(tr('Move the playhead to where the cut should end.'), 'err'); return renderTracksTab(); }
    c.cuts = (c.cuts || []).concat({ start: Math.round(a * 100) / 100, end: Math.round(z * 100) / 100 }).sort((x, y) => x.start - y.start);
    return tracksChanged();
  }
  if (b.id === 'btnCutPauses') {
    if (timingLocked(c)) return;
    const words = [];
    for (const ch of c.captions || []) for (const w of ch.words || []) words.push(w);
    if (!words.length && S.transcript) for (const w of S.transcript.words) if (w.e > c.start && w.s < c.end) words.push(w);
    if (!words.length) return toast(tr('No words for this clip yet: generate its captions or transcribe the whole stream first.'), 'err');
    const cuts = pauseCuts(words, c.start, c.end, Number($('#cutPauseLen').value) || 0.8);
    if (!cuts.length) return toast(tr('No pauses that long in this clip.'));
    c.cuts = cuts;
    toast(`${tr('Pauses removed')}: ${cuts.length}`, 'ok');
    return tracksChanged();
  }
  if (b.id === 'btnCutClear') { delete c.cuts; return tracksChanged(); }
  if (b.dataset.cutDel != null) { c.cuts.splice(+b.dataset.cutDel, 1); if (!c.cuts.length) delete c.cuts; return tracksChanged(); }
  if (b.dataset.cutGo != null) return seek(c.cuts[+b.dataset.cutGo].start - 1);
  if (b.id === 'btnTextAdd') {
    c.texts = (c.texts || []).concat({ id: newId(), text: tr('Your text'), start: Math.round(t * 10) / 10, end: Math.round(Math.min(len, t + 3) * 10) / 10, pos: 'top', size: 72, color: '#FFFFFF' });
    tracksChanged();
    const inputs = $$('#tracksBody [data-text] input[data-f=text]'); if (inputs.length) { inputs[inputs.length - 1].focus(); inputs[inputs.length - 1].select(); }
    return;
  }
  if (b.dataset.textDel != null) { c.texts.splice(+b.dataset.textDel, 1); if (!c.texts.length) delete c.texts; return tracksChanged(); }
  if (b.id === 'btnImageAdd') {
    c.images = (c.images || []).concat({ id: newId(), file: S.assets.images[0], start: Math.round(t * 10) / 10, end: Math.round(len * 10) / 10, pos: 'top-right', size: 0.25, opacity: 1 });
    return tracksChanged();
  }
  if (b.dataset.imageDel != null) { c.images.splice(+b.dataset.imageDel, 1); if (!c.images.length) delete c.images; return tracksChanged(); }
});

// The same rule as the server (core/timeline.js pauseCuts): pauses longer than minGap, keeping a
// little silence on each side.
function pauseCuts(words, start, end, minGap = 0.8, pad = 0.15) {
  const w = words.filter(x => x.e > start && x.s < end).sort((a, b) => a.s - b.s);
  const r2 = v => Math.round(v * 100) / 100;
  const cuts = []; let prev = start;
  for (const x of w) { if (x.s - prev >= minGap) cuts.push({ start: r2(prev + pad), end: r2(x.s - pad) }); prev = Math.max(prev, x.e); }
  if (end - prev >= minGap && w.length) cuts.push({ start: r2(prev + pad), end: r2(end - pad) });
  return cuts.filter(c => c.end - c.start >= 0.3);
}

// ---- preview: text overlays and pictures on the 9:16 canvas ----
const imgCache = new Map();
function assetImage(file) {
  if (!imgCache.has(file)) { const im = new Image(); im.onload = () => drawPreview(); im.src = '/media/asset/' + encodeURIComponent(file); imgCache.set(file, im); }
  return imgCache.get(file);
}
function drawOverlays(ctx, c, k, W) {
  const t = player.currentTime - c.start;
  if (!isHidden(c, 'images')) for (const o of c.images || []) {
    if (t < o.start || t > o.end) continue;
    const im = assetImage(o.file); if (!im.complete || !im.naturalWidth) continue;
    const w = 1080 * clamp(o.size || 0.3, 0.05, 1), h = w * im.naturalHeight / im.naturalWidth, pos = o.pos || 'top-right';
    const x = /left/.test(pos) ? 40 : /right/.test(pos) ? 1080 - 40 - w : (1080 - w) / 2;
    const y = /^top/.test(pos) ? 200 : /^bottom/.test(pos) ? 1450 : 800;
    ctx.save(); ctx.globalAlpha = o.opacity == null ? 1 : o.opacity; ctx.drawImage(im, x * k, y * k, w * k, h * k); ctx.restore();
  }
  if (!isHidden(c, 'texts')) for (const o of c.texts || []) {
    if (t < o.start || t > o.end || !o.text) continue;
    const size = (o.size || 72) * k;
    ctx.save(); ctx.font = `${size}px "${eff(c).style.titleFont}"`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    ctx.lineWidth = 10 * k; ctx.strokeStyle = '#000'; ctx.strokeText(o.text, W / 2, (TEXT_Y[o.pos] || 960) * k);
    ctx.fillStyle = o.color || '#fff'; ctx.fillText(o.text, W / 2, (TEXT_Y[o.pos] || 960) * k);
    ctx.restore();
  }
}
// While playing inside a clip, jump over the parts that are cut out (the short won't have them).
function skipCuts() {
  const c = selClip();
  if (!c || !c.cuts || player.paused || isHidden(c, 'timing')) return;
  const t = player.currentTime;
  const cut = c.cuts.find(x => t >= x.start && t < x.end - 0.05);
  if (cut) seek(cut.end);
}
