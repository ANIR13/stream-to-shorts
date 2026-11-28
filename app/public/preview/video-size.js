'use strict';
// Video size (more room for the editor on small screens).

const SIZES = ['s', 'm', 'l'];
function setPlayerSize(sz) {
  document.body.classList.remove('player-s', 'player-m', 'player-l');
  document.body.classList.add('player-' + sz);
  store.set('playerSize', sz);
  $('#btnPlayerSize').textContent = tr('Video size') + ': ' + sz.toUpperCase();
  requestAnimationFrame(() => { drawTimeline(); drawLayoutCanvas(); });
}
$('#btnPlayerSize').addEventListener('click', () => {
  const cur = SIZES.find(z => document.body.classList.contains('player-' + z)) || 'm';
  setPlayerSize(SIZES[(SIZES.indexOf(cur) + 1) % SIZES.length]);
});
