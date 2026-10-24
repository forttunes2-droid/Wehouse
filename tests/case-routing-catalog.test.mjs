import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
const read=file=>fs.readFileSync(file,'utf8');

test('required case routing data survives a schema-only baseline',()=>{
 const sql=read('supabase/migrations/20261021185537_restore_operational_reason_catalog.sql');
 for(const [reason,domain] of Object.entries({app_help:'support',account_access:'support',worker_verification:'worker_operations',worker_job_issue:'worker_operations',payment_issue:'finance_operations',payout_issue:'finance_operations',account_compromise:'security_operations',safety_threat:'security_operations',arrival_issue:'property_operations',field_visit:'property_operations',property_submission_help:'property_operations'})){
  assert.match(sql,new RegExp("\\('"+reason+"','[^']+','"+domain+"'"));
 }
 assert.match(sql,/on conflict\(reason_code\) do update/);
});

test('operational case ownership routes inbox records independently of transport channel',()=>{
 const sql=read('supabase/migrations/20261021190009_route_case_inbox_by_owning_domain.sql');
 assert.match(sql,/coalesce\(nullif\(oc\.owning_domain,''\),public\.canonical_operational_domain\(c\.channel_kind\)\)=v_queue/);
 assert.match(sql,/user_has_active_workspace\(actor\.user_id,v_queue\)/);
 assert.match(sql,/current_actor_in_scope/);
 const uniqueness=read('supabase/migrations/20261021185849_operational_case_conversation_uniqueness.sql');
 assert.match(uniqueness,/where partner_id is not null and operational_case_id is null/);
 assert.doesNotMatch(uniqueness,/drop index public\.partner_support_operational_case_unique/);
});

test('database CI includes real routing, role, scope and private reply contracts',()=>{
 const ci=read('.github/workflows/consolidation-validation.yml');
 assert.match(ci,/supabase\/tests\/case_routing_catalog_contract\.sql/);
 assert.match(ci,/supabase\/tests\/support_reply_receipt_contract\.sql/);
 const contract=read('supabase/tests/case_routing_catalog_contract.sql');
 assert.match(contract,/send_my_first_contextual_help_message/);
 assert.match(contract,/other-branch finance staff cannot receive/);
 assert.match(contract,/claim_my_communication_case/);
 assert.match(contract,/rollback;/);
});
