'use strict';
// Export service: finished shorts in output/, their upload texts, and deleting them (to the trash).
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { exists, inside, slugify } = require('../shared/fsutil');
const { httpError } = require('../shared/errors');
const { uploadText, txtName } = require('../core/upload');

function createExportService({ repo, outputDir, trash, rendering }) {
  const dirOf = slug => path.join(outputDir, slugify(slug));

  async function listMp4(dir) {
    if (!(await exists(dir))) return [];
    const names = (await fsp.readdir(dir, { withFileTypes: true })).filter(d => d.isFile() && d.name.endsWith('.mp4') && !d.name.startsWith('.')).map(d => d.name);
    return Promise.all(names.map(async name => { const st = await fsp.stat(path.join(dir, name)); return { name, size: st.size, modified: st.mtimeMs }; }));
  }
  // files: this video's shorts; other: loose .mp4s directly in output/ (e.g. older exports).
  async function list(slug) {
    return { files: await listMp4(dirOf(slug)), other: await listMp4(outputDir) };
  }

  async function clipUploadText(slug, clipId) {
    const p = await repo.load(slug);
    const c = p.clips.find(x => x.id === clipId);
    if (!c) throw httpError(404, 'Clip not found');
    return uploadText(p, c);
  }

  // Rewrite the .txt of every rendered short (after changing hashtags or descriptions).
  async function writeAllUploadTexts(slug) {
    const p = await repo.load(slug);
    const dir = dirOf(slug);
    let n = 0;
    for (const c of p.clips) if (c.output && await exists(path.join(dir, c.output))) { await rendering.writeUploadText(p, c, dir); n++; }
    return n;
  }

  // Move a short (and its .txt) to the trash; `other` = a loose file directly in output/.
  async function remove(slug, name, other) {
    const dir = other ? outputDir : dirOf(slug);
    const file = path.join(dir, path.basename(String(name || '')));
    if (!inside(outputDir, file) || !file.endsWith('.mp4')) throw httpError(403, 'Forbidden');
    if (!(await exists(file))) throw httpError(404, 'File not found');
    await trash.recycle(file);
    if (!other && await exists(txtName(file))) await trash.recycle(txtName(file)).catch(() => {});
    if (!other) await repo.update(slug, q => { for (const c of q.clips) if (c.output === path.basename(file)) { delete c.output; delete c.renderedAt; delete c.renderSig; } });
  }

  return { list, clipUploadText, writeAllUploadTexts, remove, dirOf };
}

module.exports = { createExportService };
