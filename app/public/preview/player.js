'use strict';
// The video player and transport.

function seek(t) { if (S.p) player.currentTime = clamp(t, 0, S.p.meta.duration - 0.05); }
function togglePlay() { if (player.paused) { S.playUntil = null; player.play(); } else player.pause(); }
$('#btnPlay').addEventListener('click', togglePlay);
$('#btnPlayClip').addEventListener('click', playClip);
function playClip() {
  const c = selClip();
  if (!c) return;
  S.playUntil = c.end;
  seek(c.start); player.play();
}
player.addEventListener('play', () => { $('#btnPlay').textContent = '❚❚'; loop(); });
player.addEventListener('pause', () => { $('#btnPlay').textContent = '▶'; });
player.addEventListener('seeked', onTime);
player.addEventListener('loadeddata', onTime);
function onTime() {
  if (!S.p) return;
  $('#timeLabel').textContent = `${fmt(player.currentTime)} / ${fmt(S.p.meta.duration, false)}`;
  drawTimeline(); drawPreview(); markChunk();
  if (currentTab() === 'layout') drawLayoutCanvas();
}
function loop() {
  if (player.paused) return;
  skipCuts();
  if (S.playUntil != null && player.currentTime >= S.playUntil) {
    const c = selClip();
    if ($('#loopClip').checked && c) seek(c.start); else { player.pause(); S.playUntil = null; }
  }
  const t = player.currentTime, [v0, v1] = S.view;
  if (t > v1 && !tl.drag) { const w = v1 - v0; S.view = [t - w * 0.1, t + w * 0.9]; }
  onTime();
  requestAnimationFrame(loop);
}
