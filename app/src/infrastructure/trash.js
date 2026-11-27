'use strict';
// Never delete for good: Windows Recycle Bin; Linux desktop trash (gio), or the app's own .trash folder.
const fsp = require('fs').promises;
const path = require('path');
const { IS_WIN, onPath } = require('./process');

function createTrash({ root, runner }) {
  async function toTrash(p) {
    if (onPath('gio')) { try { await runner.runCapture('gio', ['trash', p]); return; } catch { /* no desktop trash: fall back */ } }
    const dir = path.join(root, '.trash');
    await fsp.mkdir(dir, { recursive: true });
    await fsp.rename(p, path.join(dir, `${Date.now()}_${path.basename(p)}`));
  }
  const viaRecycleBin = (method, target) => runner.runCapture('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    `Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::${method}($env:RECYCLE_PATH, 'OnlyErrorDialogs', 'SendToRecycleBin')`],
  { RECYCLE_PATH: target });
  return {
    recycle: file => (IS_WIN ? viaRecycleBin('DeleteFile', file) : toTrash(file)),
    recycleDir: dir => (IS_WIN ? viaRecycleBin('DeleteDirectory', dir) : toTrash(dir)),
  };
}

module.exports = { createTrash };
