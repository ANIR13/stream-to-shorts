'use strict';
// A minimal headless browser driver for interface tests: starts Chrome / Edge / Chromium with the
// DevTools protocol and talks to it over a WebSocket. No npm packages. Returns null (tests skip)
// when no browser is installed or this Node.js has no WebSocket (Node 22+, or 20/21 with
// --experimental-websocket, which scripts/run-tests.js adds when available).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { onPath } = require('../app/src/infrastructure/process');

function findBrowser() {
  if (process.env.S2S_BROWSER) return fs.existsSync(process.env.S2S_BROWSER) ? process.env.S2S_BROWSER : null;
  const win = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'];
  if (process.platform === 'win32') return win.find(p => fs.existsSync(p)) || null;
  if (process.platform === 'darwin') return ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'].find(p => fs.existsSync(p)) || null;
  for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge']) { const p = onPath(name); if (p) return p; }
  return null;
}
const available = () => (typeof WebSocket === 'function' && findBrowser() ? true : false);
const WHY_UNAVAILABLE = typeof WebSocket !== 'function' ? 'this Node.js has no WebSocket (use Node 22+)' : 'no Chrome, Edge or Chromium found (set S2S_BROWSER)';

async function launch({ width = 1500, height = 950 } = {}) {
  const exe = findBrowser();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 's2s-browser-'));
  const port = 9400 + Math.floor(Math.random() * 500);
  const proc = spawn(exe, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--mute-audio',
    ...(process.platform === 'linux' ? ['--no-sandbox'] : []), `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    `--window-size=${width},${height}`, '--lang=en-US', 'about:blank'], { stdio: 'ignore' });
  let target;
  for (let i = 0; i < 100 && !target; i++) {
    await new Promise(r => setTimeout(r, 100));
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t => t.type === 'page'); } catch { /* starting */ }
  }
  if (!target) { proc.kill(); throw new Error('the browser did not start'); }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve); ws.addEventListener('error', reject); });
  let id = 0;
  const pending = new Map();
  const errors = [];
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map(a => a.value || a.description).join(' '));
  });
  // every command has a time limit, so a lost reply fails the test instead of hanging it
  const send = (method, params = {}, ms = 20000) => new Promise((resolve, reject) => {
    const i = ++id;
    const timer = setTimeout(() => { pending.delete(i); reject(new Error(`browser did not answer ${method} within ${ms} ms`)); }, ms);
    pending.set(i, m => { clearTimeout(timer); resolve(m); });
    try { ws.send(JSON.stringify({ id: i, method, params })); } catch (e) { clearTimeout(timer); pending.delete(i); reject(e); }
  });
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  const page = {
    errors,
    // Run JavaScript in the page; returns its (JSON) value, or throws the page's error.
    async eval(expr) {
      const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.result.exceptionDetails) throw new Error('in page: ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text).split('\n')[0]);
      return r.result.result.value;
    },
    async goto(url) { await send('Page.navigate', { url }); },
    // Wait until a page expression is truthy.
    async until(expr, ms = 10000) {
      const t0 = Date.now();
      for (;;) {
        try { if (await page.eval(expr)) return; } catch { /* not ready */ }
        if (Date.now() - t0 > ms) throw new Error('timed out waiting for: ' + expr);
        await new Promise(r => setTimeout(r, 50));
      }
    },
    // PNG screenshot of the page or of one element.
    async screenshot(selector) {
      let clip;
      if (selector) {
        await page.eval(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({ block: 'center' })`);
        clip = await page.eval(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, scale: 1 }; })()`);
      }
      const r = await send('Page.captureScreenshot', clip ? { clip } : {});
      return Buffer.from(r.result.data, 'base64');
    },
    async close() {
      try { await send('Browser.close', {}, 3000); } catch { /* already closed */ }
      try { ws.close(); } catch { /* closed */ }
      // the whole process tree: Chrome and Edge start helper processes
      if (process.platform === 'win32') { try { require('child_process').execFileSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ } }
      else proc.kill('SIGKILL');
      await new Promise(r => setTimeout(r, 200));
      // the browser may still be writing its profile for a moment: removing it is best-effort
      try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch { /* left in the temp folder */ }
    },
  };
  return page;
}

module.exports = { available, WHY_UNAVAILABLE, findBrowser, launch };
