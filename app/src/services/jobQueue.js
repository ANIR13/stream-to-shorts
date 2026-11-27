'use strict';
// Job queue: long tasks (analysis, captions, renders…) run one at a time, can be cancelled and
// retried, and the queue is saved so tasks interrupted by closing the app can be resumed.
const fs = require('fs');
const { friendlyError } = require('../shared/errors');

const isActive = j => j.status === 'queued' || j.status === 'running';
const publicJob = ({ child, fn, ...rest }) => rest;

// queueFile: where waiting/running tasks are saved; specFn(spec) -> async (job) => {...} for a task spec.
function createJobQueue({ queueFile, specFn, log = console }) {
  const jobs = [];
  const queue = [];
  let running = null, jobSeq = 0;
  // Tasks that were still waiting or running when the app last closed (offered for resume in the UI).
  let interrupted = (() => { try { return JSON.parse(fs.readFileSync(queueFile, 'utf8')).filter(x => x && x.type && x.slug); } catch { return []; } })();

  // Save the waiting/running tasks. Saves happen one at a time and always write the latest list,
  // through a temporary file, so overlapping saves can never leave a corrupted file behind.
  let writing = Promise.resolve(), pending = null;
  function persist() {
    const list = interrupted.concat(jobs.filter(j => isActive(j) && !j.cancelled && j.spec && j.type !== 'draft').map(j => ({ ...j.spec, label: j.label })));
    pending = JSON.stringify(list);
    writing = writing.then(async () => {
      if (pending == null) return;
      const data = pending; pending = null;
      await fs.promises.writeFile(queueFile + '.tmp', data);
      await fs.promises.rename(queueFile + '.tmp', queueFile);
    }).catch(e => log.error('saving the task queue: ' + e.message));
    return writing;
  }

  function add(type, label, slug, fn, extra = {}) {
    const job = { id: ++jobSeq, type, label, slug, status: 'queued', progress: 0, message: 'Waiting…', error: null, created: Date.now(), ...extra, fn };
    jobs.push(job);
    queue.push({ job, fn });
    while (jobs.length > 60) {
      const i = jobs.findIndex(j => ['done', 'error', 'cancelled'].includes(j.status));
      if (i < 0) break;
      jobs.splice(i, 1);
    }
    pump();
    persist();
    return job;
  }
  // Queue a task described by a spec ({ type, slug, clipId?, from? }); specs can be saved and resumed.
  const addSpec = (spec, label) => add(spec.type, label, spec.slug, specFn(spec), { clipId: spec.clipId, spec });

  async function pump() {
    if (running || !queue.length) return;
    const { job, fn } = queue.shift();
    if (job.cancelled) { job.status = 'cancelled'; return pump(); }
    running = job;
    job.status = 'running';
    job.started = Date.now();
    try {
      await fn(job);
      job.status = 'done'; job.progress = 1; job.message = 'Finished';
    } catch (e) {
      job.status = job.cancelled ? 'cancelled' : 'error';
      job.error = e.message;
      job.hint = friendlyError(e.message);
      log.error(`[job ${job.id}] ${e.message}`);
    }
    job.finished = Date.now();
    running = null;
    persist();
    pump();
  }

  function cancel(job) {
    if (!job || !isActive(job)) return;
    job.cancelled = true;
    if (job.status === 'queued') { job.status = 'cancelled'; job.finished = Date.now(); }
    if (job.child) job.child.kill();
    persist();
  }

  // Re-queue a finished/failed/cancelled job as a fresh job; the old entry is removed from the list.
  function retry(job) {
    if (!job || isActive(job) || !job.fn) return null;
    if (job.clipId && jobs.some(j => j !== job && j.type === job.type && j.clipId === job.clipId && j.slug === job.slug && isActive(j))) return null;
    const i = jobs.indexOf(job);
    if (i >= 0) jobs.splice(i, 1);
    return add(job.type, job.label, job.slug, job.fn, { ...(job.clipId ? { clipId: job.clipId } : {}), spec: job.spec });
  }

  function clearFinished() {
    for (let i = jobs.length - 1; i >= 0; i--) if (['done', 'error', 'cancelled'].includes(jobs[i].status)) jobs.splice(i, 1);
  }

  // Resume (or dismiss) the tasks interrupted when the app last closed.
  function takeInterrupted(resume) {
    const list = interrupted; interrupted = [];
    const out = [];
    if (resume) {
      for (const spec of list) {
        if (spec.clipId && jobs.some(j => j.type === spec.type && j.clipId === spec.clipId && isActive(j))) continue;
        try { out.push(addSpec(spec, spec.label || spec.type)); } catch (e) { log.error(e.message); }
      }
    }
    persist();
    return out;
  }
  // Forget interrupted tasks of one video (when it is started over).
  function forgetInterrupted(slug) { interrupted = interrupted.filter(x => x.slug !== slug); persist(); }

  return {
    jobs, add, addSpec, cancel, retry, clearFinished, takeInterrupted, forgetInterrupted,
    get interrupted() { return interrupted; },
    saved: () => writing, // resolves once the latest queue save is on disk
    find: id => jobs.find(j => j.id === id),
    active: () => jobs.filter(isActive),
  };
}

module.exports = { createJobQueue, isActive, publicJob };
