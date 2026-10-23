import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function setup(duration = 30, mode = 'ready') {
  let released = 0;
  const video = { duration, pause() {}, load() {}, removeAttribute() {},
    set src(_value) { queueMicrotask(() => mode === 'ready' ? this.onloadedmetadata?.() : mode === 'error' ? this.onerror?.() : undefined); } };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/mediaVideo.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, document: { createElement: () => video },
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL: () => released++ },
    window: { setTimeout: action => setTimeout(action, 20), clearTimeout },
  });
  return { api: exports, released: () => released };
}
const file = { size: 1000, type: 'video/mp4' };

test('small videos still require playable metadata and obey the duration limit', async () => {
  for (const duration of [0, Infinity, 91]) {
    const state = setup(duration);
    await assert.rejects(state.api.preparePublicVideo(file), /no more than 90 seconds/);
    assert.equal(state.released(), 1);
  }
  const state = setup();
  assert.equal((await state.api.preparePublicVideo(file)).body, file);
  assert.equal(state.released(), 1);
});
test('unreadable and stalled videos do not bypass validation by being small', async () => {
  for (const mode of ['error', 'timeout']) {
    const state = setup(30, mode);
    await assert.rejects(state.api.preparePublicVideo(file), /could not be opened|too long to open/);
    assert.equal(state.released(), 1);
  }
});
test('private evidence has its explicit longer duration budget and empty videos are rejected', async () => {
  const state = setup(150);
  assert.equal((await state.api.prepareEvidenceVideo(file)).body, file);
  await assert.rejects(state.api.preparePublicVideo({ ...file, size: 0 }), /not empty/);
});
