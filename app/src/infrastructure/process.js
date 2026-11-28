'use strict';
// Running external programs (ffmpeg, whisper-cli, PowerShell…), and opening files with the desktop.
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const monitor = require('./monitor');

const IS_WIN = process.platform === 'win32';

// Program on the system PATH, or null.
function onPath(name) {
  try { return execFileSync(IS_WIN ? 'where' : 'which', [name], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().split(/\r?\n/)[0].trim() || null; } catch { return null; }
}

// Open a folder or web page with the desktop's default program.
function openWith(target) {
  // No shell or cmd.exe: the target is passed as a single argument and never interpreted as a command.
  const [cmd, args] = IS_WIN ? ['explorer.exe', [target]]
    : process.platform === 'darwin' ? ['open', [target]] : ['xdg-open', [target]];
  try { const c = spawn(cmd, args, { detached: true, stdio: 'ignore' }); c.on('error', () => console.log('  Open this yourself: ' + target)); c.unref(); }
  catch { console.log('  Open this yourself: ' + target); }
}

// env: environment for every tool (fontconfig on Windows, OpenMP settings on Linux).
function createProcessRunner({ env = process.env } = {}) {
  // Run a program and return its standard output.
  function runCapture(cmd, args, extraEnv) {
    return new Promise((resolve, reject) => {
      const c = spawn(cmd, args, { env: extraEnv ? { ...env, ...extraEnv } : env, windowsHide: true });
      let out = '', err = '';
      c.stdout.on('data', d => out += d);
      c.stderr.on('data', d => err += d);
      c.on('error', e => reject(new Error(`Cannot start ${path.basename(cmd)}: ${e.message}`)));
      c.on('close', code => code === 0 ? resolve(out) : reject(new Error(err.trim().slice(-800) || `exit ${code}`)));
    });
  }

  // Run a tool as part of a job: progress from ffmpeg's "-progress pipe:1" (when opts.duration is
  // given) goes to job.progress, the job can be cancelled (job.child), errors keep the last lines.
  function runProc(job, cmd, args, opts = {}) {
    return new Promise((resolve, reject) => {
      const child = spawn(cmd, args, { cwd: opts.cwd, env, windowsHide: true });
      if (job) job.child = child;
      // memory of the tool while it runs (job.stats.peakMemoryMB), never failing the task
      if (job && opts.monitor !== false) {
        job.stats = job.stats || {};
        monitor.watch(child, ({ memoryMB }) => { job.stats.memoryMB = memoryMB; job.stats.peakMemoryMB = Math.max(job.stats.peakMemoryMB || 0, memoryMB); });
      }
      let errTail = '';
      const base = opts.base || 0, span = opts.span == null ? 1 : opts.span;
      child.stdout.on('data', d => {
        if (!job || !opts.duration) return;
        const m = String(d).match(/out_time_us=(\d+)/g);
        if (m) {
          const us = Number(m[m.length - 1].split('=')[1]);
          job.progress = base + span * Math.min(1, us / 1e6 / opts.duration);
        }
        const sp = String(d).match(/speed=\s*([\d.]+)x/g);   // seconds of video per second
        if (sp) { job.stats = job.stats || {}; job.stats.speed = Number(sp[sp.length - 1].replace(/[^\d.]/g, '')); }
      });
      child.stderr.on('data', d => {
        const s = String(d);
        errTail = (errTail + s).slice(-4000);
        if (opts.onStderr) opts.onStderr(s);
      });
      child.on('error', e => reject(new Error(`Cannot start ${path.basename(cmd)}: ${e.message}`)));
      child.on('close', code => {
        if (job) job.child = null;
        if (job && job.cancelled) return reject(new Error('Cancelled'));
        if (code === 0) return resolve();
        const tail = errTail.trim().split(/\r?\n/).slice(-6).join('\n');
        reject(new Error(`${path.basename(cmd)} failed (code ${code})\n${tail}`));
      });
    });
  }

  return { runCapture, runProc };
}

module.exports = { IS_WIN, onPath, openWith, createProcessRunner };
