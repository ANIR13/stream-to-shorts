'use strict';
// Per-video options menu.

const vmenu = $('#videoMenu');
function setVideoMenu(open) {
  vmenu.classList.toggle('hidden', !open);
  $('#btnVideoMenu').setAttribute('aria-expanded', String(open));
  if (!open) return;
  const r = $('#btnVideoMenu').getBoundingClientRect(), mw = Math.min(320, window.innerWidth - 16);
  vmenu.style.width = mw + 'px';
  vmenu.style.left = clamp(r.left, 8, window.innerWidth - mw - 8) + 'px';
  vmenu.style.top = (r.bottom + 6) + 'px';
  vmenu.querySelectorAll('[data-vm]').forEach(b => { b.disabled = !S.p; });
  if (S.p) {
    const sharp = Number(S.p.proxyHeight) === 720;
    $('#vmProxyTitle').textContent = tr(sharp ? 'Faster preview (360p)' : 'Sharper preview (720p)');
    $('#vmProxyNote').textContent = tr(sharp ? 'lighter preview copy, smoother on slow PCs; rendered shorts are not affected'
      : 'sharper player and 9:16 preview; rebuilding takes a few minutes; rendered shorts are not affected');
  }
}
$('#btnVideoMenu').addEventListener('click', e => { e.stopPropagation(); const open = vmenu.classList.contains('hidden'); setVideoMenu(open); if (open && e.detail === 0) vmenu.querySelector('[data-vm]:not(:disabled)')?.focus(); });
document.addEventListener('click', e => { if (!e.target.closest('#videoMenu') && !e.target.closest('#btnVideoMenu')) setVideoMenu(false); });
vmenu.addEventListener('click', async e => {
  const b = e.target.closest('[data-vm]'); if (!b || b.disabled || !S.p) return;
  setVideoMenu(false);
  if (b.dataset.vm === 'proxy') {
    const h = Number(S.p.proxyHeight) === 720 ? 360 : 720;
    try { await api('/api/proxy', { method: 'POST', body: { slug: slug(), height: h } }); S.p.proxyHeight = h; toast(`Building the ${h}p preview… you can keep working meanwhile.`); pollSoon(); }
    catch (err) { toast(err.message, 'err'); }
    return;
  }
  if (b.dataset.vm === 'project' || b.dataset.vm === 'output') { api('/api/open', { method: 'POST', body: { what: b.dataset.vm, slug: slug() } }).catch(err => toast(err.message, 'err')); return; }
  const file = S.p.video, sl = S.p.slug;
  if (!confirm(`Start "${file}" over?\nIts clips, titles, captions, word fixes and analysis go to the Recycle Bin. Finished shorts in the output folder are kept.`)) return;
  try {
    await saveNow();
    await api('/api/project/reset', { method: 'POST', body: { slug: sl } });
    HIST.delete(sl); try { localStorage.removeItem('ui:' + sl); } catch { /* ignore */ }
    S.p = null; S.dirty = false; S.sel = null;
    await openVideo(file);
    toast(tr('This video starts fresh. The old project is in the Recycle Bin.'), 'ok', 6000);
  } catch (err) { toast(err.message, 'err'); }
});
