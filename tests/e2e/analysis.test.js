'use strict';
// End-to-end: analysis of a long recording in parts with the real FFmpeg: same results as one pass,
// resumes after an interruption, starts over for a replaced file; the background waveform.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { app, tmpApp, realTools, NO_FFMPEG, probeJSON } = require('../helpers');
const { createProjectRepository } = require(app('src/repository/projectRepository'));
const { createDetectionService } = require(app('src/services/detectionService'));
const { fingerprint } = require(app('src/infrastructure/fingerprint'));

const tools = realTools();
const required = process.env.S2S_REQUIRE_FFMPEG === '1';
const SECONDS = 45;

test('analysis in parts: same as one pass, resumable, parallel; waveform', { skip: !tools && !required && NO_FFMPEG, timeout: 300000 }, async () => {
  assert.ok(tools, NO_FFMPEG);
  const dirs = tmpApp('s2s-an-');
  // loud from 20 to 26 s, busy picture from 30 to 38 s
  await tools.runner.runCapture(tools.env.tools.FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=size=1280x720:rate=30:duration=${SECONDS}`,
    '-f', 'lavfi', '-i', `sine=frequency=500:sample_rate=48000:duration=${SECONDS}`,
    '-filter_complex', "[1]volume='if(between(t,20,26),0.9,0.01)':eval=frame[a];[0]hue=s='if(between(t,30,38),8,1)'[v]",
    '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', path.join(dirs.sourceDir, 'long.mp4')]);
  const repo = createProjectRepository({ ...dirs, probe: f => tools.ffmpeg.probe(f) });
  const p = await repo.open('long.mp4');
  const analyzeWith = async (opts, ffmpeg = tools.ffmpeg) => {
    const detection = createDetectionService({ repo, ffmpeg, sourceDir: dirs.sourceDir, fingerprint, ...opts });
    const job = { id: 1 };
    await detection.analyze(job, p.slug);
    return { a: await repo.readAnalysis(p.slug), job, detection };
  };

  // one pass (parts longer than the video)
  const one = (await analyzeWith({ partSeconds: 900 })).a;
  assert.equal(one.rms.length, Math.ceil(SECONDS));
  // ten-second parts, two at a time
  const many = (await analyzeWith({ partSeconds: 10, parallelParts: 2 })).a;
  assert.equal(many.rms.length, one.rms.length);
  const diff = many.rms.map((v, i) => Math.abs(v - one.rms[i]));
  assert.ok(diff.filter(d => d > 0.5).length <= 2, `loudness per second matches (differences: ${diff.map(d => d.toFixed(1)).join(' ')})`);
  assert.ok(Math.max(...many.rms.slice(21, 25)) > Math.max(...many.rms.slice(5, 15)) + 20, 'the loud part is found');
  assert.ok(Math.max(...many.scene.slice(31, 37)) > 0, 'the busy part is found');
  assert.equal(many.fingerprint, await fingerprint(path.join(dirs.sourceDir, 'long.mp4')));
  // the joined preview copy is complete and playable
  const prox = await probeJSON(tools, repo.fileIn(p.slug, 'proxy.mp4'));
  assert.ok(Math.abs(Number(prox.format.duration) - SECONDS) < 0.5, `preview ${prox.format.duration} s`);
  assert.equal(prox.streams.find(s => s.codec_type === 'video').height, 360);
  assert.equal(fs.existsSync(repo.fileIn(p.slug, 'analysis-parts')), false, 'parts removed when finished');
  assert.equal((await repo.load(p.slug)).sourceFingerprint, many.fingerprint);

  // interrupted after two parts: the next analysis only does the rest
  let runs = 0;
  const failing = { ...tools.ffmpeg, filterArg: tools.ffmpeg.filterArg, run: (job, args, o) => { if (args.includes('-ss') && ++runs > 2) return Promise.reject(new Error('ffmpeg failed (code 1)\nsimulated crash')); return tools.ffmpeg.run(job, args, o); } };
  await assert.rejects(analyzeWith({ partSeconds: 10, parallelParts: 1 }, failing), /simulated crash/);
  const kept = fs.readdirSync(repo.fileIn(p.slug, 'analysis-parts')).filter(n => /^part_\d+\.json$/.test(n));
  assert.equal(kept.length, 2);
  let parts = 0;
  const counting = { ...tools.ffmpeg, filterArg: tools.ffmpeg.filterArg, run: (job, args, o) => { if (args.includes('-ss')) parts++; return tools.ffmpeg.run(job, args, o); } };
  const resumed = await analyzeWith({ partSeconds: 10, parallelParts: 1 }, counting);
  assert.equal(parts, 3, 'only the 3 missing parts of 5 were analyzed');
  assert.deepEqual(resumed.a.rms, many.rms);

  // waveform: 0.1 s steps, loud where the sound is loud
  await resumed.detection.waveform({ id: 2 }, p.slug);
  const w = JSON.parse(fs.readFileSync(repo.fileIn(p.slug, 'waveform.json'), 'utf8'));
  const bytes = Buffer.from(w.data, 'base64');
  assert.equal(w.step, 0.1);
  assert.equal(bytes.length, Math.ceil(SECONDS * 10));
  const avg = (a, b) => [...bytes.subarray(a * 10, b * 10)].reduce((x, y) => x + y, 0) / ((b - a) * 10);
  assert.ok(avg(21, 25) > avg(5, 15) + 60, `waveform loud ${avg(21, 25)} vs quiet ${avg(5, 15)}`);
});
