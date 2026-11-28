'use strict';
// Integration: parallel tasks without conflicts, disk-space clean-up, source fingerprints.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { app, quiet, sleep, tmpApp } = require('../helpers');
const { createJobQueue, locksOf } = require(app('src/services/jobQueue'));
const { createProjectRepository } = require(app('src/repository/projectRepository'));
const { createStorageService } = require(app('src/services/storageService'));
const { fingerprint, sameContent } = require(app('src/infrastructure/fingerprint'));

// A queue whose tasks record when they start and end; each waits until released.
function harness(maxParallel) {
  const root = tmpApp('s2s-conc-').root;
  const log = [], gates = new Map();
  const specFn = spec => async () => {
    const key = spec.type + ':' + (spec.clipId || spec.slug);
    log.push('start ' + key);
    await new Promise(r => gates.set(key, r));
    log.push('end ' + key);
  };
  const q = createJobQueue({ queueFile: path.join(root, '.queue.json'), specFn, log: quiet, maxParallel });
  const release = async key => { for (let i = 0; i < 100 && !gates.has(key); i++) await sleep(5); gates.get(key)(); gates.delete(key); await sleep(10); };
  const running = () => q.active().filter(j => j.status === 'running').map(j => j.type + ':' + (j.clipId || j.slug));
  return { q, log, release, running };
}

test('concurrency: independent tasks run side by side, conflicting ones wait', async () => {
  const { q, release, running } = harness(2);
  q.addSpec({ type: 'render', slug: 'v', clipId: 'a' }, 'A');
  q.addSpec({ type: 'render', slug: 'v', clipId: 'a' }, 'A again');      // same clip: waits
  q.addSpec({ type: 'render', slug: 'v', clipId: 'b' }, 'B');            // other clip: runs now
  await sleep(20);
  assert.deepEqual(running().sort(), ['render:a', 'render:b']);
  await release('render:a');
  assert.deepEqual(running().sort(), ['render:a', 'render:b'], 'the second render of clip a starts once the first ends');
  await release('render:a'); await release('render:b');
  assert.equal(q.active().length, 0);
});

test('concurrency: speech recognition runs alone; analysis counts double; the limit can change', async () => {
  const { q, release, running } = harness(2);
  q.addSpec({ type: 'render', slug: 'v', clipId: 'a' }, 'A');
  q.addSpec({ type: 'transcribe', slug: 'v' }, 'T');
  q.addSpec({ type: 'render', slug: 'w', clipId: 'c' }, 'C');
  await sleep(20);
  assert.deepEqual(running().sort(), ['render:a', 'render:c'], 'the independent render passes the waiting transcription');
  await release('render:a');
  assert.deepEqual(running(), ['render:c'], 'whisper waits until it can run alone');
  await release('render:c');
  await sleep(20);
  assert.deepEqual(running(), ['transcribe:v']);
  q.addSpec({ type: 'render', slug: 'w', clipId: 'd' }, 'D');
  await sleep(20);
  assert.deepEqual(running(), ['transcribe:v'], 'nothing joins a running transcription');
  await release('transcribe:v');
  await release('render:d');
  // analysis (weight 2) fills a limit of 2
  q.addSpec({ type: 'analyze', slug: 'v' }, 'An');
  q.addSpec({ type: 'render', slug: 'w', clipId: 'e' }, 'E');
  await sleep(20);
  assert.deepEqual(running(), ['analyze:v']);
  assert.equal(q.setConcurrency(3), 3);
  await sleep(20);
  assert.deepEqual(running().sort(), ['analyze:v', 'render:e'], 'raising the limit starts the next task');
  await release('analyze:v'); await release('render:e');
  assert.equal(q.setConcurrency(99), 8, 'at most 8');
});

test('concurrency: one at a time keeps the old order; locks per task kind', async () => {
  const { q, log, release } = harness(1);
  q.addSpec({ type: 'render', slug: 'v', clipId: 'a' }, 'A');
  q.addSpec({ type: 'render', slug: 'v', clipId: 'b' }, 'B');
  await sleep(20);
  await release('render:a'); await release('render:b');
  assert.deepEqual(log, ['start render:a', 'end render:a', 'start render:b', 'end render:b']);
  assert.deepEqual(locksOf({ type: 'captions', slug: 'v', clipId: 'a' }), ['clip:v:a', 'transcript:v']);
  assert.deepEqual(locksOf({ type: 'analyze', slug: 'v' }), ['analysis:v', 'proxy:v']);
});

test('cancelling a task stops every process it started (analysis parts)', () => {
  const root = tmpApp().root;
  const q = createJobQueue({ queueFile: path.join(root, 'q.json'), specFn: () => () => new Promise(() => {}), log: quiet });
  const job = q.addSpec({ type: 'analyze', slug: 'v' }, 'An');
  let killed = 0;
  job.children = new Set([{ kill: () => killed++ }, { kill: () => killed++ }]);
  q.cancel(job);
  assert.equal(killed, 2);
});

