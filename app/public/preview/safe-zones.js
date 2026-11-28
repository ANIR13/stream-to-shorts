'use strict';
// Safe zones: what TikTok / Shorts / Reels cover.

S.safe = store.get('safeZones') === '1';
$('#safeZones').checked = S.safe;
$('#safeZones').addEventListener('change', e => { S.safe = e.target.checked; store.set('safeZones', S.safe ? '1' : '0'); drawPreview(); });
const SAFE_TEXT = {
  title: ['The title is under the apps\' top bar.', 'Move the title down'],
  captionsLow: ['Captions are under the description at the bottom.', 'Move captions up'],
  captionsHigh: ['Captions are under the apps\' top bar.', 'Move captions down'],
};
let safeKey = '';
function renderSafeWarn(issues) {
  const key = issues.join(',') + ':' + (S.sel || '');
  if (key === safeKey) return;
  safeKey = key;
  const el = $('#safeWarn');
  el.classList.toggle('hidden', !issues.length);
  el.innerHTML = issues.map(k => `<div class="row gap between"><span>⚠ ${esc(tr(SAFE_TEXT[k][0]))}</span><button class="btn small ghost" data-safefix="${k}">${esc(tr(SAFE_TEXT[k][1]))}</button></div>`).join('')
    + (issues.length && !S.safe ? `<button class="btn small ghost" data-safeshow>${esc(tr('Show the covered areas'))}</button>` : '');
}
$('#safeWarn').addEventListener('click', e => {
  if (e.target.closest('[data-safeshow]')) { S.safe = true; $('#safeZones').checked = true; store.set('safeZones', '1'); safeKey = ''; drawPreview(); return; }
  const k = e.target.dataset.safefix; if (!k) return;
  const c = selClip();
  const st = c && c.style ? c.style : S.p.style; // fix the style this clip actually uses
  if (k === 'title') st.titleSafe = true;
  else { const E = c ? eff(c) : S.p; st.captionAuto = false; st.captionPos = k === 'captionsLow' ? 70 : 20; if (E.style.captionAuto) st.captionAuto = false; }
  safeKey = ''; scheduleSave(); renderStyleTab(); renderClipList(); drawPreview();
  toast(tr(k === 'title' ? 'Title moved below the top bar' : 'Captions moved into the visible area'), 'ok');
});
