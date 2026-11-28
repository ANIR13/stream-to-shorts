'use strict';
// Project repository: where projects live on disk (projects/<slug>/project.json and its side files).
// All project writes go through update(), which serializes them per project.
const fsp = require('fs').promises;
const path = require('path');
const { exists, readJSON, writeJSON, slugify } = require('../shared/fsutil');
const { httpError } = require('../shared/errors');
const { defaultProject, ensureNums, mergeClientSave, sanitizeProject } = require('../core/project');
const { safeFileName, VIDEO_EXT } = require('../shared/validate');
const { SCHEMA_VERSION, schemaVersionOf, migrate, needsMigration } = require('../core/schema');

// projectsDir: projects folder; sourceDir: recordings folder; probe(file) -> video facts (for new projects);
// outputDir (optional): finished shorts, to flag clips whose short was deleted outside the app.
function createProjectRepository({ projectsDir, sourceDir, probe, outputDir = null }) {
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

  // Projects are always handed out in the current format (older files are upgraded in memory;
  // open() writes the upgrade). Files from a newer app are refused, never overwritten.
  async function load(slug) {
    const p = await readJSON(projFile(slug), null);
    if (!p) throw httpError(404, 'Project not found');
    migrate(p);
    sanitizeProject(p); // project files are untrusted: see core/project.js
    p.hasProxy = await exists(fileIn(slug, 'proxy.mp4'));
    // A short deleted outside the app (Explorer, file manager) is flagged, not forgotten: the clip
    // keeps its render record and shows as rendered again if the file comes back.
    if (outputDir) {
      const dir = path.join(outputDir, slugify(slug));
      await Promise.all(p.clips.map(async c => {
        if (c.output && !(await exists(path.join(dir, c.output)))) c.outputMissing = true;
        else delete c.outputMissing;
      }));
    }
    return p;
  }

  // Upgrade an older project file on disk, keeping the original as project.v<N>.backup.json.
  async function upgrade(slug, raw) {
    const backup = fileIn(slug, `project.v${schemaVersionOf(raw)}.backup.json`);
    if (!(await exists(backup))) await fsp.copyFile(projFile(slug), backup);
    return update(slug, () => {});
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
      sanitizeProject(p);
      p.updated = Date.now();
      delete p.hasProxy; // computed on every load, never stored
      for (const c of p.clips) delete c.outputMissing;
      delete p.sourceChanged; // computed when a video is opened, never stored
      await writeJSON(projFile(slug), p);
      return load(slug);
    });
  }

  // Open the project of a video file, creating it (after probing the video) the first time.
  async function open(file) {
    safeFileName(file, VIDEO_EXT, 'Video name');
    const slug = await slugFor(file);
    if (await exists(projFile(slug))) {
      const raw = await readJSON(projFile(slug), null);
      if (raw && needsMigration(raw)) return upgrade(slug, raw);
      let p = await load(slug);
      // projects made before audio tracks were counted: count them once (game + microphone tracks are mixed)
      if (!p.meta.audioChecked && p.meta.hasAudio) {
        const m = await probe(path.join(sourceDir, file)).catch(() => null);
        if (m) p = await update(slug, q => { q.meta.audioChecked = true; if (m.audioStreams > 1) q.meta.audioStreams = m.audioStreams; });
      }
      return p.clips.some(c => !c.num) ? update(slug, () => {}) : p;
    }
    const src = path.join(sourceDir, file);
    if (!(await exists(src))) throw httpError(404, 'Video not found in source folder');
    const meta = await probe(src);
    await writeJSON(projFile(slug), { ...defaultProject(file, { ...meta, audioChecked: true }, slug), version: SCHEMA_VERSION });
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
