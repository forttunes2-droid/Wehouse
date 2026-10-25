import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const load = file => {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports, Intl, Date, Number, navigator: { language: 'en-GB' } });
  return exports;
};
const regional = load('src/lib/regional.ts');

test('zoned input converts using the zone, not a fixed offset', () => {
  assert.equal(regional.zonedInputToISO('2026-09-24T00:30', 'Africa/Lagos'), '2026-09-23T23:30:00.000Z');
  assert.equal(regional.zonedInputToISO('2026-07-01T12:00', 'America/New_York'), '2026-07-01T16:00:00.000Z');
  assert.equal(regional.zonedInputToISO('2026-01-01T12:00', 'America/New_York'), '2026-01-01T17:00:00.000Z');
});

test('money uses the charged currency', () => {
  assert.match(regional.formatMoney(1500, { currency: 'GHS' }), /1,500/);
  assert.notEqual(regional.formatMoney(1500, { currency: 'USD' }), regional.formatMoney(1500, { currency: 'NGN' }));
});

test('recorded booking amounts survive region changes without currency conversion',()=>{
 const original=regional.formatRecordedMoney(1500,'NGN');
 regional.setRegionalDefaults({currencyCode:'USD',countryCode:'US'});
 assert.equal(regional.formatRecordedMoney(1500,'NGN'),original);
 assert.equal(regional.formatRecordedMoney(1500),original);
 assert.notEqual(regional.formatRecordedMoney(1500,'USD'),original);
 assert.match(regional.formatRecordedMoney(1.234,'KWD'),/1\.234/);
 assert.equal(regional.formatRecordedMoney(1500,'bad-code'),'Currency unavailable');
 for(const value of [null,undefined,{},false,'',NaN,Infinity])assert.equal(regional.formatRecordedMoney(value,'NGN'),'Amount unavailable');
 regional.setRegionalDefaults({currencyCode:'NGN',countryCode:'NG'});
});

test('country, zone and currency literals live only in the regional layer', () => {
  const offenders = [];
  const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).forEach(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    if (!/\.(ts|tsx)$/.test(entry.name) || /regional\.ts$|receiptFont/.test(entry.name)) return;
    const text = fs.readFileSync(full, 'utf8');
    if (/Africa\/Lagos|en-NG/.test(text)) offenders.push(full);
  });
  walk('src');
  assert.deepEqual(offenders, []);
});

test('home and Worker discovery accept locations without a Nigeria-only catalogue', () => {
  for (const file of ['src/pages/Search.tsx', 'src/pages/HotelsHome.tsx', 'src/pages/WorkerDiscovery.tsx']) {
    const source = fs.readFileSync(file, 'utf8');
    assert.match(source, /LocationFilterFields/);
    assert.doesNotMatch(source, /nigeria-locations|NIGERIA_STATES|getCitiesForState|label="LGA"/);
  }
});
