import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const {outputFiles}=await build({entryPoints:['supabase/functions/_shared/service-quote.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const {parseServiceQuote:parse,serviceCheckoutContractMatches:matches}=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'));
const quote={revision:2,booking_id:'job',customer_id:'customer',provider_id:'provider',amount:42000,currency:'NGN',customer_service_charge:0,scope:'Clean the agreed rooms',address:'Agreed location',starts_at:'2027-01-02T09:00:00Z',timezone:'Africa/Lagos',cancellation:{version:'service-standard-24h-v1',full_refund_until:'2027-01-01T09:00:00Z',late_cancellation:'wehouse_review',provider_cancellation:'full_refund'}};
const booking={id:'job',user_id:'customer',worker_id:'provider',service_quote:quote,service_quote_revision:2,service_quote_accepted_revision:2,service_quote_accepted_at:'2026-10-26T12:00:00Z'};
const metadata={service_quote:structuredClone(quote),service_quote_accepted_at:booking.service_quote_accepted_at};
const now=Date.parse('2026-10-26T13:00:00Z');
test('checkout accepts only the same customer-accepted work, price, schedule and cancellation snapshot',()=>{
 assert.ok(parse(quote));assert.ok(matches(booking,metadata,42000,now));
 for(const change of [{scope:'Different work'}, {amount:43000},{timezone:'Europe/London'},{revision:3},{provider_id:'another-provider'},{address:'Another location'}])assert.equal(matches(booking,{...metadata,service_quote:{...quote,...change}},42000,now),false);
});
test('stale, missing, wrong-account and elapsed quote acceptance cannot initialize a payment',()=>{
 for(const change of [{service_quote_accepted_revision:null},{service_quote_accepted_revision:1},{service_quote_revision:3},{service_quote_accepted_at:null},{user_id:'outsider'},{worker_id:'other'},{id:'other-job'}])assert.equal(matches({...booking,...change},metadata,42000,now),false);
 assert.equal(matches(booking,{...metadata,service_quote_accepted_at:'2026-10-26T11:59:00Z'},42000,now),false);
 assert.equal(matches(booking,metadata,42000,Date.parse(quote.starts_at)),false);
 assert.equal(matches(booking,metadata,1,now),false);
});
test('malformed prices, unapproved policies, unknown timezone and fabricated deadlines fail closed',()=>{
 for(const change of [{amount:NaN},{amount:1.001},{currency:'USD'},{customer_service_charge:100},{timezone:'Unknown/Zone'},{starts_at:'not-a-date'},{scope:''},{cancellation:{...quote.cancellation,version:'unapproved'}},{cancellation:{...quote.cancellation,full_refund_until:'2027-01-02T08:00:00Z'}}])assert.equal(parse({...quote,...change}),null);
});
