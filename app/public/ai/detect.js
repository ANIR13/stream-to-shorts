'use strict';
// The Auto-detect popover (fast / smart engine, weights).

// auto-detect popover (defaults match the server's DETECT_DEFAULTS)
const DETECT_DEFAULTS = { count: 12, length: 55, wAudio: 1, wPeak: 0.5, wVisual: 0.3, gap: 3, engine: 'fast', wA: 0.2, wV: 0.15, wS: 0.35, wE: 0.2, wC: 0.1 };
const FAST_W = ['wAudio', 'wPeak', 'wVisual'], SMART_W = ['wA', 'wV', 'wS', 'wE', 'wC'];
$('#btnDetect').addEventListener('click', async () => {
  if (S.p && !$('#detectPop')) await ensureTranscript();
  if (!S.p.analyzed) return toast('Analyze the video first. Auto-detect uses the loudness and action scan.', 'err');
  let pop = $('#detectPop');
  if (pop) return pop.remove();
  pop = document.createElement('div');
  pop.id = 'detectPop';
  pop.className = 'caption-box';
  const d = { ...DETECT_DEFAULTS, ...(S.p.detect || {}) };
  const slider = (id, key, label, hint, max = 3, step = 0.1) => `<label class="w-row" title="${esc(tr(hint))}"><span><i class="dot p-${key}"></i>${esc(tr(label))} <output id="${id}Out">${Number(d[id]).toFixed(max === 1 ? 2 : 1)}</output></span><input id="${id}" type="range" min="0" max="${max}" step="${step}" value="${Number(d[id])}"></label>`;
  const hasTranscript = !!(S.transcript && S.transcript.words && S.transcript.words.length);
  pop.innerHTML = `<div class="grid2"><label>How many<input id="dCount" type="number" min="1" max="40" value="${d.count}"></label>
    <label>Seconds each<input id="dLen" type="number" min="10" max="60" value="${d.length}"></label></div>
    <div class="engine-pick" role="radiogroup">
      <label><input type="radio" name="dEngine" value="fast"${d.engine !== 'smart' ? ' checked' : ''}> <b>Fast</b> <span class="muted small">sound and action</span></label>
      <label><input type="radio" name="dEngine" value="smart"${d.engine === 'smart' ? ' checked' : ''}> <b>Smart</b> <span class="muted small">also what is said</span></label>
    </div>
    <p class="muted small" data-for="fast">Finds the loudest, most action-packed moments: reactions, hype and big plays.</p>
    <p class="muted small" data-for="smart">Also listens to what is said: jokes and laughter, gaming moments, explanations, questions and answers, even when it is quiet. Clips start and end on complete sentences.</p>
    ${hasTranscript ? '' : '<p class="small warn-text" data-for="smart">Smart detection needs the transcript of the whole stream. <button class="btn small ghost" data-transcribe>Transcribe whole stream</button></p>'}
    <details class="detect-adv"><summary>Advanced: what counts as a great moment</summary>
      <div data-for="fast">
      ${slider('wAudio', 'audio', 'Loudness', 'Sustained loud moments: excitement, shouting, music')}
      ${slider('wPeak', 'peak', 'Sudden spikes', 'Short bursts: a scream, an explosion, a big reaction')}
      ${slider('wVisual', 'visual', 'On-screen action', 'Lots of change on screen: fights, fast moves, scene changes')}
      </div>
      <div data-for="smart">
      ${slider('wA', 'audio', 'Audio excitement', 'Loud and sudden sounds', 1, 0.05)}
      ${slider('wV', 'visual', 'Visual activity', 'Change on screen', 1, 0.05)}
      ${slider('wS', 'semantic', 'What is said', 'Gaming events, explanations and facts, questions, your words to expect', 1, 0.05)}
      ${slider('wE', 'emotion', 'Emotion', 'Laughter, excitement, surprise, frustration, enthusiasm', 1, 0.05)}
      ${slider('wC', 'context', 'Complete moment', 'Whole sentences, a question with its answer, a setup with its punchline', 1, 0.05)}
      <p class="muted small">Starting points, not proven best values: adjust them to your streams.</p>
      </div>
      <label class="w-row">Minimum spacing between moments (s)<input id="dGap" type="number" min="0" max="600" value="${d.gap}"></label>
      <div class="row gap"><button class="btn small ghost" data-reset>Reset to defaults</button><span class="muted small">0 turns a signal off.</span></div>
    </details>
    <div class="row gap"><button class="btn small primary" data-mode="add">Add new moments</button><button class="btn small danger" data-mode="replace">Replace all clips</button></div>`;
  pop.addEventListener('input', e => { const o = pop.querySelector('#' + e.target.id + 'Out'); if (o) o.textContent = Number(e.target.value).toFixed(SMART_W.includes(e.target.id) ? 2 : 1); });
  const engine = () => pop.querySelector('[name=dEngine]:checked').value;
  const showEngine = () => pop.querySelectorAll('[data-for]').forEach(x => x.classList.toggle('hidden', x.dataset.for !== engine()));
  pop.addEventListener('change', e => { if (e.target.name === 'dEngine') showEngine(); });
  showEngine();
  $('.select-row').before(pop);
  pop.addEventListener('click', async e => {
    if (e.target.closest('[data-transcribe]')) { pop.remove(); $('#btnTranscribeFull').click(); return; }
    if (e.target.closest('[data-reset]')) {
      for (const k of FAST_W.concat(SMART_W)) { pop.querySelector('#' + k).value = DETECT_DEFAULTS[k]; pop.querySelector('#' + k + 'Out').textContent = DETECT_DEFAULTS[k].toFixed(SMART_W.includes(k) ? 2 : 1); }
      pop.querySelector('#dGap').value = DETECT_DEFAULTS.gap;
      return;
    }
    const mode = e.target.dataset.mode;
    if (!mode) return;
    if (mode === 'replace' && !confirm('Replace all clips (including your edits) with new suggestions?')) return;
    await saveNow();
    try {
      pushAction(mode === 'replace' ? 'auto-detect (replace)' : 'auto-detect');
      S.p = await api('/api/detect', { method: 'POST', body: { slug: slug(), count: +$('#dCount').value, length: +$('#dLen').value,
        wAudio: +$('#wAudio').value, wPeak: +$('#wPeak').value, wVisual: +$('#wVisual').value, gap: +$('#dGap').value, mode,
        engine: engine(), ...Object.fromEntries(SMART_W.map(k => [k, +$('#' + k).value])) } });
      S.sel = S.p.clips[0]?.id || null;
      rebaseHistory();
      pop.remove(); renderAll(); toast('Moments updated. Ctrl+Z undoes this.', 'ok');
    } catch (err) { toast(err.message, 'err'); }
  });
});
