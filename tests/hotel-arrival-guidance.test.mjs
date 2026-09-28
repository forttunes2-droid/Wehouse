import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = fs.readFileSync('src/lib/hotelArrivalGuidance.ts', 'utf8');
const exports = {};
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports, Intl, Date });
const guidance = exports.hotelArrivalGuidance;

test('arrival guidance uses the hotel date across midnight for a remote guest', () => {
  const now = new Date('2026-09-28T23:30:00Z');
  assert.match(guidance('2026-09-29', '2026-10-01', '2:00 PM', 'Africa/Lagos', now), /Check-in today/);
  assert.match(guidance('2026-09-29', '2026-10-01', '2:00 PM', 'America/New_York', now), /Check-in tomorrow/);
});

test('a missed arrival is actionable without promising an automatic refund', () => {
  const now = new Date('2026-09-29T12:00:00Z');
  assert.match(guidance('2026-09-27', '2026-09-30', '2:00 PM', 'Africa/Lagos', now), /contact the hotel/i);
  const missed = guidance('2026-09-20', '2026-09-22', '2:00 PM', 'Africa/Lagos', now);
  assert.match(missed, /Contact WeHouse/);
  assert.doesNotMatch(missed, /refund/i);
  assert.equal(guidance('invalid', '2026-09-30', '2:00 PM', 'Africa/Lagos', now), null);
});
