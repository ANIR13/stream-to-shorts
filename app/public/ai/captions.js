'use strict';
// Captions & AI tab: speech recognition settings, word fixes, transcript search.

function renderCaptionsTab() {
  const st = S.status || {};
  $('#whisperMissing').classList.toggle('hidden', !!(st.whisper && st.models?.length));
  $('#wModel').innerHTML = (st.models || []).map(m => `<option>${esc(m)}</option>`).join('') || '<option value="">(no model found)</option>';
  $('#wModel').value = S.p.whisper.model;
  $('#wLang').value = S.p.whisper.language;
  $('#wTranslate').checked = !!S.p.whisper.translate;
  setVal($('#wPrompt'), S.p.whisper.prompt || '');
  renderFixes();
  $('#searchTranscript').classList.toggle('hidden', !S.transcript);
  $('#btnTranscribeFull').textContent = S.transcript ? 'Re-transcribe whole stream' : 'Transcribe whole stream';
}
$('#wModel').addEventListener('change', e => { S.p.whisper.model = e.target.value; scheduleSave(); });
$('#wLang').addEventListener('change', e => { S.p.whisper.language = e.target.value; scheduleSave(); });
$('#wTranslate').addEventListener('change', e => { S.p.whisper.translate = e.target.checked; scheduleSave(); });
$('#wPrompt').addEventListener('input', e => { S.p.whisper.prompt = e.target.value; scheduleSave(); });

// word fixes
const fixes = () => (S.p.whisper.fixes = Array.isArray(S.p.whisper.fixes) ? S.p.whisper.fixes : []);
function renderFixes() {
  const list = fixes();
  $('#fixList').innerHTML = list.length
    ? list.map((f, i) => `<div class="fix"><span>${esc(f.from)}</span><span class="muted">→</span><b>${esc(f.to)}</b><button class="icon" data-rmfix="${i}" title="Remove this fix">✕</button></div>`).join('')
    : '<div class="muted small">No fixes yet.</div>';
}
function addFix(from, to) {
  from = String(from || '').trim(); to = String(to || '').trim();
  if (!from || !to) { toast('Type both the wrong word and the correct one', 'err'); return false; }
  const list = fixes();
  const old = list.find(f => f.from.toLowerCase() === from.toLowerCase());
  if (old) old.to = to; else list.push({ from, to });
  scheduleSave(); renderFixes();
  return true;
}
async function applyFixesEverywhere() {
  await saveNow();
  try {
    const r = await api('/api/fix-words', { method: 'POST', body: { slug: slug() } });
    if (r.count || r.echo) pushAction('word fixes');
    S.p = r.project;
    rebaseHistory();
    $('#chunkList').dataset.for = '';
    renderAll();
    const msg = r.count || r.echo ? `Fixed ${r.count + (r.echo || 0)} place${r.count + (r.echo || 0) > 1 ? 's' : ''} in your captions. Render again to update finished videos.` : 'Nothing to fix in the existing captions.';
    $('#fixInfo').textContent = msg; toast(msg, r.count ? 'ok' : '');
  } catch (e) { toast(e.message, 'err'); }
}
$('#btnAddFix').addEventListener('click', () => { if (addFix($('#fixFrom').value, $('#fixTo').value)) { $('#fixFrom').value = ''; $('#fixTo').value = ''; $('#fixFrom').focus(); } });
['fixFrom', 'fixTo'].forEach(id => $('#' + id).addEventListener('keydown', e => { if (e.key === 'Enter') $('#btnAddFix').click(); }));
$('#fixList').addEventListener('click', e => {
  const i = e.target.dataset.rmfix; if (i == null) return;
  fixes().splice(+i, 1); scheduleSave(); renderFixes();
});
$('#btnApplyFixes').addEventListener('click', applyFixesEverywhere);
$('#btnFixWord').addEventListener('click', async () => {
  const from = prompt('Which word or phrase is wrong in the captions? (e.g. made)');
  if (!from || !from.trim()) return;
  const to = prompt(`Replace "${from.trim()}" with:`);
  if (to == null || !addFix(from, to)) return;
  await applyFixesEverywhere();
});
$('#btnTranscribeFull').addEventListener('click', async () => {
  await saveNow();
  try { await api('/api/transcribe-full', { method: 'POST', body: { slug: slug() } }); toast('Transcribing the whole stream. This can take a while.'); pollSoon(); }
  catch (e) { toast(e.message, 'err'); }
});
$('#searchTranscript').addEventListener('input', e => {
  const q = e.target.value.trim().toLowerCase();
  const out = $('#searchResults');
  if (!q || !S.transcript) { out.innerHTML = ''; return; }
  const W = S.transcript.words, res = [];
  for (let i = 0; i < W.length && res.length < 50; i++) {
    const win = W.slice(i, i + 10).map(w => w.w).join(' ');
    if (win.toLowerCase().startsWith(q) || W[i].w.toLowerCase().includes(q)) {
      res.push({ t: W[i].s, text: W.slice(Math.max(0, i - 4), i + 10).map(w => w.w).join(' ') });
      i += 8;
    }
  }
  const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig');
  out.innerHTML = res.map(r => `<div data-t="${r.t}"><b class="mono">${fmt(r.t, false)}</b><span>${esc(r.text).replace(re, m => `<mark>${m}</mark>`)}</span><button class="btn small ghost" data-mkclip="${r.t}" title="${esc(tr('Make a 30 s clip starting just before this'))}">${esc(tr('＋ Clip'))}</button></div>`).join('') || `<span class="muted small">${esc(tr('No matches'))}</span>`;
});
$('#searchResults').addEventListener('click', e => {
  const mk = e.target.closest('[data-mkclip]');
  if (mk) {
    const t = +mk.dataset.mkclip, dur = S.p.meta.duration;
    const a = snapEdge(Math.max(0, t - 2), 'start').t;
    const b = snapEdge(Math.min(dur, a + 30), 'end').t;
    addClipAt(a, Math.max(b, Math.min(dur, a + 5)));
    return;
  }
  const d = e.target.closest('[data-t]'); if (d) seek(+d.dataset.t);
});
