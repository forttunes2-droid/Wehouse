import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/components/BookingNegotiationChat.tsx", import.meta.url), "utf8");

test("worker conversation info and chat header both open the worker-chat report form", () => {
  const start = source.indexOf("function openReport()");
  const end = source.indexOf("function chooseFiles(", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const profileReportAction = source.slice(start, end);
  assert.match(profileReportAction, /setProfileOpen\(false\)/);
  assert.match(profileReportAction, /setReportOpen\(true\)/);
  assert.doesNotMatch(profileReportAction, /openSupport\(/);
  assert.match(source, /onReport=\{openReport\}/);
  assert.match(source, /onClick=\{\(\) => setReportOpen\(true\)\}/);
  assert.match(source, /subjectType="worker_chat"[\s\S]*subjectRef=\{conversationId\}/);
});
