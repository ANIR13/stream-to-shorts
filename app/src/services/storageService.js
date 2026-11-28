'use strict';
// Disk space used by a video's working files, cleaning them, and the automatic clean-up of leftovers.
// Nothing here touches recordings, finished shorts or project data (clips, edits, captions).
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const DAY = 86400000;
// What can be removed, and what it costs: everything is rebuilt automatically when needed.
const KINDS = {
  drafts: { label: 'Quick drafts', match: rel => rel.startsWith('drafts' + path.sep) || rel === 'drafts' },
  thumbs: { label: 'Thumbnails', match: rel => rel.startsWith('thumbs' + path.sep) || rel === 'thumbs' },
  preview: { label: 'Preview copy', match: rel => rel === 'proxy.mp4' },
  renderFiles: { label: 'Render working files', match: rel => rel.startsWith('render' + path.sep) },
  logs: { label: 'Logs', match: rel => rel.startsWith('logs' + path.sep) },
};
// Leftovers of interrupted work, always safe to remove.
const LEFTOVER = /(\.tmp|\.part|\.tmp\.mp4|\.w\.json)$|^r_.+\.wav$|^part_\d+\.tmp\.mp4$/;

async function walk(dir, base = dir) {
  const out = [];
  for (const d of await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) out.push(...await walk(p, base));
    else if (d.isFile()) { const st = await fsp.stat(p).catch(() => null); if (st) out.push({ path: p, rel: path.relative(base, p), size: st.size, mtime: st.mtimeMs }); }
  }
  return out;
}

function createStorageService({ repo, projectsDir, log = console }) {
  // Bytes per kind for one video, plus the total of its project folder.
  async function usage(slug) {
    const files = await walk(repo.projDir(slug));
    const out = { total: 0 };
    for (const k of Object.keys(KINDS)) out[k] = 0;
    for (const f of files) {
      out.total += f.size;
      const k = Object.keys(KINDS).find(x => KINDS[x].match(f.rel));
      if (k) out[k] += f.size;
    }
    return out;
  }

  // Remove the chosen kinds of working files of one video. Returns bytes freed.
  async function clean(slug, kinds) {
    const want = (kinds || []).filter(k => KINDS[k]);
    let freed = 0;
    for (const f of await walk(repo.projDir(slug))) {
      if (!want.some(k => KINDS[k].match(f.rel))) continue;
      await fsp.rm(f.path, { force: true }).then(() => { freed += f.size; }, () => {});
    }
    if (want.includes('preview')) await repo.update(slug, q => { delete q.proxyVer; delete q.proxyBuiltHeight; }).catch(() => {});
    return freed;
  }

  // At start-up: leftovers of interrupted work, drafts older than 14 days, thumbnails older than 30 days.
  async function autoClean(now = Date.now()) {
    let freed = 0, n = 0;
    const slugs = (await fsp.readdir(projectsDir, { withFileTypes: true }).catch(() => [])).filter(d => d.isDirectory() && !d.name.startsWith('.')).map(d => d.name);
    for (const slug of slugs) {
      for (const f of await walk(path.join(projectsDir, slug))) {
        const old = now - f.mtime;
        const name = path.basename(f.rel);
        const drop = (LEFTOVER.test(name) && old > 3600000)        // an hour old: not in use any more
          || (KINDS.drafts.match(f.rel) && old > 14 * DAY)
          || (KINDS.thumbs.match(f.rel) && old > 30 * DAY);
        if (drop) await fsp.rm(f.path, { force: true }).then(() => { freed += f.size; n++; }, () => {});
      }
    }
    if (n) log.log(`  Cleaned ${n} old working file(s), ${Math.round(freed / 1048576)} MB.`);
    return { files: n, bytes: freed };
  }

  return { usage, clean, autoClean, KINDS };
}

module.exports = { createStorageService, KINDS };
