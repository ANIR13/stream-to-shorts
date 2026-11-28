'use strict';
// Memory of a running tool (ffmpeg, whisper), sampled while a task runs. No npm packages:
// Linux reads /proc, Windows asks tasklist, macOS asks ps. Sampling never fails a task.
const fs = require('fs');
const { execFile } = require('child_process');

// Resident memory of a process in MB, or null when it can't be read.
function memoryOf(pid) {
  return new Promise(resolve => {
    if (process.platform === 'linux') {
      fs.readFile(`/proc/${pid}/status`, 'utf8', (err, s) => {
        const m = !err && s.match(/^VmRSS:\s+(\d+) kB/m);
        resolve(m ? Math.round(Number(m[1]) / 1024) : null);
      });
    } else if (process.platform === 'win32') {
      execFile('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 3000 }, (err, out) => {
        // "ffmpeg.exe","1234","Console","1","512,345 K": the unit (K, KB, Ko, КБ…) and the thousands
        // separator depend on the Windows language
        const m = !err && String(out).match(/"([\d.,\s  ]+)\s*\p{L}+"\s*$/mu);
        resolve(m ? Math.round(Number(m[1].replace(/[^\d]/g, '')) / 1024) : null);
      });
    } else {
      execFile('ps', ['-o', 'rss=', '-p', String(pid)], { timeout: 3000 }, (err, out) => {
        const n = !err && Number(String(out).trim());
        resolve(n ? Math.round(n / 1024) : null);
      });
    }
  });
}

// Sample a child process every `every` ms until it exits; onSample({ memoryMB }) each time.
// Returns stop().
function watch(child, onSample, every = 2000) {
  let stopped = false, busy = false;
  const tick = async () => {
    if (stopped || busy || !child.pid) return;
    busy = true;
    const memoryMB = await memoryOf(child.pid).catch(() => null);
    busy = false;
    if (!stopped && memoryMB != null) onSample({ memoryMB });
  };
  const timer = setInterval(tick, every);
  setTimeout(tick, Math.min(500, every));
  const stop = () => { stopped = true; clearInterval(timer); };
  child.once('close', stop);
  return stop;
}

module.exports = { memoryOf, watch };
