'use strict';
// Checks that a release is consistent before it is published:
//   node scripts/check-release.js [v1.2.3] [--notes notes.md]
// - the tag (argument, or GITHUB_REF_NAME in GitHub Actions) matches package.json "version"
// - CITATION.cff has the same version
// - CHANGELOG.md has a dated "## [1.2.3] - YYYY-MM-DD" section with content, and a link for it
// With --notes, that changelog section is written to a file (used as the release notes).
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const args = process.argv.slice(2);
const notesAt = args.indexOf('--notes');
const notesFile = notesAt >= 0 ? args[notesAt + 1] : null;
const tagArg = args.find((a, i) => !a.startsWith('--') && !(notesAt >= 0 && i === notesAt + 1));

const problems = [];
const version = JSON.parse(read('package.json')).version;
if (!/^\d+\.\d+\.\d+$/.test(version || '')) problems.push(`package.json version "${version}" is not like 1.2.3`);

const tag = tagArg || (process.env.GITHUB_REF_TYPE === 'tag' ? process.env.GITHUB_REF_NAME : null);
if (tag && tag !== `v${version}`) problems.push(`tag ${tag} does not match package.json version ${version} (expected v${version})`);

const cff = read('CITATION.cff');
const cffVersion = (cff.match(/^version:\s*"?([^"\s]+)"?/m) || [])[1];
if (cffVersion !== version) problems.push(`CITATION.cff version is ${cffVersion}, package.json is ${version}`);

const log = read('CHANGELOG.md');
const esc = version.replace(/\./g, '\\.');
const head = log.match(new RegExp(`^## \\[${esc}\\](?: - (\\d{4}-\\d{2}-\\d{2}))?\\s*$`, 'm'));
let notes = '';
if (!head) problems.push(`CHANGELOG.md has no "## [${version}] - YYYY-MM-DD" section (move the Unreleased notes into one)`);
else {
  if (!head[1]) problems.push(`CHANGELOG.md section [${version}] has no date`);
  const start = head.index + head[0].length;
  const next = log.slice(start).search(/^## \[/m);
  notes = log.slice(start, next < 0 ? undefined : start + next).replace(/^\[[^\]]+\]: .*$/gm, '').trim();
  if (!/^- /m.test(notes)) problems.push(`CHANGELOG.md section [${version}] lists no changes`);
  if (!new RegExp(`^\\[${esc}\\]: https://`, 'm').test(log)) problems.push(`CHANGELOG.md has no link line "[${version}]: https://…" at the bottom`);
}

if (problems.length) {
  console.error(`Release ${version} is not ready:\n` + problems.map(p => '  ✗ ' + p).join('\n'));
  process.exit(1);
}
if (notesFile) fs.writeFileSync(notesFile, notes + '\n');
console.log(`Release ${version} is consistent (package.json, CITATION.cff, CHANGELOG.md${tag ? ', tag ' + tag : ''}).`);
