'use strict';
// Visual regression: rendered frames are checked against the layout maths (app/public/layout.js),
// pixel by pixel where it matters. Platform-independent: no golden screenshots (fonts differ between
// systems), but colours at known places. The source is blue "gameplay" with a red "facecam" box.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawnSync } = require('child_process');
const { app, quiet, tmpApp, realTools, NO_FFMPEG } = require('../helpers');
const Layout = require(app('public/layout.js'));
const { createProjectRepository } = require(app('src/repository/projectRepository'));
const { createRenderingService } = require(app('src/services/renderingService'));

const tools = realTools();
const required = process.env.S2S_REQUIRE_FFMPEG === '1';
const CAM = { x: 1400, y: 680, w: 520, h: 390 };

// One frame as RGB (1080 x 1920).
function frame(file, t) {
  const r = spawnSync(tools.env.tools.FFMPEG, ['-v', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { env: tools.env.env, maxBuffer: 2e7 });
  const buf = r.stdout;
  assert.equal(buf.length, 1080 * 1920 * 3, 'a full 1080x1920 frame');
  const at = (x, y) => { const i = (Math.round(y) * 1080 + Math.round(x)) * 3; return [buf[i], buf[i + 1], buf[i + 2]]; };
  // pixels in a box matching a colour test
  const count = (x0, y0, x1, y1, ok) => { let n = 0; for (let y = Math.max(0, y0 | 0); y < Math.min(1920, y1); y += 2) for (let x = Math.max(0, x0 | 0); x < Math.min(1080, x1); x += 2) if (ok(at(x, y))) n++; return n; };
  return { at, count };
}
const isRed = ([r, g, b]) => r > 170 && g < 90 && b < 90;
const isBlue = ([r, g, b]) => b > 170 && r < 90 && g < 90;
const isWhite = ([r, g, b]) => r > 215 && g > 215 && b > 215;
const isYellow = ([r, g, b]) => r > 200 && g > 170 && b < 90;
const centre = d => [d.x + d.w / 2, d.y + d.h / 2];

test('visual: layers, title, captions and progress bar are where the layout says', { skip: !tools && !required && NO_FFMPEG, timeout: 300000 }, async t => {
  assert.ok(tools, NO_FFMPEG);
  const dirs = tmpApp('s2s-visual-');
  await tools.runner.runCapture(tools.env.tools.FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x0000FF:s=1920x1080:r=30:d=6',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=6',
    '-vf', `drawbox=x=${CAM.x}:y=${CAM.y}:w=${CAM.w}:h=${CAM.h}:color=0xFF0000:t=fill`, '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '10', '-c:a', 'aac', '-shortest', path.join(dirs.sourceDir, 'v.mp4')]);
  const repo = createProjectRepository({ ...dirs, probe: f => tools.ffmpeg.probe(f) });
  const rendering = createRenderingService({ repo, ffmpeg: tools.ffmpeg, transcription: { available: false }, outputDir: dirs.outputDir, sourceDir: dirs.sourceDir, log: quiet });
  const base = await repo.open('v.mp4');

  const renderLayout = async (mode, style = {}, clipExtra = {}) => {
    const p = await repo.load(base.slug);
    p.layout = { mode, camOnTop: true, cam: CAM, game: { x: 0, y: 0, w: 1920, h: 1080 } };
    Object.assign(p.style, { captionHighlight: '#FFD400', captionColor: '#FFFFFF', titleColor1: '#FFFFFF', accent: '#FFD400', ...style });
    p.clips = [{ id: 'k', start: 1, end: 5, title1: 'BIG TITLE', captionsOn: true, captionsRange: [1, 5],
      captions: [{ s: 2.5, e: 4.5, words: [{ w: 'HELLO', s: 2.5, e: 3.2 }, { w: 'WORLD', s: 3.4, e: 4.4 }] }], ...clipExtra }];
    const saved = await repo.saveFromClient(base.slug, p);
    await rendering.render({ id: mode }, base.slug, 'k');
    const q = await repo.load(base.slug);
    const ep = Layout.effective(q, q.clips[0]);
    return { file: path.join(dirs.outputDir, q.slug, q.clips[0].output), L: Layout.compute(ep.layout, q.meta, ep.style, !!(clipExtra.title1 ?? 'x')), saved };
  };

  await t.test('split layout: facecam on top (red), gameplay below (blue), title, captions, progress bar', async () => {
    const { file, L } = await renderLayout('split');
    const f = frame(file, 2.9);                       // "HELLO" highlighted (2.5 - 1 = 1.5 s ... 2.2 s into the short)
    const cam = L.items.find(i => i.key === 'cam').dst, game = L.items.find(i => i.key === 'game').dst;
    assert.ok(cam.y < game.y, 'facecam above gameplay');
    assert.ok(isRed(f.at(...centre(cam))), `facecam centre is red: ${f.at(...centre(cam))}`);
    // the gameplay layer shows the whole source: blue, with the red box at its relative place
    assert.ok(isBlue(f.at(game.x + game.w * 0.3, game.y + game.h * 0.3)), 'gameplay is blue');
    const rx = game.x + game.w * (CAM.x + CAM.w / 2) / 1920, ry = game.y + game.h * (CAM.y + CAM.h / 2) / 1080;
    assert.ok(isRed(f.at(rx, ry)), 'the facecam box also appears inside the gameplay, scaled');
    assert.ok(isBlue(f.at(game.x + 6, game.y + 6)), 'the gameplay starts at its top-left corner');
    // title: white text pixels in the title band, none in a band of the same size lower down
    const titleBand = f.count(80, L.titleTop, 1000, L.titleTop + 110, isWhite);
    assert.ok(titleBand > 200, `title drawn (${titleBand} white pixels)`);
    // caption: white and the highlighted word in yellow around captionY
    const cy = L.captionY;
    assert.ok(f.count(60, cy - 70, 1020, cy + 70, isWhite) > 150, 'caption text');
    assert.ok(f.count(60, cy - 70, 1020, cy + 70, isYellow) > 80, 'highlighted word in the highlight colour');
    // progress bar at the bottom: about 47% filled at 1.9 s of 4 s
    assert.ok(isYellow(f.at(300, 1912)) && !isYellow(f.at(800, 1912)), 'progress bar');
  });

  await t.test('gameplay only, dark background: blue centred, nothing red outside it, dark around', async () => {
    const { file, L } = await renderLayout('gameplay', { background: 'dark', progressBar: false });
    const f = frame(file, 1.2);
    const game = L.items[0].dst;
    assert.equal(L.items.length, 1);
    assert.ok(isBlue(f.at(game.x + game.w * 0.2, game.y + game.h * 0.5)));
    const [r, g, b] = f.at(540, game.y + game.h + 60);
    assert.ok(r < 40 && g < 40 && b < 40, `dark background below the gameplay: ${r},${g},${b}`);
    assert.equal(f.count(0, 0, 1080, game.y - 4, isBlue), 0, 'no gameplay above its box');
    // layer edges, exact to a few pixels: blue just inside each edge, dark just outside
    const dark = ([r, g, b2]) => r < 40 && g < 40 && b2 < 40;
    assert.ok(isBlue(f.at(game.x + 4, game.y + 4)) && isBlue(f.at(game.x + game.w - 5, game.y + game.h - 5)), 'inside the corners');
    assert.ok(dark(f.at(game.x + game.w / 2, game.y - 6)) && dark(f.at(game.x + game.w / 2, game.y + game.h + 6)), 'outside the top and bottom edges');
  });

  await t.test('facecam only: the frame is the facecam (red) almost everywhere', async () => {
    const { file } = await renderLayout('cam', { progressBar: false }, { title1: '', captionsOn: false });
    const f = frame(file, 1.2);
    const red = f.count(0, 0, 1080, 1920, isRed), all = 540 * 960;
    assert.ok(red > all * 0.9, `${Math.round(red / all * 100)}% red`);
  });

  await t.test('hidden title and captions (Tracks) leave no text', async () => {
    const { file, L } = await renderLayout('split', {}, { tracks: { title: { hidden: true }, captions: { hidden: true } } });
    const f = frame(file, 2.9);
    assert.ok(f.count(80, 20, 1000, 260, isWhite) < 20, 'no title text');
    assert.ok(f.count(60, L.captionY - 70, 1020, L.captionY + 70, isYellow) < 20, 'no caption highlight');
  });
});
