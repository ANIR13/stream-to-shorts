'use strict';
// Render all / render selected.

// Short checklist for a video that isn't finished yet (hidden once done or dismissed).
function setupSteps() {
  const p = S.p, set = p.setup || {};
  const rendered = p.clips.some(c => c.output);
  const untitled = p.clips.filter(c => !c.title1 && !c.title2);
  return [
    { done: !!p.analyzed, text: 'Analyze the video to find the best moments', btn: 'Analyze', fn: () => $('#btnAnalyze').click() },
    { done: !!(set.layoutChecked || rendered), text: 'Check the layout: place the facecam and gameplay boxes', btn: 'Open Layout', fn: () => switchTab('layout') },
    { done: p.clips.length > 0 && !untitled.length, text: untitled.length ? `Give every clip a title (${untitled.length} untitled)` : 'Give every clip a title', btn: 'Next untitled',
      fn: () => { const c = untitled[0]; if (c) { selectClip(c.id, true); switchTab('edit'); $('#fTitle1').focus(); } } },
    { done: rendered, text: 'Render your first short', btn: 'Render', fn: () => { $('#btnRenderMenu').click(); } },
  ];
}
function renderSetup() {
  const el = $('#setupCard');
  if (!S.p) return;
  const steps = setupSteps();
  const show = !(S.p.setup && S.p.setup.hidden) && steps.some(x => !x.done);
  el.classList.toggle('hidden', !show);
  if (!show) return;
  el.innerHTML = `<div class="row between"><h3>Getting started with this video</h3><button class="btn small ghost" data-setuphide>Hide</button></div>`
    + steps.map((x, i) => `<div class="setup-step ${x.done ? 'done' : ''}"><span class="ic">${x.done ? '✓' : i + 1}</span><span class="t">${esc(x.text)}</span>${x.done ? '' : `<button class="btn small ghost" data-setupstep="${i}">${esc(x.btn)}</button>`}</div>`).join('');
}
$('#setupCard').addEventListener('click', e => {
  if (e.target.closest('[data-setuphide]')) { S.p.setup = { ...(S.p.setup || {}), hidden: true }; scheduleSave(); renderSetup(); return; }
  const b = e.target.closest('[data-setupstep]'); if (b) setupSteps()[+b.dataset.setupstep].fn();
});
function markLayoutChecked() { if (!(S.p.setup && S.p.setup.layoutChecked)) { S.p.setup = { ...(S.p.setup || {}), layoutChecked: true }; renderSetup(); } }

function renderAll() {
  renderClipList(); renderEditor(); renderLayoutTab(); renderStyleTab(); renderCaptionsTab(); renderSetup();
  drawTimeline(); drawPreview(); drawLayoutCanvas();
  $('#btnAnalyze').textContent = S.p.analyzed ? 'Re-analyze' : 'Analyze video';
  if (currentTab() === 'exports') loadExports();
}
