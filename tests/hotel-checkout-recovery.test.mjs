import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const api={};vm.runInNewContext(ts.transpileModule(readFileSync('src/lib/hotelCheckout.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:api,Error,Intl,Date,Number,Array});
const scope={personId:'guest',hotelId:7,roomId:12,ratePlanId:13,requestKey:'95000000-0000-4000-8000-000000000001'};
const hold=()=>({booking_id:77,hotel_id:7,room_id:12,rate_plan_id:13,user_id:'guest',request_key:scope.requestKey,check_in:'2026-11-04',check_out:'2026-11-06',total_nights:2,total_price:40000,guest_count:1,guest_name:'Guest',guest_phone:'08000000000',status:'pending',payment_status:'unpaid',payment_expires_at:'2026-11-01T10:30:00Z',cancellation_snapshot:{refundable:true,deadline:'2026-11-03T13:00:00Z',timezone:'Africa/Lagos',refund_amount_ngn:40000}});
test('room-hold receipts bind owner, room, package, request and immutable terms',()=>{
 assert.equal(api.hotelHoldReceipt(hold(),scope).booking_id,77);assert.equal(api.hotelHoldReceipt(null,scope),null);
 for(const changed of [{user_id:'someone-else'},{hotel_id:8},{room_id:14},{rate_plan_id:15},{request_key:'another-request'},{total_nights:3},{total_price:null},{guest_count:0},{payment_expires_at:'invalid'},{payment_status:'true'},{cancellation_snapshot:{...hold().cancellation_snapshot,deadline:null}},{cancellation_snapshot:{...hold().cancellation_snapshot,timezone:'Wrong/Zone'}},{cancellation_snapshot:{...hold().cancellation_snapshot,refund_amount_ngn:50000}}])assert.throws(()=>api.hotelHoldReceipt({...hold(),...changed},scope));
});
test('a paid or protected hold cannot reopen payment, even before confirmation finishes',()=>{
 const now=Date.parse('2026-11-01T10:00:00Z');
 assert.equal(api.hotelCheckoutState(hold(),now).canPay,true);
 for(const row of [{...hold(),payment_recorded:true},{...hold(),payment_status:'paid'},{...hold(),payment_protection_id:'protection-record'},{...hold(),status:'payment_conflict',payment_status:'paid'},{...hold(),payment_status:'partially_refunded'}]){
  const state=api.hotelCheckoutState(row,now);assert.equal(state.canPay,false);assert.equal(state.canStartNew,false);assert.equal(state.title,'Check your booking status');
 }
 const confirmed=api.hotelCheckoutState({...hold(),status:'confirmed',payment_status:'paid'},now);assert.equal(confirmed.canPay,false);assert.equal(confirmed.title,'Booking already confirmed');assert.equal(confirmed.canStartNew,true);
});
test('cancelled paid bookings keep cancellation wording without promising refund completion',()=>{
 const row={...hold(),status:'cancelled',payment_status:'paid'};const state=api.hotelCheckoutState(row);
 assert.equal(state.title,'Booking cancelled');assert.equal(state.canPay,false);assert.equal(state.canStartNew,true);assert.doesNotMatch(state.explanation,/refund completed|refund confirmed/i);
 assert.equal(api.hotelCheckoutState({...row,payment_status:'expired'}).title,'Unpaid room hold released');
});
test('expired holds require explicit fresh availability and do not claim a refund',()=>{
 const state=api.hotelCheckoutState(hold(),Date.parse('2026-11-01T10:31:00Z'));assert.equal(state.canPay,false);assert.equal(state.canStartNew,true);assert.equal(state.title,'Room hold expired');assert.doesNotMatch(state.explanation,/refund/i);
});
test('calendar-only checkout arithmetic survives month, year and leap-day boundaries',()=>{
 for(const [input,count,expected] of [['2026-10-29',1,'2026-10-30'],['2026-12-31',1,'2027-01-01'],['2028-02-28',1,'2028-02-29'],['2028-02-29',1,'2028-03-01'],['2026-02-30',1,'']])assert.equal(api.hotelCalendarDay(input,count),expected);
});
test('guest contact accepts local/international formatting but rejects undialable input',()=>{
 for(const phone of ['08000000000','+234 (800) 000 0000','+44 20 7000 0000'])assert.equal(api.validHotelPhone(phone),true);
 for(const phone of ['abc','123','+1234567890123456','0800 ext 12'])assert.equal(api.validHotelPhone(phone),false);
});
test('live quote receipts fail closed for malformed prices, availability and unsupported currency',()=>{
 assert.equal(api.hotelQuoteReceipt({available:true,nights:2,total_price:40000}).total_price,40000);
 for(const row of [{available:'true'},{available:true,nights:366,total_price:40000},{available:true,nights:2,total_price:'40000'},{available:true,nights:2,total_price:0},{available:true,nights:2,total_price:40000,currency:'USD'}])assert.throws(()=>api.hotelQuoteReceipt(row));
});
