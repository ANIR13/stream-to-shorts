'use strict';
// End-to-end: the real interface in a headless browser, on a demo project (synthetic data).
// Every feature file of app/public must load and work together: clip list, editor, why panel,
// tabs, auto-detect, undo / redo, preview, timeline, help, language. Any script error fails the test.
// Skipped when no Chrome / Edge / Chromium is installed or Node.js has no WebSocket.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { quiet, tmpApp } = require('../helpers');
const browser = require('../browser');
const { createApp } = require('../../app/server');

const say = (t, text) => text.split(' ').map((w, i) => ({ w, s: Math.round((t + i * 0.33) * 100) / 100, e: Math.round((t + i * 0.33 + 0.28) * 100) / 100 }));

// A demo video folder: a project with three clips (smart, fast, made by hand), its analysis and transcript.
function demo(root) {
  fs.writeFileSync(path.join(root, 'source', 'demo stream.mp4'), Buffer.alloc(1024));
  const dir = path.join(root, 'projects', 'demo_stream');
  fs.mkdirSync(path.join(dir, 'transcripts'), { recursive: true });
  const n = 600;
  const rms = Array.from({ length: n }, (_, i) => -36 + (i % 9) * 0.4 + (i >= 100 && i < 130 ? 20 : 0));
  fs.writeFileSync(path.join(dir, 'analysis.json'), JSON.stringify({ rms, scene: rms.map(() => 0.03) }));
  const words = say(300, 'Did you know the trick is to wait for the second wave? Because the boss resets its shield.');
  fs.writeFileSync(path.join(dir, 'transcripts', 'full.json'), JSON.stringify({ key: 'demo', start: 0, end: n, words }));
  fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify({
    version: 3, video: 'demo stream.mp4', slug: 'demo_stream', analyzed: true,
    meta: { duration: n, width: 1920, height: 1080, fps: 30, hasAudio: true, size: 1024 },
    layout: { mode: 'split', camOnTop: true, cam: { x: 1400, y: 680, w: 520, h: 390 }, game: { x: 0, y: 0, w: 1920, h: 1080 } },
    detect: { count: 12, length: 55, wAudio: 1, wPeak: 0.5, wVisual: 0.3, gap: 3, engine: 'smart', wA: 0.2, wV: 0.15, wS: 0.35, wE: 0.2, wC: 0.1 },
    setup: { layout: true },
    clips: [
      { id: 'quiet1', num: 1, start: 299, end: 318, title1: 'THE TRICK', title2: 'NOBODY KNOWS', score: 42, scoreEngine: 'smart',
        scoreParts: { audio: 0, visual: 0, semantic: 1, emotion: 0, context: 0.7 }, scoreWeights: { audio: 0.2, visual: 0.15, semantic: 0.35, emotion: 0.2, context: 0.1 },
        scoreReasons: [{ k: 'quiet' }, { k: 'insight', w: 'Did you know', t: 300 }, { k: 'qa', t: 303.6 }],
        captionsOn: true, captions: [{ s: 300, e: 302, words: words.slice(0, 5) }], captionsRange: [299, 318] },
      { id: 'loud2', num: 2, start: 100, end: 130, title1: 'LOUD', score: 90, scoreParts: { audio: 2.4, peak: 1.5, visual: 0.2 }, scoreWeights: { audio: 1, peak: 0.5, visual: 0.3 } },
      { id: 'hand3', num: 3, start: 400, end: 420, title1: '' },
    ],
  }));
}

