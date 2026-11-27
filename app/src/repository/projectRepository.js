'use strict';
// Project repository: where projects live on disk (projects/<slug>/project.json and its side files).
// All project writes go through update(), which serializes them per project.
const path = require('path');
const { exists, readJSON, writeJSON, deepDefaults, slugify } = require('../shared/fsutil');
const { httpError } = require('../shared/errors');
const { loadDefaults, defaultProject, ensureNums, mergeClientSave } = require('../core/project');

// projectsDir: projects folder; sourceDir: recordings folder; probe(file) -> video facts (for new projects).
function createProjectRepository({ projectsDir, sourceDir, probe }) {
  const projDir = slug => path.join(projectsDir, slugify(slug));
  const projFile = slug => path.join(projDir(slug), 'project.json');
  const fileIn = (slug, ...parts) => path.join(projDir(slug), ...parts);

  const locks = new Map();
  function withLock(slug, fn) {
    const prev = locks.get(slug) || Promise.resolve();
    const p = prev.then(fn, fn);
    locks.set(slug, p.catch(() => {}));
    return p;
  }

  async function load(slug) {
    const p = await readJSON(projFile(slug), null);
    if (!p) throw httpError(404, 'Project not found');
    deepDefaults(p, loadDefaults());
    p.hasProxy = await exists(fileIn(slug, 'proxy.mp4'));
    return p;
  }

  // Every video file gets its own project folder. Different files whose names clean up to the same
  // folder name (e.g. "stream.mkv" and "stream.mp4") get a numbered folder, so they never share
  // clips, captions, word fixes or output.
  async function slugFor(file) {
    const base = slugify(file);
    for (let i = 1; ; i++) {
      const slug = i === 1 ? base : `${base}_${i}`;
      const p = await readJSON(projFile(slug), null);
      if (!p || p.video === file) return slug;
    }
  }

  // Read-modify-write under the project's lock. mutate(p) may change p in place (or throw to abort).
  function update(slug, mutate) {
    return withLock(slug, async () => {
      const p = await load(slug);
      await mutate(p);
      ensureNums(p);
      p.updated = Date.now();
      delete p.hasProxy;
      await writeJSON(projFile(slug), p);
      return load(slug);
    });
  }

  // Open the project of a video file, creating it (after probing the video) the first time.
  async function open(file) {
    const slug = await slugFor(file);
    if (await exists(projFile(slug))) {
      const p = await load(slug);
      return p.clips.some(c => !c.num) ? update(slug, () => {}) : p;
    }
    const src = path.join(sourceDir, file);
    if (!(await exists(src))) throw httpError(404, 'Video not found in source folder');
    const meta = await probe(src);
    await writeJSON(projFile(slug), defaultProject(file, meta, slug));
    return load(slug);
  }

  const saveFromClient = (slug, incoming, force) => update(slug, p => { mergeClientSave(p, incoming, force); });

  return {
    projDir, projFile, fileIn, withLock, load, slugFor, update, open, saveFromClient,
    exists: slug => exists(projFile(slug)),
    readRaw: slug => readJSON(projFile(slug), null),
    readAnalysis: slug => readJSON(fileIn(slug, 'analysis.json'), null),
    writeAnalysis: (slug, a) => writeJSON(fileIn(slug, 'analysis.json'), a),
    readTranscript: slug => readJSON(fileIn(slug, 'transcripts', 'full.json'), null),
  };
}

module.exports = { createProjectRepository };
