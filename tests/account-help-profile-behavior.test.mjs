import chatMediaPolicy from './helpers/chat-media-policy.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
async function load(path, dependencies = {}) {
  const source = await read(path);
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, queueMicrotask, Intl, Date, console,
    require(name) { if(name === '@/lib/chatMediaPolicy') return chatMediaPolicy; if (!(name in dependencies)) throw new Error(`Unexpected dependency: ${name}`); return dependencies[name]; },
  });
  return exports;
}
const plain = value => JSON.parse(JSON.stringify(value));
function fakeWindow() {
  const entries = [{ page: 'conversation', workspace: 'personal' }];
  let position = 0;
  const listeners = new Set();
  const win = {
    history: {
      get state() { return entries[position]; },
      get length() { return entries.length; },
      pushState(state) { entries.splice(++position); entries.push(state); },
      replaceState(state) { entries[position] = state; },
      back() {
        if (!position) return;
        position--;
        let stopped = false;
        const event = { state: entries[position], stopImmediatePropagation() { stopped = true; } };
        for (const fn of [...listeners]) { fn(event); if (stopped) break; }
      },
    },
    addEventListener(name, fn) { if (name === 'popstate') listeners.add(fn); },
    removeEventListener(name, fn) { if (name === 'popstate') listeners.delete(fn); },
  };
  return win;
}
test('profile header/native Back both restore the originating info and exact workspace', async () => {
  const { bindProfileScreenHistory } = await load('src/lib/profileScreenHistory.ts');
  const win = fakeWindow();
  const closed = [];
  const info = bindProfileScreenHistory(win, 'info', () => { closed.push('info'); info.dispose(); });
  const profile = bindProfileScreenHistory(win, 'profile', () => { closed.push('profile'); profile.dispose(); });
  profile.dismiss();
  profile.dismiss();
  assert.deepEqual(closed, ['profile']);
  assert.equal(win.history.state.whProfileScreen.id, 'info');
  win.history.back();
  assert.deepEqual(closed, ['profile', 'info']);
  assert.deepEqual(plain(win.history.state), { page: 'conversation', workspace: 'personal' });
});
test('StrictMode effect replay does not create duplicate profile history entries', async () => {
  const { bindProfileScreenHistory } = await load('src/lib/profileScreenHistory.ts');
  const win = fakeWindow();
  const first = bindProfileScreenHistory(win, 'profile', () => {});
  first.dispose();
  let closed = 0;
  const replay = bindProfileScreenHistory(win, 'profile', () => { closed++; replay.dispose(); });
  await new Promise(resolve => queueMicrotask(resolve));
  assert.equal(win.history.length, 2);
  replay.dismiss();
  assert.equal(closed, 1);
  assert.equal(win.history.state.page, 'conversation');
});
test('a nested avatar closes before its profile; unrelated navigation preserves its destination', async () => {
  const { bindProfileScreenHistory } = await load('src/lib/profileScreenHistory.ts');
  const win = fakeWindow();
  const closed = [];
  const profile = bindProfileScreenHistory(win, 'profile', () => { closed.push('profile'); profile.dispose(); });
  const photo = bindProfileScreenHistory(win, 'photo', () => { closed.push('photo'); photo.dispose(); });
  win.history.back();
  assert.deepEqual(closed, ['photo']);
  assert.equal(win.history.state.whProfileScreen.id, 'profile');
  win.history.replaceState({ page: 'search', workspace: 'personal' });
  profile.dispose();
  await new Promise(resolve => queueMicrotask(resolve));
  assert.deepEqual(plain(win.history.state), { page: 'search', workspace: 'personal' });
});
test('customer WeHouse identity is independent of internal operational routing', async () => {
  const { conversationPresentation, supportDraftKey } = await load('src/lib/supabase/support.ts', {
    './client': { supabase: {} },
    '@/lib/propertyBookingLifecycle': { propertyBookingStatusLabel: () => 'Status unavailable' },
  });
  for (const [kind, snapshot, team] of [
    ['hotel_booking', { hotel_name: 'Test Lodge' }, 'WeHouse Property Operations'],
    ['apartment_reservation', { linked_label: 'Test Home' }, 'WeHouse Property Operations'],
    ['property_inspection', { linked_label: 'Test submission' }, 'WeHouse Property Operations'],
    ['worker_booking', { linked_label: 'Electrical repair' }, 'WeHouse Worker Operations'],
    ['contextual_help', { owning_domain: 'finance_operations', linked_label: 'Test payment', reason_label: 'Payment issue' }, 'WeHouse Finance Operations'],
    ['contextual_help', { owning_domain: 'security_operations', linked_label: 'My account' }, 'WeHouse Security Operations'],
    ['general', {}, 'WeHouse Support'],
  ]) {
    const value = { contextType: kind, contextId: '1', subject: 'Help', contextSnapshot: snapshot };
    const before = JSON.stringify(value);
    const keyBefore = supportDraftKey(value);
    assert.equal(conversationPresentation(value).operator, 'WeHouse');
    assert.equal(conversationPresentation(value, 'operations').operator, team);
    if (snapshot.linked_label) assert.equal(conversationPresentation(value).title, snapshot.linked_label);
    assert.equal(supportDraftKey(value), keyBefore);
    assert.equal(JSON.stringify(value), before, 'presentation cannot mutate routing metadata');
  }
});
test('help target identities distinguish hotel property and booking; payment candidates stay server-owned', async () => {
  const { helpTargetKey, helpTargetLabel, paymentHelpTargets } = await load('src/lib/helpTargets.ts');
  const hotel = { subject_type: 'hotel', subject_id: '1', context_type: 'hotel_property', label: 'Test Lodge' };
  const stay = { ...hotel, context_type: 'hotel_booking', detail: 'confirmed', record_date: '2026-09-22T00:00:00Z', record_reference: 'Record test1234' };
  assert.notEqual(helpTargetKey(hotel), helpTargetKey(stay));
  assert.match(helpTargetLabel(stay), /22 Sept? 2026/);
  assert.match(helpTargetLabel(stay), /Record test1234/);
  assert.deepEqual(plain(paymentHelpTargets({ reservations: [stay] })), []);
  assert.deepEqual(plain(paymentHelpTargets({ payment_targets: [stay] })), [stay]);
});
test('Account has one identity card, not an inert duplicate avatar in its navigation header', async () => {
  const [shell, account, profile] = await Promise.all([
    read('src/components/AccountShell.tsx'), read('src/pages/AccountCenter.tsx'), read('src/components/RoommatePublicProfile.tsx'),
  ]);
  assert.doesNotMatch(shell, /profile\.avatar_url|aria-label="Your profile"/);
  assert.match(account, /profile\.avatar_url/);
  assert.match(account, /Preview profile photo/);
  assert.doesNotMatch(profile, />WeHouse account<|: "Roommate profile"/);
  assert.match(profile, /suspended=\{fullProfile\}/);
  assert.match(profile, /score=\{score\}/);
});
