'use strict';
// Integration: the local server only answers its own page, refuses paths outside its folders,
// validates imported files, and has limits. Runs the real HTTP server on a random local port.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { quiet, tmpApp, ROOT } = require('../helpers');
const { createApp } = require('../../app/server');

let app, port, root;
test.before(async () => {
  root = tmpApp('s2s-sec-').root;
  app = createApp({ root, log: quiet, limits: { maxUploadBytes: 1000, minFreeBytes: 0, maxQueued: 3 } });
  const server = await app.listen(0, { open: false });
  port = server.address().port;
  // a video and its project, written directly (no ffmpeg needed)
  fs.writeFileSync(path.join(root, 'source', 'stream.mp4'), 'not really a video');
  fs.mkdirSync(path.join(root, 'projects', 'stream'));
  fs.writeFileSync(path.join(root, 'projects', 'stream', 'project.json'), JSON.stringify({ version: 2, video: 'stream.mp4', slug: 'stream', meta: { duration: 60, width: 1920, height: 1080, fps: 30, hasAudio: true }, clips: [] }));
});
test.after(() => { app.stopTools(); app.server.close(); });

// One HTTP request. headers default to what the app's own page sends.
function req(method, url, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const h = { Host: `127.0.0.1:${port}`, 'Sec-Fetch-Site': 'same-origin', ...headers };
    for (const k of Object.keys(h)) if (h[k] == null) delete h[k];
    const r = http.request({ host: '127.0.0.1', port, method, path: url, headers: h }, res => {
      let data = '';
      res.on('data', d => { data += d; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    r.on('error', reject);
    if (body != null) r.write(body);
    r.end();
  });
}
const post = (url, obj, headers = {}) => req('POST', url, { headers: { 'Content-Type': 'application/json', Origin: `http://127.0.0.1:${port}`, ...headers }, body: JSON.stringify(obj) });

test('the server listens on 127.0.0.1 only', () => {
  assert.equal(app.server.address().address, '127.0.0.1');
});

test('requests from other websites are refused (cross-site requests, DNS rebinding)', async () => {
  assert.equal((await req('GET', '/api/videos')).status, 200);                                            // the app's page
  assert.equal((await req('GET', '/api/videos', { headers: { Host: `localhost:${port}` } })).status, 200);
  assert.equal((await req('GET', '/api/videos', { headers: { 'Sec-Fetch-Site': null } })).status, 200);   // curl, old browsers
  // DNS rebinding: a hostile domain that resolves to 127.0.0.1
  assert.equal((await req('GET', '/api/videos', { headers: { Host: `evil.example:${port}` } })).status, 403);
  assert.equal((await req('GET', '/', { headers: { Host: 'evil.example' } })).status, 403);
  // a page on another site (or another local port) sending commands
  assert.equal((await req('GET', '/api/videos', { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  assert.equal((await req('GET', '/media/source/stream/x', { headers: { 'Sec-Fetch-Site': 'same-site' } })).status, 403);
  assert.equal((await post('/api/jobs/cancel', { all: true }, { 'Sec-Fetch-Site': 'cross-site', Origin: 'https://evil.example' })).status, 403);
  assert.equal((await post('/api/jobs/cancel', { all: true }, { 'Sec-Fetch-Site': null, Origin: 'https://evil.example' })).status, 403);
  assert.equal((await post('/api/jobs/cancel', { all: true }, { 'Sec-Fetch-Site': null, Origin: 'null' })).status, 403);
  assert.equal((await post('/api/jobs/cancel', { all: true })).status, 200);
});

test('security headers on every answer, a strict content policy on the page', async () => {
  for (const url of ['/', '/app.js', '/api/videos', '/nope']) {
    const r = await req('GET', url);
    assert.equal(r.headers['x-content-type-options'], 'nosniff', url);
    assert.equal(r.headers['x-frame-options'], 'DENY', url);
    assert.equal(r.headers['cross-origin-resource-policy'], 'same-origin', url);
    assert.equal(r.headers['referrer-policy'], 'no-referrer', url);
  }
  const csp = (await req('GET', '/')).headers['content-security-policy'];
  assert.match(csp, /script-src 'self'(;|$)/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /connect-src 'self'/);
});

test('paths outside the app folders are refused', async () => {
  const secret = fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8');
  const urls = [
    '/api/project?video=../../package.json', '/api/project?video=..%5C..%5Cpackage.json', '/api/project?video=%2Fetc%2Fpasswd',
    '/api/project?video=stream.mp4%00.txt', '/api/project?video=.hidden.mp4',
    '/..%2f..%2fpackage.json', '/%2e%2e/%2e%2e/package.json', '/..%5c..%5cpackage.json',
    '/media/output/stream/..%2f..%2f..%2fpackage.json', '/media/output-other/..%2f..%2fpackage.json',
    '/media/draft/stream/..%2f..%2f..%2fpackage.json', '/media/proxy/..%2f..%2f/x',
    '/api/frame?slug=../../..&t=1&w=100',
  ];
  for (const url of urls) {
    const r = await req('GET', url);
    assert.ok(r.status >= 400 && r.status < 500, `${url} -> ${r.status}`);
    assert.ok(!r.body.includes('"stream-to-shorts"') && !r.body.includes(secret.slice(0, 40)), `${url} leaked a file`);
  }
});

test('imported videos: names, sizes and interrupted imports', async () => {
  const put = (name, body, headers = {}) => req('PUT', '/api/upload?name=' + encodeURIComponent(name), { headers: { Origin: `http://127.0.0.1:${port}`, 'Content-Length': Buffer.byteLength(body), ...headers }, body });
  for (const bad of ['../evil.mp4', '..\\evil.mp4', 'sub/evil.mp4', 'C:\\evil.mp4', '.hidden.mp4', 'CON.mp4', 'nul.mkv', 'a<b>.mp4', 'tab\there.mp4', 'evil.mp4.', 'evil.exe', 'evil.html', 'x'.repeat(250) + '.mp4']) {
    const r = await put(bad, 'data');
    assert.equal(r.status, 400, `${JSON.stringify(bad)} -> ${r.status} ${r.body}`);
  }
  assert.equal((await put('big.mp4', 'x'.repeat(1001))).status, 413);
  assert.equal((await put('ok clip.mp4', 'tiny video')).status, 200);
  assert.equal(fs.readFileSync(path.join(root, 'source', 'ok clip.mp4'), 'utf8'), 'tiny video');
  assert.equal((await put('ok clip.mp4', 'again')).status, 409);                       // never overwrites
  // announced size doesn't match what arrives: nothing is kept
  await new Promise(resolve => {
    const r = http.request({ host: '127.0.0.1', port, method: 'PUT', path: '/api/upload?name=cut.mp4', headers: { Host: `127.0.0.1:${port}`, 'Content-Length': 500 } }, res => { res.resume(); res.on('end', resolve); });
    r.on('error', resolve);
    r.write('only part of it');
    setTimeout(() => r.destroy(), 100);
  });
  await new Promise(r => setTimeout(r, 100));
  const left = fs.readdirSync(path.join(root, 'source'));
  assert.deepEqual(left.sort(), ['ok clip.mp4', 'stream.mp4'], 'no partial or temporary files left');
});

test('limits: the task list is capped, bad JSON is refused', async () => {
  const forever = () => new Promise(() => {});
  for (let i = 0; i < 3; i++) app.queue.add('transcribe', 'Busy ' + i, 'stream', forever);
  const r = await post('/api/transcribe-full', { slug: 'stream' });
  assert.equal(r.status, 429);
  assert.match(JSON.parse(r.body).error, /already 3 tasks/);
  app.queue.active().forEach(app.queue.cancel);
  const bad = await req('POST', '/api/project', { headers: { Origin: `http://127.0.0.1:${port}`, 'Content-Type': 'application/json' }, body: '{"slug": ' });
  assert.equal(bad.status, 400);
});

test('closing the app stops the running tool', () => {
  let killed = 0;
  const job = app.queue.add('render', 'Render', 'stream', () => new Promise(() => {}));
  job.child = { kill: () => { killed++; } };
  app.stopTools();
  assert.equal(killed, 1);
  app.queue.cancel(job);
});