test('fingerprints: same content is recognised, a replaced file is not', async () => {
  const dir = tmpApp().root;
  const f = path.join(dir, 'v.mp4');
  fs.writeFileSync(f, Buffer.alloc(500000, 7));
  const a = await fingerprint(f);
  assert.match(a, /^[a-z0-9]+-[a-z0-9]+-[0-9a-f]{16}$/);
  fs.utimesSync(f, new Date(), new Date(Date.now() + 60000));
  const b = await fingerprint(f);
  assert.notEqual(a, b);
  assert.ok(sameContent(a, b), 'touched or copied back: still the same video');
  const buf = Buffer.alloc(500000, 7); buf[250000] = 8;                       // one byte in the middle
  fs.writeFileSync(f, buf);
  assert.ok(!sameContent(a, await fingerprint(f)));
  fs.writeFileSync(f, Buffer.alloc(10));                                      // tiny files work too
  assert.match(await fingerprint(f), /-[0-9a-f]{16}$/);
});

test('disk space: usage per kind, cleaning a video, automatic clean-up of old leftovers', async () => {
  const dirs = tmpApp('s2s-store-');
  const repo = createProjectRepository({ ...dirs, probe: async () => ({}) });
  const pd = path.join(dirs.projectsDir, 'v');
  const put = (rel, size, ageDays = 0) => {
    const f = path.join(pd, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, Buffer.alloc(size));
    const t = new Date(Date.now() - ageDays * 86400000); fs.utimesSync(f, t, t);
  };
  put('project.json', 100); put('proxy.mp4', 5000); put('thumbs/1_320.jpg', 300); put('thumbs/old_320.jpg', 300, 40);
  put('drafts/c1.mp4', 2000); put('drafts/old.mp4', 2000, 20); put('render/c1/filter.txt', 50); put('logs/a.log', 70);
  put('transcripts/r_1_2_x.wav', 900, 1); put('proxy.tmp.mp4', 400, 1); put('analysis.json.tmp', 10); put('transcripts/full.json', 800);
  const storage = createStorageService({ repo, projectsDir: dirs.projectsDir, log: quiet });
  const u = await storage.usage('v');
  assert.deepEqual([u.preview, u.thumbs, u.drafts, u.renderFiles, u.logs], [5000, 600, 4000, 50, 70]);
  // start-up clean-up: old leftovers, old drafts and thumbnails; recent ones and real data stay
  const r = await storage.autoClean();
  assert.equal(r.files, 4);
  const left = p => fs.existsSync(path.join(pd, p));
  assert.ok(!left('transcripts/r_1_2_x.wav') && !left('proxy.tmp.mp4') && !left('drafts/old.mp4') && !left('thumbs/old_320.jpg'));
  assert.ok(left('analysis.json.tmp'), 'a leftover from the last minutes may still be in use');
  assert.ok(left('drafts/c1.mp4') && left('thumbs/1_320.jpg') && left('transcripts/full.json') && left('project.json') && left('proxy.mp4'));
  // cleaning chosen kinds
  assert.equal(await storage.clean('v', ['drafts', 'thumbs', 'bogus']), 2300);
  assert.ok(!left('drafts/c1.mp4') && left('proxy.mp4') && left('transcripts/full.json'));
});

test('a replaced recording is reported when its project opens, and detection refuses the old analysis', async () => {
  const { createApp } = require(app('../app/server'));
  const root = tmpApp('s2s-fp-').root;
  const src = path.join(root, 'source', 'v.mp4');
  fs.writeFileSync(src, Buffer.alloc(300000, 1));
  const fp = await fingerprint(src);
  fs.mkdirSync(path.join(root, 'projects', 'v'));
  fs.writeFileSync(path.join(root, 'projects', 'v', 'project.json'), JSON.stringify({ version: 5, video: 'v.mp4', slug: 'v', sourceFingerprint: fp, meta: { duration: 30, width: 1920, height: 1080, hasAudio: true }, clips: [] }));
  fs.writeFileSync(path.join(root, 'projects', 'v', 'analysis.json'), JSON.stringify({ rms: new Array(30).fill(-30), scene: new Array(30).fill(0), fingerprint: fp }));
  const a = createApp({ root, log: quiet });
  const server = await a.listen(0, { open: false });
  const port = server.address().port;
  const get = url => new Promise((resolve, reject) => http.get({ host: '127.0.0.1', port, path: url, headers: { Host: `127.0.0.1:${port}` } }, res => { let d = ''; res.on('data', c => { d += c; }); res.on('end', () => resolve(JSON.parse(d))); }).on('error', reject));
  try {
    assert.equal((await get('/api/project?video=v.mp4')).sourceChanged, undefined);
    fs.writeFileSync(src, Buffer.alloc(300000, 2));                         // replaced by another file
    assert.equal((await get('/api/project?video=v.mp4')).sourceChanged, true);
    await assert.rejects(a.detection.detect('v', {}, 'replace'), e => e.code === 409 && /changed since it was analyzed/.test(e.message));
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'projects', 'v', 'project.json'), 'utf8')).sourceChanged, undefined, 'never stored');
  } finally { a.stopTools(); server.close(); }
});
