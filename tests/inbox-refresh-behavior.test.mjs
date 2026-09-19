import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = await readFile(new URL("../src/lib/refreshScheduler.ts", import.meta.url), "utf8");
const code = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const settle = () => new Promise(setImmediate);

function harness(load, visible = true) {
  const timers = new Map();
  let nextId = 0;
  const exports = {};
  vm.runInNewContext(code, {
    exports,
    setTimeout: (callback) => { timers.set(++nextId, callback); return nextId; },
    clearTimeout: (id) => timers.delete(id),
  });
  const scheduler = exports.createRefreshScheduler(load, () => visible);
  return {
    ...scheduler,
    show: (value) => { visible = value; },
    queued: () => timers.size,
    async tick() {
      const due = [...timers.values()];
      timers.clear();
      due.forEach((callback) => callback());
      await settle();
    },
  };
}

test("a burst of 100 inbox events needs one read and is not starved by more events", async () => {
  let reads = 0;
  const refresh = harness(async () => { reads++; });
  for (let i = 0; i < 100; i++) refresh.request();
  assert.equal(refresh.queued(), 1);
  await refresh.tick();
  assert.equal(reads, 1);
  assert.equal(refresh.queued(), 0);
});

test("events during a slow read produce one follow-up without concurrent reads", async () => {
  let reads = 0;
  const complete = [];
  const refresh = harness(() => {
    reads++;
    return new Promise((resolve) => complete.push(resolve));
  });
  refresh.request();
  await refresh.tick();
  for (let i = 0; i < 100; i++) refresh.request();
  await refresh.tick();
  assert.equal(reads, 1);
  complete.shift()();
  await settle();
  assert.equal(refresh.queued(), 1);
  await refresh.tick();
  assert.equal(reads, 2);
  complete.shift()();
  await settle();
  assert.equal(refresh.queued(), 0);
});

test("hidden tabs defer events and polling until the next visible refresh", async () => {
  let reads = 0;
  const refresh = harness(async () => { reads++; }, false);
  for (let i = 0; i < 100; i++) refresh.request();
  await refresh.tick();
  assert.equal(reads, 0);
  refresh.show(true);
  refresh.request();
  await refresh.tick();
  assert.equal(reads, 1);
  refresh.request();
  refresh.show(false);
  await refresh.tick();
  assert.equal(reads, 1, "hiding after scheduling must also defer the read");
  refresh.show(true);
  refresh.request();
  await refresh.tick();
  assert.equal(reads, 2);
});

test("leaving a workspace prevents its pending result from overwriting the new view", async () => {
  let finish;
  const published = [];
  const oldWorkspace = harness(async (isCurrent) => {
    await new Promise((resolve) => { finish = resolve; });
    if (isCurrent()) published.push("old");
  });
  oldWorkspace.request();
  await oldWorkspace.tick();
  oldWorkspace.request();
  oldWorkspace.dispose();
  const newWorkspace = harness(async (isCurrent) => {
    if (isCurrent()) published.push("new");
  });
  newWorkspace.request();
  await newWorkspace.tick();
  finish();
  await settle();
  assert.deepEqual(published, ["new"]);
  assert.equal(oldWorkspace.queued(), 0);
});

test("disposing before a scheduled read cancels it and ignores late events", async () => {
  let reads = 0;
  const refresh = harness(async () => { reads++; });
  refresh.request();
  refresh.dispose();
  refresh.request();
  await refresh.tick();
  assert.equal(reads, 0);
});

test("a network rejection stops cleanly and a later event can recover", async () => {
  let reads = 0;
  const refresh = harness(async () => {
    if (++reads === 1) throw new Error("Offline");
  });
  refresh.request();
  await refresh.tick();
  assert.equal(refresh.queued(), 0, "do not retry a failed read in a tight loop");
  refresh.request();
  await refresh.tick();
  assert.equal(reads, 2);
});
