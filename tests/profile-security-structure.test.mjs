import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Admin and Creator profile viewer has role-aware structural navigation", async () => {
  const profile = await read("src/components/UserProfileModal.tsx");
  assert.match(profile, /type SectionKey = "overview" \| "professional" \| "properties" \| "assignment" \| "access"/);
  assert.match(profile, /Profile sections/);
  assert.match(profile, /label: "Properties", count: partnerProperties\.length/);
  assert.match(profile, /<PropertiesSection/);
  assert.match(profile, /<AssignmentSection/);
});

test("Property Partner properties are individually inspectable from the profile record", async () => {
  const profile = await read("src/components/UserProfileModal.tsx");
  assert.match(profile, /properties\.map\(\(property, index\) =>/);
  assert.match(profile, /onClick=\{\(\) => onOpen\(property\)\}/);
  assert.match(profile, /function PropertyRecord/);
  assert.match(profile, /Property ID/);
  assert.match(profile, /Open in Property Operations/);
  assert.doesNotMatch(profile, /partnerProperties\.slice\(0, 5\)/);
});

test("Security Operations investigates and escalates but cannot impose account sanctions", async () => {
  const [security, migration] = await Promise.all([
    read("src/components/StaffSecurityOverviewV2.tsx"),
    read("supabase/migrations/20260916104500_security_operations_case_control.sql"),
  ]);
  assert.match(security, /get_my_staff_security_cases/);
  assert.match(security, /staff_security_open_signal_case/);
  assert.match(security, /staff_security_case_action/);
  assert.match(security, /Claim investigation/);
  assert.match(security, /Escalate decision/);
  assert.match(security, /Resolve review/);
  assert.doesNotMatch(security, /admin_suspend_user|admin_ban_user/);
  assert.match(migration, /sp\.permission='security'/);
  assert.match(migration, /Security Staff branch assignment is incomplete/);
  assert.match(migration, /p_action not in\('claim','note','escalate','resolve'\)/);
  assert.match(migration, /Security case is outside your branch/);
  assert.match(migration, /security_case_escalated/);
});

test("Branch Admin has a canonical Security escalation work area", async () => {
  const [admin, cases, migration] = await Promise.all([
    read("src/pages/AdminDashboard.tsx"),
    read("src/components/AdminSecurityCases.tsx"),
    read("supabase/migrations/20260916104500_security_operations_case_control.sql"),
  ]);
  assert.match(admin, /\| "security"/);
  assert.match(admin, /"Security Operations escalations and branch account decisions"/);
  assert.match(admin, /<AdminSecurityCases/);
  assert.match(admin, /route\.includes\("security"\)/);
  assert.match(cases, /get_my_admin_security_cases/);
  assert.match(cases, /admin_security_case_decision/);
  assert.match(cases, /Temporarily suspend account/);
  assert.match(cases, /Resolve without restriction/);
  assert.match(migration, /perform public\.admin_suspend_user/);
  assert.match(migration, /p_decision not in\('suspend','ban','no_action'\)/);
});
