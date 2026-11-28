'use strict';
// A quick fingerprint of a video file: its size, modification time and a hash of 64 KB at the start,
// middle and end. Reading 192 KB is instant even for a 4-hour recording, and any replaced or re-encoded
// file gets a different fingerprint. Caches (analysis, preview copy, transcripts) store it, so they are
// recognised as stale when the file under the same name changes.
const fs = require('fs');
const crypto = require('crypto');

const PIECE = 64 * 1024;

async function fingerprint(file) {
  const st = await fs.promises.stat(file);
  const fh = await fs.promises.open(file, 'r');
  try {
    const h = crypto.createHash('sha1');
    h.update(`${st.size}:`);
    for (const at of [0, Math.max(0, Math.floor(st.size / 2) - PIECE / 2), Math.max(0, st.size - PIECE)]) {
      const buf = Buffer.alloc(Math.min(PIECE, st.size));
      const { bytesRead } = await fh.read(buf, 0, buf.length, at);
      h.update(buf.subarray(0, bytesRead));
    }
    return `${st.size.toString(36)}-${Math.round(st.mtimeMs).toString(36)}-${h.digest('hex').slice(0, 16)}`;
  } finally { await fh.close(); }
}

// Same content, different modification time (copied back, touched): still the same video.
const sameContent = (a, b) => !!a && !!b && a.split('-')[0] === b.split('-')[0] && a.split('-')[2] === b.split('-')[2];

module.exports = { fingerprint, sameContent };
