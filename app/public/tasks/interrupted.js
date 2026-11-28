'use strict';
// Tasks interrupted when the app was closed: resume or dismiss.

async function checkInterrupted() {
  const list = await api('/api/interrupted').catch(() => []);
  if (!list.length) { hideBanner('interrupted'); return; }
  const names = list.slice(0, 3).map(x => x.label || x.type).join(', ') + (list.length > 3 ? ` and ${list.length - 3} more` : '');
  showBanner('interrupted', 'warn', `${list.length} task${list.length > 1 ? 's were' : ' was'} stopped when the app was closed: ${names}.`, [
    { label: 'Resume', primary: true, fn: async () => { const r = await api('/api/interrupted', { method: 'POST', body: { action: 'resume' } }); toast(`${r.length} task${r.length === 1 ? '' : 's'} added back to the queue`, 'ok'); askNotify(); pollSoon(); } },
    { label: 'Dismiss', fn: () => api('/api/interrupted', { method: 'POST', body: { action: 'dismiss' } }) },
  ]);
}
