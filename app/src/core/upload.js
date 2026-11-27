'use strict';
// Upload text for a short (title, description, hashtags). Pure functions.

// Titles typed in capitals for the video are turned into normal sentences for the platform title.
function sentence(t) {
  t = String(t || '').replace(/\s+/g, ' ').trim();
  if (!t || t !== t.toUpperCase() || !/[A-Z]/.test(t)) return t;
  const low = t.toLowerCase();
  return low.charAt(0).toUpperCase() + low.slice(1);
}

function uploadText(p, clip) {
  const tags = String((p.publish && p.publish.hashtags) || '').trim();
  const title = sentence([clip.title1, clip.title2].filter(Boolean).join(' ')) || `Clip ${clip.num || ''}`.trim();
  let desc = String(clip.description || '').trim();
  if (!desc && Array.isArray(clip.captions) && clip.captions.length) {
    // a short quote of what was said
    let q = clip.captions.flatMap(ch => (ch.words || []).map(w => w.w)).join(' ').replace(/\s+/g, ' ').trim();
    if (q.length > 160) q = q.slice(0, q.lastIndexOf(' ', 160)) + '…';
    desc = q ? `"${q}"` : '';
  }
  return { title: title.slice(0, 100), description: [title, desc, tags].filter(Boolean).join('\n\n'), hashtags: tags };
}

// The .txt saved next to each short.
const txtName = mp4 => mp4.replace(/\.mp4$/i, '.txt');
const uploadTextFile = u => `TITLE\r\n${u.title}\r\n\r\nDESCRIPTION\r\n${u.description.replace(/\n/g, '\r\n')}\r\n`;

module.exports = { sentence, uploadText, txtName, uploadTextFile };
