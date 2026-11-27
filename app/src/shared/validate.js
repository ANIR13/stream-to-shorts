'use strict';
// Validation of names and identifiers that end up in file paths. Everything that comes from the
// browser, from an uploaded file name or from a project file is untrusted until it passes here.
const { httpError } = require('./errors');

const VIDEO_EXT = new Set(['.mkv', '.mp4', '.mov', '.webm', '.flv', '.avi', '.ts', '.m4v']);
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i;

const extOf = name => { const i = name.lastIndexOf('.'); return i > 0 ? name.slice(i).toLowerCase() : ''; };

// Why a file name is not acceptable, or null when it is. A safe name is a plain name inside one
// folder: no folder separators or "..", no control or Windows-forbidden characters, not hidden,
// not a Windows device name, at most 200 characters, with one of the allowed extensions if given.
function fileNameProblem(name, exts) {
  if (typeof name !== 'string' || !name) return 'is empty';
  if (name.length > 200) return 'is too long (200 characters at most)';
  if (/[\\/]/.test(name)) return 'contains a folder separator';
  if (name === '.' || name === '..' || name.startsWith('.')) return 'starts with a dot';
  if (/[\x00-\x1f\x7f<>:"|?*]/.test(name)) return 'contains a character that is not allowed in file names';
  if (/[ .]$/.test(name)) return 'ends with a space or a dot';
  if (WINDOWS_RESERVED.test(name)) return 'is a reserved Windows name';
  if (exts && !exts.has(extOf(name))) return `must end with ${[...exts].join(', ')}`;
  return null;
}
const isSafeFileName = (name, exts) => fileNameProblem(name, exts) === null;
// The name, or a 400 error that says what is wrong with it.
function safeFileName(name, exts, what = 'File name') {
  const p = fileNameProblem(name, exts);
  if (p) throw httpError(400, `${what} ${p}.`);
  return name;
}

// Clip identifiers become folder and file names (render/<id>/, drafts/<id>.mp4).
const isSafeId = id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id);

module.exports = { VIDEO_EXT, extOf, fileNameProblem, isSafeFileName, safeFileName, isSafeId };
