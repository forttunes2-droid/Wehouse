import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("canonical Staff permissions map each Staff account to one Operation", async () => {
  const [permissions, workspace] = await Promise.all([
    read("src/lib/supabase/permissions.ts"),
    read("src/pages/StaffWorkspaceRepair.tsx"),
  ]);
  assert.match(permissions, /property_operations: 'operations'/);
  assert.match(permissions, /field_operations: 'field_officer'/);
  assert.match(permissions, /worker_operations: 'worker_operations'/);
  assert.match(permissions, /worker_review: 'worker_operations'/);
  assert.match(workspace, /title: "Worker Operations"/);
  assert.match(permissions, /finance_operations: 'finance'/);
  assert.match(permissions, /security_operations: 'security'/);
  assert.match(permissions, /permissions: \[\.\.\.new Set\(permissions\)\]/);
  assert.match(workspace, /assigned\.length !== 1/);
});
