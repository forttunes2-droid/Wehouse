import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('inspection authority and review contracts run in migration CI',()=>{
 const ci=read('.github/workflows/consolidation-validation.yml');
 assert.ok(ci.includes('supabase/tests/inspection_command_authority_contract.sql'));
 const contract=read('supabase/tests/inspection_command_authority_contract.sql');
 for(const check of ['set local role authenticated','revoked device','coverage change','correction request','retry after review','completed visit dashboard'])assert.ok(contract.includes(check),check);
 assert.ok(!contract.includes('session_replication_role'));
 assert.match(contract,/rollback;\s*select/);
});
test('inspection saves preserve evidence and need confirmed write receipts',()=>{
 const source=read('src/components/StaffInspectionWorkspaceV2.tsx');
 assert.ok(!source.includes('.remove(uploadedRefs)'));
 assert.ok(source.includes('saved.data!==true'));
 assert.ok(source.includes('data!==true'));
 assert.ok(source.includes('review_note'));
 assert.ok(source.includes('Add up to 12 new evidence files'));
});
