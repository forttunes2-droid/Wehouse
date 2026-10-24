import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const exports = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/propertyManagement.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports, Date });
const { parsePropertyManagement: parse } = exports;
test('arrival receipt must identify the selected occupied reservation and recorded arrival',()=>{
 const {parseHostArrivalReceipt}=exports;
 const valid={id:'reservation-a',status:'occupied',occupancy_started_at:'2026-10-23T12:00:00Z'};
 assert.equal(parseHostArrivalReceipt(valid,'reservation-a'),valid);
 for(const row of [null,{}, {...valid,id:'reservation-b'}, {...valid,status:'ready_for_move_in'}, {...valid,occupancy_started_at:null}, {...valid,occupancy_started_at:'invalid'}])assert.throws(()=>parseHostArrivalReceipt(row,'reservation-a'));
});
const valid = () => ({ listing_id: 'home-1', management_mode: 'host', wehouse_management_status: 'not_required',
  management_updated_at: '2026-10-20T00:00:00Z', management_host_user_id: 'owner',
  assignments: [{ assignment_id: 'assignment-1', user_id: 'owner', role: 'owner', status: 'active', access_level: 'full_hosting' }] });
test('property management uses the canonical resource invitation UI', () => {
  const source = fs.readFileSync('src/components/PropertyManagementPanel.tsx', 'utf8');
  assert.doesNotMatch(source, /PropertyHostInvitations|get_my_property_host_invites|respond_to_property_host_invite/);
  assert.match(source, /SentResourceInvitations resourceType="property"/);
});
test('property management preserves a confirmed operator and an explicitly unconfigured choice', () => {
  assert.equal(parse(valid(), 'home-1').management_mode, 'host');
  assert.equal(parse({ ...valid(), management_mode: null, management_updated_at: null, wehouse_management_status: null }, 'home-1').management_mode, null);
});
test('missing, malformed and different-property responses never become a management state', () => {
  for (const value of [null, {}, { ...valid(), listing_id: 'other' }, { ...valid(), assignments: null },
    { ...valid(), management_mode: 'other' }, { ...valid(), management_updated_at: 'invalid' }]) assert.throws(() => parse(value, 'home-1'));
});
test('management assignments reject duplicate or invalid access and malformed display names', () => {
  const row = valid();
  for (const assignments of [[row.assignments[0], row.assignments[0]], [{ ...row.assignments[0], role: 'admin' }],
    [{ ...row.assignments[0], name: {} }], [{ ...row.assignments[0], access_level: 'everything' }]])
    assert.throws(() => parse({ ...row, assignments }, 'home-1'));
});
