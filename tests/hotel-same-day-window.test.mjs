import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const modules={};
function load(name){
 if(modules[name])return modules[name];const exports={};modules[name]=exports;
 vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/'+name+'.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
  {exports,Intl,Date,require:dependency=>load(dependency.replace('./',''))});return exports;
}
const {hotelBookingWindow}=load('hotelBookingWindow');
test('same-day admission uses the Hotel day and exact cutoff, independently of viewer timezone',()=>{
 const policy={timezone:'Africa/Lagos',same_day_booking_cutoff:'18:00:00'};
 const before=hotelBookingWindow(policy,new Date('2026-10-31T16:59:59Z'));
 assert.equal(before.earliest,'2026-10-31');assert.equal(before.cutoffAt,'2026-10-31T17:00:00.000Z');
 const closed=hotelBookingWindow(policy,new Date('2026-10-31T17:00:00Z'));
 assert.equal(closed.earliest,'2026-11-01');assert.equal(closed.sameDayOpen,false);
 assert.equal(hotelBookingWindow({...policy,same_day_booking_cutoff:null},new Date('2026-10-31T12:00:00Z')).earliest,'2026-11-01');
 const west=hotelBookingWindow({timezone:'America/New_York',same_day_booking_cutoff:'23:00'},new Date('2026-10-31T02:00:00Z'));
 assert.equal(west.today,'2026-10-30');assert.equal(west.earliest,'2026-10-30');assert.equal(west.cutoffAt,'2026-10-31T03:00:00.000Z');
});
test('same-day presentation refreshes at cutoff and midnight without database polling',()=>{
 const first=hotelBookingWindow({timezone:'Africa/Lagos',same_day_booking_cutoff:'18:00'},new Date('2026-10-31T16:00:00Z'));
 assert.equal(first.nextRefreshAt,Date.parse('2026-10-31T17:00:00Z')+25);
 const closed=hotelBookingWindow({timezone:'Africa/Lagos',same_day_booking_cutoff:'18:00'},new Date('2026-10-31T18:00:00Z'));
 assert.equal(closed.nextRefreshAt,Date.parse('2026-10-31T23:00:00Z')+25);
 const next=hotelBookingWindow({timezone:'Africa/Lagos',same_day_booking_cutoff:'18:00'},new Date('2026-10-31T23:00:01Z'));
 assert.equal(next.today,'2026-11-01');assert.equal(next.sameDayOpen,true);
});
test('last-minute Hotel terms do not promise an already-expired free-cancellation window',()=>{
 const {hotelBookingCancellationText}=load('hotelCancellation');
 const terms={refundable:true,deadline:'2026-10-31T10:00:00Z'};
 assert.match(hotelBookingCancellationText(terms,'₦40,000','31 October, 11 AM WAT',Date.parse('2026-10-31T10:00:01Z')),/deadline has passed/);
 assert.match(hotelBookingCancellationText(terms,'your recorded payment','31 October, 11 AM WAT',Date.parse('2026-10-31T10:00:00Z')),/Full refund of your recorded payment/);
 assert.match(hotelBookingCancellationText({...terms,refundable:false},'₦40,000','',Date.now()),/non-refundable/);
 assert.match(hotelBookingCancellationText(null,'₦40,000','',Date.now()),/unavailable/);
});
