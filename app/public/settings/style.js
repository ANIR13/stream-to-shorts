'use strict';
// Style tab: fonts, colours, presets.

const FONTS = ['Impact', 'Arial Black', 'Bahnschrift', 'Segoe UI Black', 'Arial', 'Tahoma', 'Verdana'];
$$('.font-select').forEach(s => { s.innerHTML = FONTS.map(f => `<option style="font-family:'${f}'">${f}</option>`).join(''); });
function renderStyleTab() {
  const st = S.p.style;
  $$('[data-style]').forEach(el => {
    const v = st[el.dataset.style];
    if (el.type === 'checkbox') el.checked = !!v; else el.value = v;
  });
  $$('[data-out]').forEach(o => { o.textContent = st[o.dataset.out]; });
  const encSel = $('[data-style="encoder"]');
  encSel.value = st.encoder === 'gpu' && S.status?.gpu ? 'gpu' : 'cpu';
  encSel.querySelector('option[value="gpu"]').disabled = !S.status?.gpu;
  $('#gpuNote').textContent = S.status?.gpu
    ? `${tr('Graphics card')}: ${S.status.gpu}. ${tr('A little faster and smaller files, with slightly lower quality. If it fails, the processor is used automatically.')}`
    : tr('No compatible graphics encoder was found on this PC.');
  $('[data-style="captionPos"]').disabled = st.captionAuto;
  renderPresets();
}
async function loadPresets() {
  S.presets = await api('/api/presets').catch(() => []);
  renderPresets(); renderClipStyleSelect();
}
function renderPresets() {
  if (!S.p) return;
  const sel = $('#presetSelect'), cur = sel.value;
  sel.innerHTML = '<option value="">Choose a preset…</option>' + S.presets.map(p => `<option value="${esc(p.name)}">${esc(p.name)}${p.builtin ? ' (built-in)' : ''}</option>`).join('');
  if (S.presets.some(p => p.name === cur)) sel.value = cur;
  const pr = S.presets.find(p => p.name === sel.value);
  $('#btnApplyPreset').disabled = !pr;
  $('#btnDeletePreset').disabled = !pr || pr.builtin;
  const own = S.p.clips.filter(c => c.style).length;
  $('#presetInfo').textContent = own ? `${own} clip${own > 1 ? 's use their' : ' uses its'} own style (Edit clip), so changes here don't affect ${own > 1 ? 'them' : 'it'}.` : '';
}
$('#presetSelect').addEventListener('change', renderPresets);
$('#btnApplyPreset').addEventListener('click', () => {
  const pr = S.presets.find(p => p.name === $('#presetSelect').value); if (!pr) return;
  Object.assign(S.p.style, pr.style);
  scheduleSave(); renderStyleTab(); renderClipList(); renderTitleFit(); drawPreview();
  toast(`Preset "${pr.name}" applied to the project`, 'ok');
});
$('#btnSavePreset').addEventListener('click', async () => {
  const name = prompt('Name for this preset (it will be available for every video):');
  if (!name || !name.trim()) return;
  try {
    S.presets = await api('/api/presets', { method: 'POST', body: { name: name.trim(), style: S.p.style } });
    renderPresets(); $('#presetSelect').value = name.trim(); renderPresets(); renderClipStyleSelect();
    toast(`Preset "${name.trim()}" saved`, 'ok');
  } catch (e) { toast(e.message, 'err'); }
});
$('#btnDeletePreset').addEventListener('click', async () => {
  const name = $('#presetSelect').value;
  if (!name || !confirm(`Delete the preset "${name}"? Clips already using it keep their look.`)) return;
  S.presets = await api('/api/presets/delete', { method: 'POST', body: { name } });
  $('#presetSelect').value = ''; renderPresets(); renderClipStyleSelect();
});
$$('[data-style]').forEach(el => el.addEventListener('input', () => {
  const k = el.dataset.style;
  let v = el.type === 'checkbox' ? el.checked : el.value;
  if (el.type === 'range' || k === 'fps') v = Number(v);
  S.p.style[k] = v;
  $$(`[data-out="${k}"]`).forEach(o => { o.textContent = v; });
  $('[data-style="captionPos"]').disabled = S.p.style.captionAuto;
  scheduleSave(); drawPreview(); renderCaptionStatus(); renderTitleFit(); renderClipList();
}));
