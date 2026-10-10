import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const read = path => readFileSync(path, "utf8");
function load(path, dependencies = {}) {
  const exports = {};
  const code = ts.transpileModule(read(path), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, {
    exports,
    require: name => {
      if (Object.prototype.hasOwnProperty.call(dependencies, name)) return dependencies[name];
      throw new Error(`Unexpected dependency ${name} while loading ${path}`);
    },
  });
  return exports;
}
const workspace = load("src/lib/activityWorkspace.ts");
const activity = load("src/lib/activityFeed.ts", { "./activityWorkspace": workspace });

test("a withdrawn roommate request stays in history but is never an actionable Activity item", () => {
  assert.equal(activity.activityNeedsAction({
    type: "roommate_interest_withdrawn",
    title: "Roommate request withdrawn",
    message: "The sender withdrew this request before a match was made.",
    action_required: true,
  }), false);
});

test("roommate sender can cancel a pending request from both the list and profile sheet", () => {
  const page = read("src/pages/Roommate.tsx");
  assert.match(page, /cancelRoommateInterest\(match\.id\)/);
  assert.match(page, /Cancel request/);
  assert.match(page, /Roommate request cancelled/);
});

test("server withdrawal is owner-scoped, only for unanswered one-sided requests, and preserves established connections", () => {
  const migration = read("supabase/migrations/20261010140000_roommate_interest_withdrawal_and_activity_cleanup.sql");
  assert.match(migration, /where id = p_match_id and searcher_id = v_actor\.user_id/);
  assert.match(migration, /v_match\.status is distinct from 'accepted'/);
  assert.match(migration, /v_reverse_status in \('accepted', 'declined'\)/);
  assert.match(migration, /conversation\.status in \('active', 'accepted'\)/);
  assert.match(migration, /type = 'roommate_interest_withdrawn'/);
  assert.match(migration, /read = true/);
  assert.match(migration, /update of type, read, read_at, title, message/);
});
