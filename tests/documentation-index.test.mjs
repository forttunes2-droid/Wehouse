import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const tracked = execFileSync('git', ['ls-files', '*.md'], { cwd: root, encoding: 'utf8' })
  .split('\n')
  .filter((file) => file && !file.startsWith('supabase/migrations_legacy/') && fs.existsSync(path.join(root, file)));

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
