import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/partnerOperatingCosts.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports});
test('operating cost entry requires positive finite NGN amounts with at most two decimals',()=>{
  assert.equal(exports.operatingCostAmount('12500.50'),12500.5);
  for(const value of ['0','-10','1.005','NaN','Infinity','1e3','100,000','9999999999999'])assert.equal(exports.operatingCostAmount(value),null);
});
const report={month:'2026-10-01',currency:'NGN',reporting_timezone:'UTC',costs:[],cost_count:0,recorded_costs_ngn:0,released_income_ngn:100,recorded_margin_ngn:100,mixed_currency:false,unattributed_earnings:0,next_before_on:null,next_before_id:null};
test('malformed operating reports cannot invent balances or mix currencies',()=>{
  assert.equal(exports.parseOperatingReport(report).released_income_ngn,100);
  for(const value of [null,{}, {...report,recorded_costs_ngn:NaN},{...report,cost_count:-1},{...report,mixed_currency:true},{...report,next_before_on:'2026-10-10'}])assert.throws(()=>exports.parseOperatingReport(value));
  assert.equal(exports.parseOperatingReport({...report,mixed_currency:true,released_income_ngn:null,recorded_margin_ngn:null}).recorded_margin_ngn,null);
});
test('cost CSV preserves quotes and neutralizes spreadsheet formulas in user text',()=>{
  const csv=exports.operatingCostsCsv([{id:'one',asset_kind:'hotel',asset_id:'42',incurred_on:'2026-10-19',category:'cleaning',title:'=HYPERLINK("example")',amount_ngn:1250}],()=>'+Property formula');
  assert.match(csv,/'=HYPERLINK\(""example""\)/);
  assert.match(csv,/'\+Property formula/);
  assert.match(csv,/"1250"/);
});
