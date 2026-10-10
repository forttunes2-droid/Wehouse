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

test("Activity badge counts exactly the unread canonical rows visible in each workspace feed", () => {
  const now = Date.now();
  const rows = [
    { id: "personal-1", type: "account_security_notice", workspace: "personal", read: false, created_at: new Date(now - 1000).toISOString() },
    { id: "worker-1", type: "worker_job_update", workspace: "worker", read: false, created_at: new Date(now - 2000).toISOString(), source_type: "worker_job", source_id: "job-1" },
    { id: "partner-1", type: "property_update", workspace: "property_partner", read: false, created_at: new Date(now - 3000).toISOString(), source_type: "property", source_id: "property-1" },
    { id: "hotel-1", type: "hotel_booking_update", workspace: "hotel", read: false, created_at: new Date(now - 4000).toISOString(), source_type: "hotel_booking", source_id: "booking-1" },
    { id: "staff-1", type: "operations_case_update", workspace: "property_operations", read: false, created_at: new Date(now - 5000).toISOString(), source_type: "case", source_id: "case-1" },
    { id: "admin-1", type: "admin_review_update", workspace: "admin", read: false, created_at: new Date(now - 6000).toISOString(), source_type: "review", source_id: "review-1" },
    { id: "creator-1", type: "creator_review_update", workspace: "creator", read: false, created_at: new Date(now - 7000).toISOString(), source_type: "review", source_id: "review-2" },
    { id: "read-1", type: "booking_update", workspace: "property_partner", read: true, created_at: new Date(now - 8000).toISOString(), source_type: "booking", source_id: "booking-read" },
    { id: "typing-1", type: "typing", workspace: "property_partner", read: false, created_at: new Date(now - 9000).toISOString() },
  ];
  const scopes = [
    ["personal", 1],
    ["worker", 1],
    ["partner", 1],
    ["hotel", 1],
    ["staff", 1],
    ["admin", 1],
    ["creator", 1],
  ];
  for (const [scope, expected] of scopes) {
    const visible = activity.currentActivityRows(
      rows.filter(row => workspace.activityWorkspaceMatches(scope, row.workspace)),
    );
    assert.equal(visible.filter(row => !row.read).length, expected, `${scope} feed unread rows`);
    assert.equal(activity.visibleUnreadActivityCount(rows, scope), visible.filter(row => !row.read).length, `${scope} badge must match feed rows`);
  }
});

test("Activity summaries do not replace a complete badge count with partial data after a failed source read", () => {
  for (const path of [
    "src/hooks/usePartnerInboxSummary.ts",
    "src/hooks/useWorkerInboxSummary.ts",
    "src/hooks/useCreatorInboxSummary.ts",
    "src/hooks/useOperationsInboxSummary.ts",
  ]) {
    const source = read(path);
    assert.match(source, /!events\.error && !announcements\.error|!activityFeed\.error && !announcements\.error/, path);
  }
  const app = read("src/App.tsx");
  assert.match(app, /if \(!activityResult\.error && !announcementResult\.error\)\s*setNotificationCount/);
  const account = read("src/pages/AccountCenter.tsx");
  assert.match(account, /result\.error \? \(current\[result\.role\] \|\| 0\) : visibleUnreadActivityCount/);
});
