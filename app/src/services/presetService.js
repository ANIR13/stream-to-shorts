'use strict';
// Style presets, shared by all videos: three built-in looks plus the user's own (projects/presets.json).
const { readJSON, writeJSON } = require('../shared/fsutil');
const { httpError } = require('../shared/errors');
const { STYLE_DEFAULTS } = require('../core/project');

const LOOK_KEYS = Object.keys(STYLE_DEFAULTS).filter(k => !['fps', 'crf', 'loudnorm'].includes(k)).concat(['titleSafe']);
const pickLook = st => Object.fromEntries(LOOK_KEYS.filter(k => st && st[k] !== undefined).map(k => [k, st[k]]));
const BUILTIN_PRESETS = [
  { name: 'Bold yellow', builtin: true, style: pickLook(STYLE_DEFAULTS) },
  { name: 'Clean white', builtin: true, style: pickLook({ ...STYLE_DEFAULTS, titleFont: 'Arial Black', titleSize: 80, titleColor1: '#FFFFFF', titleColor2: '#FFFFFF', captionFont: 'Arial Black', captionSize: 76, captionHighlight: '#00E5FF', accent: '#00E5FF' }) },
  { name: 'Minimal', builtin: true, style: pickLook({ ...STYLE_DEFAULTS, titleFont: 'Bahnschrift', titleSize: 76, titleColor2: '#FFFFFF', captionFont: 'Bahnschrift', captionSize: 70, highlightMode: 'none', uppercase: false, wordsPerChunk: 4, background: 'dark', camBorder: false, progressBar: false }) },
];

function createPresetService({ file }) {
  const list = async () => BUILTIN_PRESETS.concat((await readJSON(file, [])).map(x => ({ ...x, builtin: false })));
  async function save(rawName, style) {
    const name = String(rawName || '').trim().slice(0, 40);
    if (!name) throw httpError(400, 'Give the preset a name');
    if (BUILTIN_PRESETS.some(x => x.name.toLowerCase() === name.toLowerCase())) throw httpError(400, 'That name is used by a built-in preset');
    const own = (await readJSON(file, [])).filter(x => x.name.toLowerCase() !== name.toLowerCase());
    own.push({ name, style: pickLook(style) });
    await writeJSON(file, own);
    return list();
  }
  async function remove(name) {
    await writeJSON(file, (await readJSON(file, [])).filter(x => x.name !== name));
    return list();
  }
  return { list, save, remove };
}

module.exports = { createPresetService, BUILTIN_PRESETS, pickLook };
