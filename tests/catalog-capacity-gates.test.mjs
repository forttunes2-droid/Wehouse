import test from 'node:test';
import assert from 'node:assert/strict';
import { assessCatalogStage, catalogWarmupComplete } from '../scripts/lib/catalog-capacity-gates.mjs';

const paths = ['homes', 'hotels'];
function stage() {
  return { target_rps: 1, seconds: 30, offered: 30, completed: 30, errors: 0, dropped: 0,
    retry_rate_pct: 0, p95_ms: 500, dispatch_seconds: 30,
    by_path: { homes: { requests: 15, errors: 0, p95_ms: 500 }, hotels: { requests: 15, errors: 0, p95_ms: 700 } } };
}
test('catalog gate accepts complete measured read evidence within its stated thresholds', () => {
  assert.deepEqual(assessCatalogStage(stage(), paths), { passed: true, failures: [] });
});
test('zero HTTP errors cannot hide slow overall or individual catalog paths', () => {
  const overall = stage(); overall.p95_ms = 2001;
  assert.equal(assessCatalogStage(overall, paths).passed, false);
  const hotel = stage(); hotel.by_path.hotels.p95_ms = 3000;
  assert.equal(assessCatalogStage(hotel, paths).passed, false);
});
test('missing measurements, dropped work, retries and a stalled load generator cannot pass', () => {
  for (const changes of [{ dispatch_seconds: 40 }, { dispatch_seconds: NaN }, { p95_ms: null },
    { completed: 29 }, { errors: 1 }, { dropped: 1 }, { retry_rate_pct: 1.1 }, { by_path: {} }]) {
    assert.equal(assessCatalogStage({ ...stage(), ...changes }, paths).passed, false, JSON.stringify(changes));
  }
  const missing = stage(); missing.by_path.hotels.requests = 14;
  assert.equal(assessCatalogStage(missing, paths).passed, false);
});
test('warm-up must validate every distinct route, including after a deadline is reached', () => {
  assert.equal(catalogWarmupComplete(paths, paths), true);
  for (const evidence of [[], ['homes'], ['homes', 'homes'], null])
    assert.equal(catalogWarmupComplete(evidence, paths), false);
});
