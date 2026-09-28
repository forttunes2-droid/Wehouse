import assert from 'node:assert/strict';
import { test } from 'node:test';
import { workspaceForActivity } from '../src/lib/workspaceActivityAwareness.ts';

test('other-workspace activity stays a signal only for a current grant on the same identity', () => {
  const access = { identity: { user_id: 'person-a' }, privileged_workspaces: [{ role: 'worker' }, { role: 'hotel' }] };
  assert.equal(workspaceForActivity('worker', 'person-a', access), 'worker');
  assert.equal(workspaceForActivity('hotel_staff', 'person-a', access), 'hotel');
  assert.equal(workspaceForActivity('property_operations', 'person-a', access), null);
  assert.equal(workspaceForActivity('creator', 'person-a', access), null);
  assert.equal(workspaceForActivity('worker', 'person-b', access), null);
  assert.equal(workspaceForActivity('personal', 'person-a', access), null);
  assert.equal(workspaceForActivity('worker', 'person-a', { ...access, privileged_workspaces: [] }), null);
});
