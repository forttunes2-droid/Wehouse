import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load(file) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, { exports });
  return exports;
}
const { parseWithdrawalIntent, sendWithdrawalIntent } = load('src/lib/walletWithdrawal.ts');
const { walletActivity } = load('src/lib/walletActivity.ts');

test('one profile with two workspaces reads the requested wallet without ambiguity', async () => {
  const source = ts.createSourceFile('workers.ts', fs.readFileSync('src/lib/supabase/workers.ts', 'utf8'), ts.ScriptTarget.Latest, true);
  const declaration = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'getWallet');
  assert.ok(declaration);
  const wallets = [{ id: 'worker-wallet', owner_id: 'same-person', owner_type: 'worker' },
    { id: 'partner-wallet', owner_id: 'same-person', owner_type: 'property_partner' }];
  const exports = {};
  const supabase = { from() {
    let rows = wallets;
    const query = { select: () => query, eq(column, value) { rows = rows.filter(row => row[column] === value); return query; },
      async maybeSingle() { return rows.length > 1 ? { data: null, error: { code: 'PGRST116' } } : { data: rows[0] || null, error: null }; } };
    return query;
  } };
  vm.runInNewContext(ts.transpileModule(declaration.getText(source), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports, supabase });
  assert.equal((await exports.getWallet('same-person', 'worker')).wallet.id, 'worker-wallet');
  assert.equal((await exports.getWallet('same-person', 'property_partner')).wallet.id, 'partner-wallet');
});

test('a lost response remains unknown and the same intent survives reload', async () => {
  const intent = { requestId: '10100000-0000-4000-8000-000000000001', amount: 5000,
    bankAccountId: '10100000-0000-4000-8000-000000000002' };
  assert.equal(JSON.stringify(parseWithdrawalIntent(JSON.stringify(intent))), JSON.stringify(intent));
  assert.equal((await sendWithdrawalIntent(async () => { throw new Error('Failed to fetch'); })).state, 'unknown');
  assert.equal((await sendWithdrawalIntent(async () => ({ data: null, error: { message: 'Network error' } }))).state, 'unknown');
  assert.equal((await sendWithdrawalIntent(async () => ({ data: { success: true }, error: null }))).state, 'unknown');
  assert.equal((await sendWithdrawalIntent(async () => ({ data: { success: true, request_id: 'original', status: 'paid', replayed: true }, error: null }))).requestId, 'original');
});

test('database rollback and business refusal never produce a success receipt', async () => {
  const denied = await sendWithdrawalIntent(async () => ({ data: null, error: { code: '42501', message: 'Workspace required' } }));
  assert.equal(denied.state, 'rejected');
  const invalid = await sendWithdrawalIntent(async () => ({ data: { success: false, error: 'Wallet is frozen' }, error: null }));
  assert.equal(invalid.state, 'rejected');
  assert.equal(invalid.message, 'Wallet is frozen');
  assert.throws(() => parseWithdrawalIntent('{broken'));
  assert.throws(() => parseWithdrawalIntent(JSON.stringify({ requestId: 'invalid', amount: 5000, bankAccountId: 'invalid' })));
});

test('Partner activity shows one released income and keeps protected money distinct', () => {
  const date = '2026-10-19T10:00:00Z';
  const rows = walletActivity([
    { id: 'credit', transaction_type: 'canonical_protected_release', amount: 25000, created_at: date },
    { id: 'pending', transaction_type: 'property_earning_pending', amount: 25000, created_at: date },
    { id: 'reserve', transaction_type: 'withdrawal', amount: -5000, created_at: date },
  ], [{ id: 'withdrawal', amount: 5000, status: 'awaiting_review', created_at: date }], [
    { id: 'released', earning_type: 'rent', status: 'available', net_amount: 25000, created_at: date },
    { id: 'protected', earning_type: 'hotel', status: 'held', net_amount: 7000, created_at: date },
  ]);
  assert.equal(rows.filter(row => row.kind === 'income').length, 1);
  assert.equal(rows.filter(row => row.kind === 'withdrawals').length, 1);
  assert.equal(rows.filter(row => row.protected).length, 1);
  assert.equal(rows.find(row => row.kind === 'income').amount, 25000);
  assert.equal(rows.find(row => row.protected).status, 'Payment protected');
});
