'use strict';
// Toasts and the persistent banners under the top bar.

function toast(msg, kind = '', ms = 3500, actions = []) {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  for (const a of actions) {
    const b = document.createElement('button');
    b.className = 'btn small ghost'; b.textContent = a.label;
    b.addEventListener('click', () => { el.remove(); a.fn(); });
    el.appendChild(b);
  }
  $('#toasts').appendChild(el);
  if (ms) setTimeout(() => el.remove(), ms);
  return el;
}

// Persistent messages under the top bar, one per id.
function showBanner(id, kind, text, actions = []) {
  let el = document.querySelector(`.banner[data-id="${id}"]`);
  if (!el) { el = document.createElement('div'); el.className = 'banner'; el.dataset.id = id; el.setAttribute('role', kind === 'err' ? 'alert' : 'status'); $('#banners').appendChild(el); }
  el.className = `banner ${kind}`;
  el.innerHTML = `<span>${esc(text)}</span>`;
  for (const a of actions) {
    const b = document.createElement('button');
    b.className = `btn small ${a.primary ? 'primary' : 'ghost'}`; b.textContent = a.label;
    b.addEventListener('click', async () => { if (!a.keep) el.remove(); await a.fn(); });
    el.appendChild(b);
  }
}
function hideBanner(id) { document.querySelector(`.banner[data-id="${id}"]`)?.remove(); }
