import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const tracked = execFileSync('git', ['ls-files', '*.md'], { cwd: root, encoding: 'utf8' })
  .split('\n')
  .filter((file) => file && !file.startsWith('supabase/migrations_legacy/') && fs.existsSync(path.join(root, file)));

test('confirmed product decisions have unique identifiers', () => {
  const source = fs.readFileSync('docs/DECISION_LOG.md', 'utf8');
  const identifiers = [...source.matchAll(/^\| (C-\d+) \|/gm)].map(match => match[1]);
  assert.ok(identifiers.length > 0);
  assert.equal(new Set(identifiers).size, identifiers.length, 'A decision identifier cannot describe two different rules');
  assert.match(source, /\| C-064 \| \*\*Buildings and bookable spaces, for both Short Let and Long Let/);
  assert.ok(source.indexOf('| C-064 |') < source.indexOf('## Repository-established decisions'));
});

test('relative markdown links resolve', () => {
  const broken = [];
  for (const file of tracked) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    for (const match of source.matchAll(/\]\((?!https?:|#|mailto:)([^)\s#]+)/g)) {
      const target = path.normalize(path.join(path.dirname(file), match[1]));
      if (!fs.existsSync(path.join(root, target))) broken.push(`${file} -> ${match[1]}`);
    }
  }
  assert.deepEqual(broken, []);
});

test('every document in docs/ is listed in the documentation index', () => {
  const index = fs.readFileSync(path.join(root, 'docs/README.md'), 'utf8');
  const unlisted = tracked
    .filter((file) => file.startsWith('docs/') && file !== 'docs/README.md')
    .filter((file) => !index.includes(path.basename(file)));
  assert.deepEqual(unlisted, []);
});

test('the repository root holds no stray reports or plans', () => {
  const allowed = new Set(['README.md', 'SECURITY.md', 'WEHOUSE_MASTER_PLAN.md', 'WEHOUSE_ARCHITECTURE_CONTRACT.md']);
  const stray = tracked.filter((file) => !file.includes('/') && !allowed.has(file));
  assert.deepEqual(stray, []);
});

test('the release register has unique work owners and accounts for every prior row', () => {
  const source = fs.readFileSync('docs/WEHOUSE_RELEASE_ROADMAP.md', 'utf8');
  const history = fs.readFileSync('docs/WEHOUSE_RELEASE_HISTORY_2026-10-30.md', 'utf8');
  const ids = [...source.matchAll(/^\| (WR-\d+) \|/gm)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length, 'Each work item must have one current owner row');
  assert.ok(ids.length > 0, 'Keep stable work IDs rather than anonymous duplicate rows');
  const oldRegister = history.split('| Area | Item | Status |')[1]?.split('## How Codex and Copilot fit together')[0];
  assert.ok(oldRegister, 'Keep the historical source register for traceability');
  const oldTitles = [...oldRegister.matchAll(/^\| [^|]+ \| ([^|]+) \|/gm)].map(match => match[1].trim()).filter(title => title !== '---');
  const dispositions = [...source.matchAll(/^\| (OLD-\d+) \| ([^|]+) \| ([^|]+) \|/gm)];
  assert.equal(new Set(dispositions.map(match => match[1])).size, oldTitles.length);
  assert.deepEqual(dispositions.map(match => match[2].trim()), oldTitles, 'No earlier requirement may silently disappear');
  for (const match of dispositions) {
    for (const id of match[3].match(/\bWR-\d+\b/g) ?? []) assert.ok(ids.includes(id), `Unknown owner ${id}`);
  }
  assert.match(source, /PM-01[\s\S]*Explicitly post-merge, not a PR prerequisite/);
  assert.match(source, /NT-01[\s\S]*Separate native release/);
  assert.match(source, /DF-01[\s\S]*Excluded from current release requirements/);
});

test('settled property scope is not still listed as an open owner question', () => {
  const source = fs.readFileSync('docs/DECISION_LOG.md', 'utf8');
  const openQuestions = source.split('## Decisions requiring owner approval')[1];
  assert.ok(openQuestions);
  assert.doesNotMatch(openQuestions, /^\| D-016 \|/m);
  assert.match(source, /\| D-016 \| Whole-home versus independently bookable private bedroom is settled/);
  assert.doesNotMatch(source, /catalog\/session\/booking implementation remains open|The complete hierarchy and private-room workflow are not implemented yet/);
});

