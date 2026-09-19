import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Consolidation replay executes the atomic Message WeHouse contract", async () => {
  const workflow = await read(".github/workflows/consolidation-validation.yml");
  assert.match(workflow, /support_first_send_contract\.sql/);
  assert.match(workflow, /Exercise atomic Message WeHouse first-send contract/);
});
