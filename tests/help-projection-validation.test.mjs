import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
const source = fs.readFileSync('src/lib/helpTargets.ts', 'utf8');
const exports = {};
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports });
const { isHelpTargetsResponse } = exports;
const account = { subject_type: 'account', subject_id: 'qa-self', label: 'My account' };
const target = { subject_type: 'hotel', subject_id: '1', label: 'Test hotel', context_type: 'hotel_booking' };
test('verified empty Help differs from unavailable or malformed account/record lists', () => {
  assert.equal(isHelpTargetsResponse({ account, payment_targets: [] }), true);
  assert.equal(isHelpTargetsResponse({ account, payment_targets: [target], hotel_bookings: [target], worker_profile: null }), true);
  for (const value of [null, [], {}, { account }, { account, payment_targets: null },
    { account: null, payment_targets: [] }, { account: { ...account, subject_type: 'worker' }, payment_targets: [] },
    { account, payment_targets: [], reservations: {} }, { account, payment_targets: [], hotel_bookings: [null] },
    { account, payment_targets: [ { ...target, subject_id: 1 } ] },
    { account, payment_targets: [ { ...target, record_date: {} } ] },
    { account, payment_targets: [], worker_profile: [] }]) {
    assert.equal(isHelpTargetsResponse(value), false, JSON.stringify(value));
  }
});
test('Help validates before storing targets and gates record actions while loading', () => {
  const component = fs.readFileSync('src/components/AccountHelpCenter.tsx', 'utf8');
  assert.match(component, /const usable = !error && isHelpTargetsResponse\(data\)/);
  assert.match(component, /setTargets\(usable \? data as HelpTargets : \{\}\)/);
  assert.match(component, /\{loading \|\| !ready \? <div role="status"[^]*?Loading your help options…<\/div> : <>/);
});

test('Help direct actions keep account scope and validated server targets, without a submit-selection step', () => {
 const component = fs.readFileSync('src/components/AccountHelpCenter.tsx','utf8');
 const picker = fs.readFileSync('src/components/HelpRecordPicker.tsx','utf8');
 assert.match(component,/loadedFor === scope/);
 assert.match(component,/if \(!ready\) return/);
 assert.match(component,/requester_workspace: workspace/);
 assert.match(component,/startProperty\(helpTargetKey\(target\)\)/);
 assert.match(component,/startMoney\(helpTargetKey\(target\)\)/);
 assert.doesNotMatch(component,/WeHouseSelect|PrimaryButton|setTargetId/);
 assert.doesNotMatch(picker,/type="radio"|>Message WeHouse<\/button>/);
 assert.match(picker,/data-help-target=\{helpTargetKey\(item\)\}/);
});
