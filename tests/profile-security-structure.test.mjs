import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Internal profile viewer stays descriptive and Team grants live in the canonical Team workspace", async () => {
  const [profile, team] = await Promise.all([
    read("src/components/UserProfileModal.tsx"),
    read("src/pages/StaffListTab.tsx"),
  ]);
  assert.match(profile, /type SectionKey =[\s\S]*\| "workspaces"[\s\S]*\| "professional"[\s\S]*\| "apartments"[\s\S]*\| "hotels"[\s\S]*\| "hotel_team"[\s\S]*\| "wehouse_team"/);
  assert.doesNotMatch(profile, /\| "access"/);
  assert.match(profile, /Profile sections/);
  assert.match(profile, /label: "Access", count: workspaces\.length/);
  assert.match(profile, /<ApartmentList/);
  assert.match(profile, /<HotelList/);
  assert.match(profile, /<HotelTeam/);
  assert.match(profile, /<WeHouseTeam/);
  assert.doesNotMatch(profile, /<TeamAccess|admin_appoint_staff/);
  assert.match(team, /title="WeHouse Team"/);
  assert.match(team, /Whole State/);
  assert.match(team, /One LGA/);
  assert.match(team, /creator_set_admin_authority/);
  assert.match(team, /admin_appoint_staff/);
});

test("Property Partner apartment and hotel records are individually inspectable", async () => {
  const profile = await read("src/components/UserProfileModal.tsx");
  assert.match(profile, /<ApartmentList rows=\{apartments\} onOpen=\{\(row\) => setSelected\(\{ kind: "apartment", row \}\)\}/);
  assert.match(profile, /<HotelList rows=\{hotels\} onOpen=\{\(row\) => setSelected\(\{ kind: "hotel", row \}\)\}/);
  assert.match(profile, /function ApartmentList/);
  assert.match(profile, /function HotelList/);
  assert.match(profile, /function PropertyDetail/);
  assert.match(profile, /Record ID/);
  assert.match(profile, /Open in Property Operations/);
  assert.doesNotMatch(profile, /partnerProperties\.slice\(0, 5\)/);
});

test("Security Operations investigates and escalates but cannot impose account sanctions", async () => {
  const [security, migration] = await Promise.all([
    read("src/components/StaffSecurityOverviewV2.tsx"),
    read("supabase/migrations/20260921115000_finance_security_scope_authority.sql"),
  ]);
  assert.match(security, /get_my_staff_security_cases/);
  assert.match(security, /staff_security_open_signal_case/);
  assert.match(security, /staff_security_case_action/);
  assert.match(security, /Claim investigation/);
  assert.match(security, /Escalate decision/);
  assert.match(security, /Resolve review/);
  assert.doesNotMatch(security, /admin_suspend_user|admin_ban_user/);
  assert.match(migration, /current_staff_has_permission\('security_operations'\)/);
  assert.match(migration, /current_actor_in_scope/);
  assert.match(migration, /p_action not in\('claim','note','escalate','resolve'\)/);
  assert.match(migration, /Security case is outside your assigned coverage/);
  assert.match(migration, /security_case_escalated/);
});

test("Admin has a canonical Security escalation work area inside its coverage", async () => {
  const [admin, cases, migration] = await Promise.all([
    read("src/pages/AdminDashboard.tsx"),
    read("src/components/AdminSecurityCases.tsx"),
    read("supabase/migrations/20260916104500_security_operations_case_control.sql"),
  ]);
  assert.match(admin, /\| "security"/);
  assert.match(admin, /"Security Operations escalations and account decisions in your coverage"/);
  assert.match(admin, /<AdminSecurityCases/);
  assert.match(admin, /route\.includes\("security"\)/);
  assert.match(cases, /get_my_admin_security_cases/);
  assert.match(cases, /admin_security_case_decision/);
  assert.match(cases, /Temporarily suspend account/);
  assert.match(cases, /Resolve without restriction/);
  assert.match(migration, /perform public\.admin_suspend_user/);
  assert.match(migration, /p_decision not in\('suspend','ban','no_action'\)/);
});
