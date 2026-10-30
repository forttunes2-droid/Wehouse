import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const api={};vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/hotelCancellation.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:api,Error,Intl,Date});
const valid=()=>({booking_id:71,kind:'full_refund',can_cancel:true,message:'Cancel and request refund',currency:'NGN',refund_amount_ngn:40000,fee_ngn:0,deadline:'2027-10-20T13:00:00Z',timezone:'Africa/Lagos'});
test('Hotel cancellation preview binds booking, eligibility, exact amount and property deadline',()=>{
 assert.equal(api.hotelCancellationPreview(valid(),71).refund_amount_ngn,40000);
 for(const change of [{booking_id:72},{kind:'other'},{can_cancel:false},{currency:'USD'},{refund_amount_ngn:null},{refund_amount_ngn:0},{refund_amount_ngn:Infinity},{fee_ngn:undefined},{fee_ngn:10},{deadline:'invalid'},{timezone:'Other/Nowhere'}])assert.throws(()=>api.hotelCancellationPreview({...valid(),...change},71));
});
test('review and cancelled previews cannot offer a cancellation action or invent a refund',()=>{
 for(const kind of ['review_required','already_cancelled']){
  const row={booking_id:71,kind,can_cancel:false,message:'Review current booking'};
  assert.equal(api.hotelCancellationPreview(row,71).can_cancel,false);
  assert.throws(()=>api.hotelCancellationPreview({...row,can_cancel:true},71));
 }
 assert.throws(()=>api.hotelCancellationPreview({booking_id:71,kind:'already_cancelled',can_cancel:false,message:'Cancelled',refund_status:'made_up'},71));
});
test('unpaid cancellation confirms zero charge and zero deduction',()=>{
 const row={booking_id:71,kind:'unpaid',can_cancel:true,message:'Unpaid booking',currency:'NGN',refund_amount_ngn:0,fee_ngn:0};
 assert.equal(api.hotelCancellationPreview(row,71).refund_amount_ngn,0);
 assert.throws(()=>api.hotelCancellationPreview({...row,refund_amount_ngn:40000},71));
});
