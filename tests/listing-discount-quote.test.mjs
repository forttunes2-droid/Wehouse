import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const exports={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/listingDiscountQuote.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports});
const {listingDiscountQuote,discountedListingRate}=exports;
test('home offer preview preserves minor units and Postgres half-up ties',()=>{
 assert.equal(discountedListingRate('1000.99',10),900.89);
 assert.equal(discountedListingRate('1.01',50),0.51);
 assert.equal(discountedListingRate('12500.55',0),12500.55);
 for(const value of [null,undefined,'',false,-1,NaN,Infinity,{},'1.001'])assert.equal(discountedListingRate(value,10),null);
 assert.equal(discountedListingRate('1000.99',NaN),null);
});
test('offer receipts reject malformed or contradictory percentages and dates',()=>{
 const valid={host_percent:'5.5',wehouse_percent:2,total_percent:7.5,ends_on:'2026-11-30'};
 assert.equal(listingDiscountQuote(valid).total,7.5);
 for(const value of [null,{}, {...valid,total_percent:8},{...valid,host_percent:null},{...valid,wehouse_percent:Infinity},{...valid,ends_on:'2026-02-31'}])assert.throws(()=>listingDiscountQuote(value));
});
