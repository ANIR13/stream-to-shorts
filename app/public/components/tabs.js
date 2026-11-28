'use strict';
// Editor tabs.

const currentTab = () => $('.tabs button.active').dataset.tab;
function switchTab(name) {
  $$('.tabs button').forEach(b => { b.classList.toggle('active', b.dataset.tab === name); b.setAttribute('aria-selected', String(b.dataset.tab === name)); b.tabIndex = b.dataset.tab === name ? 0 : -1; });
  $$('.tab').forEach(t => t.classList.toggle('hidden', t.dataset.tab !== name));
  if (name === 'layout') requestAnimationFrame(drawLayoutCanvas);
  if (name === 'exports') loadExports();
  if (name === 'tracks') renderTracksTab();
  if (name === 'captions') ensureTranscript();
}
$$('.tabs button').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));
// Arrow keys move between tabs (standard tab-list behaviour).
$('.tabs').addEventListener('keydown', e => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  e.preventDefault(); e.stopPropagation();
  const bs = $$('.tabs button'), i = bs.findIndex(b => b.classList.contains('active'));
  const n = bs[(i + (e.key === 'ArrowRight' ? 1 : -1) + bs.length) % bs.length];
  switchTab(n.dataset.tab); n.focus();
});
