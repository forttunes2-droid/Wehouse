import {supabase} from './client';
import {withTimeout} from '@/lib/withTimeout';
import {parseServiceQuote} from '@/lib/serviceQuote';
import {initializePaymentReference} from './housing-payments';

export async function sendServiceQuote(bookingId:string,amount:number,startsAt:string,timeZone:string,scope:string){
 const {data,error}=await withTimeout(supabase.rpc('send_my_service_quote',{
  p_booking_id:bookingId,p_amount:amount,p_starts_at:startsAt,p_timezone:timeZone,p_scope:scope,
 }),15000,'The quote could not be confirmed. Refresh before retrying.');
 const quote=parseServiceQuote(data);
 const confirmed=quote&&quote.booking_id===bookingId&&quote.amount===amount
  &&Date.parse(quote.starts_at)===Date.parse(startsAt)&&quote.timezone===timeZone&&quote.scope===scope.trim();
 return {quote,error:error||(!confirmed?new Error('The quote could not be confirmed. Refresh before retrying.'):null)};
}

export async function acceptServiceQuoteAndCheckout(bookingId:string,revision:number){
 const {data,error}=await withTimeout(supabase.rpc('accept_my_service_quote',{
  p_booking_id:bookingId,p_revision:revision,
 }),15000,'Quote acceptance could not be confirmed. Refresh before retrying.');
 if(error||data?.accepted!==true||data.revision!==revision||!Number.isFinite(Date.parse(data.accepted_at))){
  return {result:null,error:error||new Error('Quote acceptance could not be confirmed. Refresh before retrying.')};
 }
 const checkout=await withTimeout(supabase.rpc('create_worker_booking_payment',{p_booking_id:bookingId}),15000,'Checkout could not be confirmed. Refresh before retrying.');
 if(checkout.error||checkout.data?.success!==true||typeof checkout.data.reference!=='string'){
  return {result:null,error:checkout.error||new Error(checkout.data?.error||'Checkout could not be confirmed.')};
 }
 const initialized=await initializePaymentReference(checkout.data.reference);
 if(initialized.result?.success===true&&(initialized.result.reference!==checkout.data.reference||initialized.result.purpose!=='worker_booking')){
  return {result:null,error:new Error('The Service checkout receipt did not match this booking. Refresh before retrying.')};
 }
 return initialized;
}
