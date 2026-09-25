import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const exports = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/bookingMoneyPolicyResponse.ts','utf8'), { compilerOptions: {module:ts.ModuleKind.CommonJS} }).outputText, {exports});
const valid = () => JSON.parse(fs.readFileSync('tests/fixtures/booking-money-policy.json','utf8'));
test('complete policy preserves real configured prices and permits intentional zero',()=>{
 const data=valid();assert.equal(exports.isMoneyPolicyResponse(data),true);
 data.active.commission_hotel.value.percent=0; assert.equal(exports.isMoneyPolicyResponse(data),true);
 assert.equal(data.active.long_let_reservation_fee.value.amount,12345);
});
test('null, missing, denied, array and wrong-source results never become defaults',()=>{
 for(const data of [null,{},[],{error:'denied'}, {...valid(),source_of_truth:'local_defaults'}, {...valid(),active:[]}, {...valid(),scheduled:null}])assert.equal(exports.isMoneyPolicyResponse(data),false);
 const data=valid(); delete data.active.long_let_reservation_fee;assert.equal(exports.isMoneyPolicyResponse(data),false);
});
test('every displayed policy field must have its original finite typed value',()=>{
 for (const invalid of [null,'', '10000',NaN,Infinity,-1]) {
  const data=valid(); data.active.long_let_reservation_fee.value.amount=invalid; assert.equal(exports.isMoneyPolicyResponse(data),false,String(invalid));
 }
 const data=valid(); data.active.short_let_caution_cap.value.enabled='false';assert.equal(exports.isMoneyPolicyResponse(data),false);
});
test('invalid policy versions and scheduled entries stay unavailable',()=>{
 for(const version of [0,-1,1.5,null,'1']) {const data=valid();data.active.long_let_reservation_fee.version=version;assert.equal(exports.isMoneyPolicyResponse(data),false);}
 const data=valid(); data.scheduled={unknown:null};assert.equal(exports.isMoneyPolicyResponse(data),false);
});
