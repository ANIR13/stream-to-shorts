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
// Project rule 1: no npm dependencies.
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
for (const k of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
  if (pkg[k] && Object.keys(pkg[k]).length) { bad++; console.error(`✗ package.json has ${k}: the project uses no npm packages (see CONTRIBUTING.md).`); }
}
console.log(bad ? `${bad} problem(s) in ${files.length} files.` : `${files.length} files OK, no dependencies.`);
process.exit(bad ? 1 : 0);
