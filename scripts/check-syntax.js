'use strict';
// Checks that every JavaScript file of the app, tests and scripts parses (node --check), on any OS.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
function find(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(d => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? find(p) : d.name.endsWith('.js') ? [p] : [];
  });
}
const files = ['app', 'tests', 'scripts'].flatMap(d => find(path.join(ROOT, d)));
let bad = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) { bad++; console.error(`✗ ${path.relative(ROOT, f)}\n${r.stderr}`); }
}
// The interface files are plain scripts loaded by index.html in order: each must be listed once,
// and app.js (start-up) last.
const PUB = path.join(ROOT, 'app', 'public');
const listed = [...fs.readFileSync(path.join(PUB, 'index.html'), 'utf8').matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);
const onDisk = find(PUB).map(f => path.relative(PUB, f).split(path.sep).join('/'));
for (const f of onDisk) {
  const n = listed.filter(x => x === f).length;
  if (n !== 1) { bad++; console.error(`✗ app/public/${f} is listed ${n} times in index.html (it must be listed once)`); }
}
for (const f of listed) if (!onDisk.includes(f)) { bad++; console.error(`✗ index.html loads ${f}, which does not exist`); }
if (listed[listed.length - 1] !== 'app.js') { bad++; console.error('✗ app.js (start-up) must be the last script in index.html'); }

// Project rule 1: no npm dependencies.
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
for (const k of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
  if (pkg[k] && Object.keys(pkg[k]).length) { bad++; console.error(`✗ package.json has ${k}: the project uses no npm packages (see CONTRIBUTING.md).`); }
}
console.log(bad ? `${bad} problem(s) in ${files.length} files.` : `${files.length} files OK, no dependencies.`);
process.exit(bad ? 1 : 0);
