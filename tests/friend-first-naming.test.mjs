import assert from 'node:assert/strict';
import { access, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import vm from 'node:vm';

const root = process.cwd();

test('Friend conversations live in Inbox Messages rather than the Activity branch', async () => {
  const source = await readFile(join(root, 'src/pages/Chat.tsx'), 'utf8');
  const file = ts.createSourceFile('Chat.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const panels = [];
  let activityBranch;
  function visit(node) {
    if (ts.isIfStatement(node) && node.expression.getText(file) === 'view === "activity"') activityBranch = node;
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(file) === 'FriendsPanel') panels.push(node);
    ts.forEachChild(node, visit);
  }
  visit(file);
  assert.ok(activityBranch, 'Activity still has a separate screen');
  assert.equal(panels.length, 1, 'There is one Friend entry point');
  assert.ok(panels[0].pos > activityBranch.end, 'Friends must be in the Messages return');
  assert.match(source, /if \(initialFriendChatId\) setView\("messages"\)/);
});

test('Friend plan payload round-trips and malformed plans fall back to ordinary messages', async () => {
  const source = await readFile(join(root, 'src/lib/friendPlans.ts'), 'utf8');
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports, Intl, Date });
  const plan = { activity: 'A picnic at the park', when: '2026-11-01T12:00:00.000Z', timeZone: 'Africa/Lagos', place: 'Meet at the main entrance' };
  const message = exports.createFriendPlanMessage(plan);
  assert.deepEqual(JSON.parse(JSON.stringify(exports.parseFriendPlanMessage(message))), plan);
  assert.equal(exports.parseFriendPlanMessage('ordinary private message'), null);
  assert.equal(exports.parseFriendPlanMessage(message.replace('Africa/Lagos', 'Invalid/Zone')), null);
  assert.throws(() => exports.createFriendPlanMessage({ ...plan, activity: '' }), /incomplete/);
  assert.throws(() => exports.createFriendPlanMessage({ ...plan, when: 'invalid' }), /incomplete/);
});

async function filesUnder(directory) {
  const entries = await readdir(join(root, directory), { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  }));
  return nested.flat();
}

test('active application source uses Friend names for every relationship and chat contract', async () => {
  const files = (await filesUnder('src')).filter((path) => /\.(ts|tsx)$/.test(path));
  const namedFiles = [];
  for (const path of files) {
    const content = await readFile(join(root, path), 'utf8');
    if (/companion/i.test(content)) namedFiles.push(path);
  }
  assert.deepEqual(namedFiles, []);
});

test('forward migration renames the schema, key kind, reports and attachment namespace', async () => {
  const sql = await readFile(join(root, 'supabase/migrations/20261019144719_friend_first_schema.sql'), 'utf8');
  assert.match(sql, /ALTER TABLE public\.companions RENAME TO friends/i);
  assert.match(sql, /ALTER TABLE public\.companion_messages RENAME TO friend_messages/i);
  assert.match(sql, /RENAME COLUMN companion_id TO friend_id/i);
  assert.match(sql, /conversation_kind='friend' WHERE conversation_kind='companion'/i);
  assert.match(sql, /e2ee\/companion\/.*e2ee\/friend\//i);
  assert.match(sql, /friend_chat/);
  assert.match(sql, /DROP FUNCTION IF EXISTS public\.send_companion_request/);
  assert.match(sql, /create or replace function public\.send_friend_request/);
});

test('database validation workflows reference existing Friend contract files', async () => {
  const workflow = await readFile(join(root, '.github/workflows/consolidation-validation.yml'), 'utf8');
  assert.doesNotMatch(workflow, /companion/i);
  const paths = [...workflow.matchAll(/<\s+(supabase\/tests\/[\w-]+\.sql)/g)].map(match => match[1]);
  assert.ok(paths.length > 0);
  await Promise.all(paths.map(path => access(join(root, path))));
});
