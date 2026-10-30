import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

test('Hotel report adapter returns the server receipt and passes only Hotel identity and report content', async () => {
  const calls = [];
  const exports = {};
  const code = ts.transpileModule(await source('../src/lib/supabase/reports.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(code, { exports, require: () => ({ supabase: { rpc: async (name, args) => { calls.push({ name, args }); return { data: 'test-receipt', error: null }; } } }) });
  const result = await exports.reportHotel(42, 'scam', 'Incorrect information');
  assert.equal(result.reportId, 'test-receipt');
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{ name:'report_hotel', args:{p_hotel_id:42,p_reason:'scam',p_details:'Incorrect information'} }]);
});

test('Hotel report uses the shared form, scoped queue and private receipt contract', async () => {
  const [hotel, sql, operator, reporter] = await Promise.all([
    source('../src/pages/HotelDetailExperience.tsx'),
    source('../supabase/migrations/20261019171328_hotel_listing_reports.sql'),
    source('../src/components/AdminReports.tsx'),source('../src/components/MyReports.tsx'),
  ]);
  assert.match(hotel, /ReportListingDialog targetType="hotel"/);
  assert.match(hotel, /onRequireAuth\?\.\(\)/);
  assert.match(sql, /v_actor\.user_id,v_hotel\.owner_id,'hotel'/);
  assert.match(sql, /p_subject_type='hotel'[\s\S]*?h\.city/);
  assert.match(sql, /on conflict\(reporter_user_id,subject_ref,reason\)/);
  assert.match(sql, /revoke all on function public\.report_hotel\(integer,text,text\) from public,anon/);
  assert.match(operator, /Hotel listing/);assert.match(reporter, /Hotel listing/);
  assert.match(operator, /Report reference:/);assert.match(reporter, /Report reference:/);
});

test("property listing reports call the server-owned report function and return a receipt", async () => {
  const [dialog, listing, reports, sql] = await Promise.all([
    source("../src/components/ReportListingDialog.tsx"),
    source("../src/pages/ListingDetailCore.tsx"),
    source("../src/lib/supabase/reports.ts"),
    source("../supabase/migrations/20261019144712_listing_reports_to_content_reports.sql"),
  ]);
  assert.match(dialog, /reportListing\(listingId, reasonCode, fullDetails\)/);
  assert.match(dialog, /Ref \$\{result\.reportId\.slice\(0, 8\)\}/);
  assert.match(dialog, /if \(!result\.reportId\) throw/);
  assert.match(dialog, /Contact WeHouse about urgent safety/);
  assert.match(listing, /category: "safety"[\s\S]*?priority: "urgent"[\s\S]*?reason_code: "safety_threat"/);
  assert.match(reports, /supabase\.rpc\('report_listing'/);
  assert.match(sql, /insert into public\.content_reports/i);
  assert.match(sql, /v_actor\.user_id,v_owner_id,'listing'/i);
  assert.match(sql, /public\.wehouse_state_key\(v_listing\.state\)/i);
  assert.match(sql, /insert into public\.content_reports\([\s\S]*?from public\.listing_reports lr/i);
});

test("listing reports are visible and resolvable only within listing geography or Creator scope", async () => {
  const sql = await source("../supabase/migrations/20261019144712_listing_reports_to_content_reports.sql");
  assert.match(sql, /p_subject_type='listing'[\s\S]*?lower\(btrim\(coalesce\(l\.city,''\)\)\)=lower\(btrim\(p_actor\.assigned_lga\)\)/i);
  assert.match(sql, /public\.admin_list_content_reports[\s\S]*?_content_report_in_actor_scope/i);
  assert.match(sql, /public\.admin_resolve_content_report[\s\S]*?_content_report_in_actor_scope/i);
  assert.match(sql, /grant execute on function public\.report_listing\(text,text,text\) to authenticated,service_role/i);
});

test("reporters can privately check their own status without reading moderation internals", async () => {
  const [sql, privacy, component, api] = await Promise.all([
    source("../supabase/migrations/20261019144712_listing_reports_to_content_reports.sql"),
    source("../src/pages/PrivacySecuritySettings.tsx"),
    source("../src/components/MyReports.tsx"),
    source("../src/lib/supabase/reports.ts"),
  ]);
  assert.match(sql, /create or replace function public\.list_my_content_reports\(\)[\s\S]*?r\.reporter_user_id=\([\s\S]*?p\.auth_id=\(select auth\.uid\(\)\)::text/i);
  assert.match(sql, /revoke all on function public\.list_my_content_reports\(\) from public,anon/i);
  assert.match(sql, /grant execute on function public\.list_my_content_reports\(\) to authenticated/i);
  assert.doesNotMatch(sql.match(/create or replace function public\.list_my_content_reports\(\)[\s\S]*?\$\$;/i)?.[0] ?? "", /subject_user_id|resolved_by|resolution_note/);
  assert.match(api, /supabase\.rpc\('list_my_content_reports'\)/);
  assert.match(privacy, /Reports you sent[\s\S]*?setSection\('reports'\)/);
  assert.match(component, /Under review/);
  assert.match(component, /You have not sent any reports/);
  assert.match(component, /Try again/);
});
