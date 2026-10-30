import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("shared themes expose page, surface, text and accent tokens", async () => {
  const css = await read("src/index.css");
  for (const token of [
    "--wh-bg",
    "--wh-surface",
    "--wh-elevated",
    "--wh-text",
    "--wh-text-secondary",
    "--wh-text-muted",
    "--wh-accent-text",
  ]) {
    assert.equal((css.match(new RegExp(token, "g")) || []).length >= 2, true, `${token} must be defined for both themes`);
  }
});

test("legacy 7px through 10px UI text and map labels use the documented 12px minimum", async () => {
  const css = await read("src/index.css");
  for (const size of [7, 8, 9, 10]) {
    assert.match(css, new RegExp(`\\.text-\\\\\\[${size}px\\\\\\]`));
    assert.match(css, new RegExp(`class~="!text-\\[${size}px\\]"`));
  }
  assert.match(css, /\.leaflet-control-attribution[\s\S]*?font-size: 12px !important/);
  assert.match(css, /\.leaflet-tooltip[\s\S]*?font-size: 12px !important/);
  assert.match(await read("src/components/message-attachments.css"), /\.wh-request-conversation-head small[\s\S]*?font-size: 12px/);
  assert.match(css, /font-size:\s*0\.75rem/);
  assert.match(await read("docs/DESIGN_SYSTEM.md"), /12px is the minimum rendered size/);
});
