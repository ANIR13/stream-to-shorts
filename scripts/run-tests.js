'use strict';
// Runs the tests with Node's built-in runner:  node scripts/run-tests.js [unit|integration|e2e|regression ...]
// The files are listed here because "node --test <folder>" behaves differently across Node.js
// versions (18 and 20 search the folder, 22+ expect file patterns), and shells don't expand ** alike.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const TESTS = path.join(__dirname, '..', 'tests');
const LEVELS = ['unit', 'integration', 'e2e', 'regression'];
const asked = process.argv.slice(2);
for (const l of asked) if (!LEVELS.includes(l)) { console.error(`Unknown test level "${l}". Use: ${LEVELS.join(', ')}`); process.exit(2); }

function find(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(d => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? find(p) : d.name.endsWith('.test.js') ? [p] : [];
  });
}
const files = (asked.length ? asked : LEVELS).flatMap(l => find(path.join(TESTS, l))).sort();
if (!files.length) { console.error('No test files found.'); process.exit(1); }
const r = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(r.status == null ? 1 : r.status);
