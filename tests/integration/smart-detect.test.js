'use strict';
// Integration: the detection service with the smart engine, on a temporary project.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { app, tmpApp, fakeFfmpeg } = require('../helpers');
const { createProjectRepository } = require(app('src/repository/projectRepository'));
const { createDetectionService } = require(app('src/services/detectionService'));
const { parseWhisper, parseWhisperEvents } = require(app('src/core/captions'));

const say = (t, text) => text.split(' ').map((w, i) => ({ w, s: Math.round((t + i * 0.33) * 100) / 100, e: Math.round((t + i * 0.33 + 0.28) * 100) / 100 }));

async function setup() {
  const dirs = tmpApp('s2s-smart-');
  fs.writeFileSync(path.join(dirs.sourceDir, 'talk.mp4'), '');
  const repo = createProjectRepository({ ...dirs, probe: async () => ({ duration: 300, width: 1920, height: 1080, fps: 30, hasAudio: true, size: 1 }) });
  const p = await repo.open('talk.mp4');
  const rms = Array.from({ length: 300 }, (_, i) => -36 + (i % 7) * 0.3);
  for (let i = 40; i < 60; i++) rms[i] = -14;                            // loud, nothing said
  await repo.writeAnalysis(p.slug, { rms, scene: rms.map(() => 0.03) });
  const detection = createDetectionService({ repo, ffmpeg: fakeFfmpeg(), sourceDir: dirs.sourceDir });
  return { dirs, repo, detection, p };
}

test('smart detection needs the transcript, and says so', async () => {
  const { detection, p } = await setup();
  await assert.rejects(detection.detect(p.slug, { engine: 'smart' }, 'replace'), e => e.code === 400 && /Transcribe whole stream/.test(e.message));
  const fast = await detection.detect(p.slug, { engine: 'fast', count: 2, length: 20 }, 'replace');
  assert.equal(fast.detect.engine, 'fast');
  assert.equal(fast.clips[0].scoreEngine, undefined);
});

test('smart detection: clips with five-signal scores and reasons, settings saved', async () => {
  const { repo, detection, p } = await setup();
  const words = [].concat(
    say(150, 'Here is the trick nobody tells you: the timer resets when you pause.'),
    say(156, 'Why does that matter? Because you can finish the level with ten seconds left, every single time.'),
    say(200, 'okay we walk a bit here and look around.'),
  );
  fs.mkdirSync(repo.fileIn(p.slug, 'transcripts'), { recursive: true });
  fs.writeFileSync(repo.fileIn(p.slug, 'transcripts', 'full.json'), JSON.stringify({ key: 'x', start: 0, end: 300, words, events: [{ w: '(laughs)', s: 165, e: 166 }] }));
  const q = await detection.detect(p.slug, { engine: 'smart', count: 2, length: 25, wS: 0.5 }, 'replace');
  assert.deepEqual({ engine: q.detect.engine, wS: q.detect.wS, wA: q.detect.wA }, { engine: 'smart', wS: 0.5, wA: 0.2 });
  const talk = q.clips.find(c => c.start < 165 && c.end > 150);
  assert.ok(talk, JSON.stringify(q.clips.map(c => [c.start, c.end])));
  assert.equal(talk.scoreEngine, 'smart');
  assert.deepEqual(Object.keys(talk.scoreParts).sort(), ['audio', 'context', 'emotion', 'semantic', 'visual']);
  assert.ok(talk.scoreReasons.some(r => r.k === 'insight'));
  assert.ok(talk.scoreReasons.some(r => r.k === 'laughter'), 'whisper laughter tag used');
  // the project file keeps it all after a reload
  const again = await repo.load(p.slug);
  assert.deepEqual(again.clips.find(c => c.id === talk.id).scoreReasons, talk.scoreReasons);
});

test('whisper laughter tags become events, not captions', () => {
  const j = { transcription: [
    { text: ' so funny', offsets: { from: 0, to: 800 } },
    { text: ' [LAUGHTER]', offsets: { from: 900, to: 2000 } },
    { text: ' (rires)', offsets: { from: 2100, to: 2600 } },
    { text: ' ok', offsets: { from: 2700, to: 2900 } },
  ] };
  assert.deepEqual(parseWhisper(j, 100).map(w => w.w), ['so', 'funny', 'ok']);
  assert.deepEqual(parseWhisperEvents(j, 100), [{ w: '[laughter]', s: 100.9, e: 102 }, { w: '(rires)', s: 102.1, e: 102.6 }]);
});