test('the interface works end to end in a browser', { skip: !browser.available() && browser.WHY_UNAVAILABLE, timeout: 120000 }, async () => {
  const root = tmpApp('s2s-ui-').root;
  demo(root);
  const app = createApp({ root, log: quiet });
  const server = await app.listen(0, { open: false });
  const url = `http://127.0.0.1:${server.address().port}/`;
  const page = await browser.launch();
  try {
    // start in English whatever the system language is, with the demo video open
    await page.goto(url);
    await page.until(`document.readyState === 'complete'`);
    await page.eval(`localStorage.setItem('lang', 'en'); localStorage.setItem('lastVideo', 'demo stream.mp4'); location.reload()`);
    await page.until(`document.documentElement.lang === 'en' && document.readyState === 'complete'`);
    await page.until(`typeof S === 'object' && S.p && S.p.slug === 'demo_stream'`);

    // every feature file loaded (one global from each area)
    for (const name of ['esc', 'api', 'toast', 'undo', 'openVideo', 'explainScore', 'renderClipList', 'seek', 'drawTimeline',
      'renderEditor', 'renderCaptionStatus', 'setClipTime', 'switchTab', 'renderStyleTab', 'renderCaptionsTab', 'loadExports',
      'closeModal', 'drawPreview', 'pollJobs', 'notify', 'renderJobs', 'importFile', 'keyFeedback', 'checkInterrupted']) {
      assert.equal(await page.eval(`typeof ${name}`), 'function', `${name} is defined`);
    }

    // clip list
    await page.until(`document.querySelectorAll('#clipList .clip').length === 3`);
    assert.match(await page.eval(`document.querySelector('#clipList').innerText`), /THE TRICK/);

    // select the smart clip: editor fields and the why panel
    await page.eval(`selectClip('quiet1', false)`);
    assert.equal(await page.eval(`document.querySelector('#fTitle1').value`), 'THE TRICK');
    const why = await page.eval(`document.querySelector('#whyMoment').innerText`);
    assert.match(why, /Smart detection/);
    assert.match(why, /Quiet but meaningful/);
    assert.match(why, /Did you know/);
    // clicking a reason's time moves the playhead request (seek is clamped to the video)
    await page.eval(`document.querySelector('#whyMoment [data-seek]').click()`);

    // a hand-made clip explains that it has no detection details
    await page.eval(`selectClip('hand3', false)`);
    assert.match(await page.eval(`document.querySelector('#whyMoment').innerText`), /Made by hand/);

    // every tab shows
    for (const tab of ['layout', 'style', 'captions', 'exports', 'edit']) {
      await page.eval(`switchTab(${JSON.stringify(tab)})`);
      assert.equal(await page.eval(`currentTab()`), tab);
      assert.equal(await page.eval(`document.querySelector('.tab[data-tab="${tab}"]').classList.contains('hidden')`), false);
    }

    // editing a title, then undo and redo
    await page.eval(`selectClip('loud2', false); const i = document.querySelector('#fTitle1'); i.value = 'CHANGED'; i.dispatchEvent(new Event('input', { bubbles: true }))`);
    await page.until(`S.p.clips.find(c => c.id === 'loud2').title1 === 'CHANGED'`);
    await page.eval(`undo()`);
    await page.until(`S.p.clips.find(c => c.id === 'loud2').title1 === 'LOUD'`);
    await page.eval(`redo()`);
    await page.until(`S.p.clips.find(c => c.id === 'loud2').title1 === 'CHANGED'`);

    // auto-detect popover: smart engine is selected (saved per video), weights are there
    await page.eval(`document.querySelector('#btnDetect').click()`);
    await page.until(`!!document.querySelector('#detectPop')`);
    assert.equal(await page.eval(`document.querySelector('#detectPop [name=dEngine]:checked').value`), 'smart');
    assert.equal(await page.eval(`document.querySelector('#wS').value`), '0.35');
    await page.eval(`document.querySelector('#detectPop [name=dEngine][value=fast]').click()`);
    assert.equal(await page.eval(`document.querySelector('#detectPop [data-for=smart]').classList.contains('hidden')`), true);
    await page.eval(`document.querySelector('#btnDetect').click()`);   // closes it

    // the 9:16 preview and the timeline are drawn
    const painted = id => page.eval(`(() => { const c = document.querySelector('#${id}'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n; })()`);
    await page.eval(`drawPreview(); drawTimeline()`);
    assert.ok(await painted('preview') > 1000, 'preview drawn');
    assert.ok(await painted('timeline') > 1000, 'timeline drawn');

    // keyboard help
    await page.eval(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true }))`);
    await page.until(`!document.querySelector('#help').classList.contains('hidden')`);
    await page.eval(`toggleHelp(false)`);

    // French
    await page.eval(`(() => { const s = document.querySelector('#langSelect'); s.value = 'fr'; s.dispatchEvent(new Event('change')); })()`);
    await page.until(`document.querySelector('#btnDetect').textContent.includes('Détection')`, 15000);
    await page.until(`typeof S === 'object' && S.p && S.p.slug === 'demo_stream'`);
    await page.eval(`selectClip('quiet1', false)`);
    assert.match(await page.eval(`document.querySelector('#whyMoment').innerText`), /Calme mais intéressant/);

    // saving reached the server
    await page.eval(`saveNow()`);
    assert.equal((await app.repo.load('demo_stream')).clips.find(c => c.id === 'loud2').title1, 'CHANGED');

    const errors = page.errors.filter(e => !/Failed to load resource|media|MEDIA_ERR|NotSupportedError|play\(\)/i.test(e));
    assert.deepEqual(errors, [], 'no script errors');
  } finally {
    // always stop the server, even if closing the browser fails (an open server keeps the test running)
    try { await page.close(); } finally {
      app.stopTools();
      server.closeAllConnections?.();
      server.close();
    }
  }
});
