'use strict';
// The video player modal.

function openVideoModal(src, name) {
  $('#modalVideo').src = src + (src.includes('?') ? '&' : '?') + 'v=' + Date.now();
  $('#modalName').textContent = name;
  $('#modal').classList.remove('hidden');
  $('#modalClose').focus();
  $('#modalVideo').play().catch(() => {});
}
function closeModal() { $('#modal').classList.add('hidden'); $('#modalVideo').pause(); $('#modalVideo').removeAttribute('src'); }
$('#modalClose').addEventListener('click', closeModal);
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
