import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";

function loadAppearance() {
  const values = new Map();
  const listeners = new Map();
  const meta = new Map(
    ["theme-color", "background-color"].map((name) => [
      name,
      { content: "", setAttribute(key, value) { if (key === "content") this.content = value; } },
    ]),
  );
  const classes = new Set();
  const document = {
    documentElement: {
      dataset: {},
      style: {},
      classList: { toggle(name, enabled) { enabled ? classes.add(name) : classes.delete(name); } },
    },
    querySelector(selector) {
      return meta.get(selector.match(/name="([^"]+)"/)?.[1]);
    },
  };
  const window = {
    localStorage: {
      getItem(key) { return values.get(key) || null; },
      setItem(key, value) { values.set(key, value); },
    },
    addEventListener(name, listener) {
      const group = listeners.get(name) || new Set();
      group.add(listener);
      listeners.set(name, group);
    },
    removeEventListener(name, listener) { listeners.get(name)?.delete(listener); },
    dispatchEvent(event) { for (const listener of listeners.get(event.type) || []) listener(event); },
  };
  const exports = {};
  const source = readFileSync("src/lib/appearance.ts", "utf8");
  vm.runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    {
      exports,
      Event,
      document,
      window,
      require(name) {
        if (name === "react") return { useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot() };
        if (name === "@/lib/native") return { isNative: () => false };
        throw new Error(`Unexpected appearance dependency: ${name}`);
      },
    },
  );
  return { exports, values, classes, document, meta, window };
}

test("appearance changes update the root theme, native color scheme, and browser chrome", () => {
  const { exports, values, classes, document, meta } = loadAppearance();

  exports.setAppearance("light");
  assert.equal(values.get("wehouse:appearance"), "light");
  assert.equal(document.documentElement.dataset.whTheme, "light");
  assert.equal(document.documentElement.style.colorScheme, "light");
  assert.equal(classes.has("dark"), false);
  assert.equal(meta.get("theme-color").content, "#F7F8FB");
  assert.equal(meta.get("background-color").content, "#F7F8FB");

  exports.setAppearance("dark");
  assert.equal(document.documentElement.dataset.whTheme, "dark");
  assert.equal(document.documentElement.style.colorScheme, "dark");
  assert.equal(classes.has("dark"), true);
  assert.equal(meta.get("theme-color").content, "#090B10");
  assert.equal(meta.get("background-color").content, "#090B10");
});

test("appearance synchronization applies a saved preference before rendering", () => {
  const { exports, values, document, meta } = loadAppearance();
  values.set("wehouse:appearance", "light");
  exports.startAppearanceSync();

  assert.equal(document.documentElement.dataset.whTheme, "light");
  assert.equal(document.documentElement.style.colorScheme, "light");
  assert.equal(meta.get("theme-color").content, "#F7F8FB");
});
