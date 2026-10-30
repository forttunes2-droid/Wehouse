import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const exports={};
vm.runInNewContext(ts.transpileModule(readFileSync('supabase/functions/_shared/payment-market.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports});
const {paymentMinorUnits,resolvePaymentMarket}=exports;
test('payment routing respects country and never falls back from an unsupported market',()=>{
 assert.equal(resolvePaymentMarket('NGN','NG').provider,'paystack');
 for(const country of ['US','GB','GH','ng','',null,12])assert.equal(resolvePaymentMarket('NGN',country),null);
 assert.equal(resolvePaymentMarket('USD','NG'),null);
 assert.equal(resolvePaymentMarket('NGN').country,'NG');
});
test('payment support is explicit and independent of display defaults',()=>{
 assert.equal(resolvePaymentMarket('NGN').country,'NG');
 assert.equal(resolvePaymentMarket('NGN').provider,'paystack');
 for(const currency of [null,undefined,'','USD','GBP','ngn'])assert.equal(resolvePaymentMarket(currency),null);
});
test('minor units are exact for zero, two and three digit currencies',()=>{
 assert.equal(paymentMinorUnits('123',0),123);
 assert.equal(paymentMinorUnits('123.45',2),12345);
 assert.equal(paymentMinorUnits('123.456',3),123456);
 assert.equal(paymentMinorUnits('123.4500',2),12345);
 assert.equal(paymentMinorUnits(100.5,2),10050);
 for(const value of [null,undefined,'',true,'1e3','NaN',Infinity,-1,0,'1.001'])assert.equal(paymentMinorUnits(value,2),null);
 assert.equal(paymentMinorUnits('9007199254740992',0),null);
 assert.equal(paymentMinorUnits('1',4),null);
});
