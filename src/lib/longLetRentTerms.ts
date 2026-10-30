import { supabase } from './supabase/client';
import { withTimeout } from './withTimeout';

export const LONG_LET_TERMS = [3,6,12,24,36,48,60] as const;
export type LongLetRentTerms = { listing_id: string; revision: number; accepted_terms_months: number[]; monthly_accepted: boolean };
export function rentTermLabel(months: number): string { return months < 12 ? `${months} months` : `${months/12} year${months===12?'':'s'}`; }
export function longLetTermsReceipt(value: unknown, listingId: string): LongLetRentTerms {
  const row=value as LongLetRentTerms;
  if (!row || row.listing_id!==listingId || !Number.isSafeInteger(row.revision) || row.revision<1 ||
    typeof row.monthly_accepted!=='boolean' || !Array.isArray(row.accepted_terms_months) ||
    row.accepted_terms_months.length<1 || row.accepted_terms_months.length>LONG_LET_TERMS.length ||
    row.accepted_terms_months.some(term=>!LONG_LET_TERMS.some(allowed=>allowed===term)) ||
    new Set(row.accepted_terms_months).size!==row.accepted_terms_months.length) throw new Error('Rental terms could not be confirmed. Refresh before continuing.');
  return row;
}
async function command(name: string, args: Record<string,unknown>) {
  const {data,error}=await withTimeout(supabase.rpc(name,args),15000,'Rental terms confirmation took too long. Refresh saved terms before retrying.');
  if(error)throw error;return data;
}
export async function getLongLetRentTerms(listingId:string) {
  return longLetTermsReceipt(await command('get_my_long_let_rent_terms',{p_listing_id:listingId}),listingId);
}
export async function saveLongLetRentTerms(previous:LongLetRentTerms,terms:number[],monthly:boolean) {
  const normalized=[...terms].sort((a,b)=>a-b);
  const saved=longLetTermsReceipt(await command('set_my_long_let_rent_terms',{
    p_listing_id:previous.listing_id,p_expected_revision:previous.revision,p_terms_months:normalized,p_monthly_accepted:monthly,
  }),previous.listing_id);
  if(![previous.revision,previous.revision+1].includes(saved.revision) || saved.monthly_accepted!==monthly ||
    JSON.stringify(saved.accepted_terms_months)!==JSON.stringify(normalized)) throw new Error('Saved rental terms did not match your choices. Refresh before retrying.');
  return saved;
}

export type RentPaymentChoice='full'|'monthly';
export type LongLetScheduledPayment={sequence:number;target_year:number;month_offset:number;due_before_handover:boolean;due_on:string|null;amount:number;partner_net_amount?:number;wehouse_amount?:number};
export type LongLetRentSchedule={term_months:number;payment_choice:RentPaymentChoice;annual_rent:number;first_year_rent:number;contract_total:number;due_before_handover:number;future_balance:number;payments:LongLetScheduledPayment[]};
export type LongLetAgreement={schema_version:1;reservation_id:string;listing_id:string;offer_revision:number;currency:string;quote_digest:string;rent_schedule:LongLetRentSchedule;accepted_at?:string;accepted_by?:string};
export type LongLetBookingOffer={reservation_id:string;listing_id:string;offer_revision:number;accepted_terms_months:number[];monthly_accepted:boolean;monthly_ready:boolean;agreement:LongLetAgreement|null;editable:boolean};
const object=(value:unknown):Record<string,unknown>=>{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Rental agreement could not be confirmed.');return value as Record<string,unknown>;};
function minor(value:unknown):bigint {
 if(!['number','string'].includes(typeof value))throw new Error('Rent amount could not be confirmed.');
 const match=/^(\d{1,10})(?:\.(\d{1,2}))?$/.exec(String(value));
 if(!match)throw new Error('Rent amount could not be confirmed.');
 return BigInt(match[1])*100n+BigInt((match[2]||'').padEnd(2,'0'));
}

/** Gross verified rent only: fees, pending charges and failed payments are not rent credit.
 * Round cumulative month boundaries up to the currency's smallest unit so a
 * rounded monthly price cannot over-credit occupancy or lose the final cent. */
export function rentCreditCoverage(annualRent:number|string, verifiedRentPaid:number|string) {
 const annual=minor(annualRent),paid=minor(verifiedRentPaid);
 if(annual<=0n||paid>annual)throw new Error('Rent credit must belong to one contract year.');
 const boundary=(months:bigint)=>(annual*months+11n)/12n;
 let months=0n;
 while(months<12n&&paid>=boundary(months+1n))months++;
 const partial=paid-boundary(months);
 return {completedMonths:Number(months),partialMonthCredit:Number(partial)/100,
  nextMonthBalance:months===12n?0:Number(boundary(months+1n)-paid)/100,
  remainingYearRent:Number(annual-paid)/100,grossRentPaid:Number(paid)/100};
}
export function longLetAgreementReceipt(value:unknown,reservationId:string,customerId?:string):LongLetAgreement {
 const row=object(value),schedule=object(row.rent_schedule);
 if(row.schema_version!==1||row.reservation_id!==reservationId||typeof row.listing_id!=='string'||!row.listing_id||
  !Number.isSafeInteger(row.offer_revision)||Number(row.offer_revision)<1||row.currency!=='NGN'||
  typeof row.quote_digest!=='string'||! /^[a-f0-9]{32}$/.test(row.quote_digest)||
  !LONG_LET_TERMS.some(term=>term===schedule.term_months)||!['full','monthly'].includes(String(schedule.payment_choice))||schedule.payment_choice==='monthly'&&Number(schedule.term_months)<=12||
  !Array.isArray(schedule.payments)||schedule.payments.length<1||schedule.payments.length>33)throw new Error('Rental agreement could not be confirmed. Refresh before continuing.');
 const payments=schedule.payments.map((value,index)=>{
  const p=object(value),amount=minor(p.amount);
  if(p.sequence!==index+1||!Number.isSafeInteger(p.target_year)||Number(p.target_year)<1||Number(p.target_year)>5||
   !Number.isSafeInteger(p.month_offset)||Number(p.month_offset)<0||Number(p.month_offset)>59||
   p.due_before_handover!==(index===0)||index===0&&p.month_offset!==0||
   p.due_on!==null||amount<=0n)throw new Error('The agreed payment schedule could not be confirmed.');
  if(p.partner_net_amount!==undefined||p.wehouse_amount!==undefined){
   if(minor(p.partner_net_amount)+minor(p.wehouse_amount)!==amount)throw new Error('Rent fee and Partner allocation do not match the agreed payment.');
   return {...p,amount:Number(p.amount),partner_net_amount:Number(p.partner_net_amount),wehouse_amount:Number(p.wehouse_amount)} as LongLetScheduledPayment;
  }
  return {...p,amount:Number(p.amount)} as LongLetScheduledPayment;
 });
 const total=minor(schedule.contract_total),first=minor(schedule.due_before_handover),balance=minor(schedule.future_balance);
 if(minor(schedule.annual_rent)<=0n||minor(schedule.first_year_rent)<=0n||total<=0n||first<=0n||
  payments.reduce((sum,p)=>sum+minor(p.amount),0n)!==total||minor(payments[0].amount)!==first||total-first!==balance||
  schedule.payment_choice==='full'&&(payments.length!==1||balance!==0n))throw new Error('Rent totals do not match the payment schedule.');
 if(schedule.payment_choice==='monthly'){
  const years=Number(schedule.term_months)/12,annual=minor(schedule.annual_rent);
  if(first!==minor(schedule.first_year_rent)||first>annual||total!==first+annual*BigInt(years-1)||
   payments[0].target_year!==1||payments.length!==1+8*(years-1))throw new Error('Year 1 must be paid in full before handover.');
  for(let year=2;year<=years;year++){
   const group=payments.slice(1+(year-2)*8,1+(year-1)*8);
   if(group.some((p,index)=>p.target_year!==year||p.month_offset!==12*(year-2)+4+index)||
    group.reduce((sum,p)=>sum+minor(p.amount),0n)!==annual)throw new Error('Later-year rent must follow the agreed eight-payment schedule.');
  }
 }
 if(customerId&&(row.accepted_by!==customerId||typeof row.accepted_at!=='string'||!Number.isFinite(Date.parse(row.accepted_at))))throw new Error('Your agreement acceptance could not be confirmed. Refresh before paying.');
 return {...row,rent_schedule:{...schedule,annual_rent:Number(schedule.annual_rent),first_year_rent:Number(schedule.first_year_rent),contract_total:Number(schedule.contract_total),due_before_handover:Number(schedule.due_before_handover),future_balance:Number(schedule.future_balance),payments}} as LongLetAgreement;
}
export async function getLongLetBookingOffer(reservationId:string,customerId:string):Promise<LongLetBookingOffer>{
 const row=object(await command('get_my_long_let_terms_offer',{p_reservation_id:reservationId}));
 if(row.reservation_id!==reservationId||typeof row.listing_id!=='string'||!row.listing_id||
  !Number.isSafeInteger(row.offer_revision)||Number(row.offer_revision)<1||
  !Array.isArray(row.accepted_terms_months)||row.accepted_terms_months.length<1||row.accepted_terms_months.length>7||
  row.accepted_terms_months.some(term=>!LONG_LET_TERMS.some(allowed=>term===allowed))||new Set(row.accepted_terms_months).size!==row.accepted_terms_months.length||
  typeof row.monthly_accepted!=='boolean'||typeof row.monthly_ready!=='boolean'||typeof row.editable!=='boolean')throw new Error('The offered rental terms could not be confirmed.');
 return {...row,agreement:row.agreement==null?null:longLetAgreementReceipt(row.agreement,reservationId,customerId)} as LongLetBookingOffer;
}
export async function previewLongLetAgreement(reservationId:string,months:number,choice:RentPaymentChoice){
 const quote=longLetAgreementReceipt(await command('preview_my_long_let_agreement',{p_reservation_id:reservationId,p_term_months:months,p_payment_choice:choice}),reservationId);
 if(quote.rent_schedule.term_months!==months||quote.rent_schedule.payment_choice!==choice)throw new Error('The quote does not match your selected agreement.');
 return quote;
}
export async function acceptLongLetAgreement(quote:LongLetAgreement,customerId:string){
 const saved=longLetAgreementReceipt(await command('accept_my_long_let_agreement',{p_reservation_id:quote.reservation_id,p_term_months:quote.rent_schedule.term_months,p_payment_choice:quote.rent_schedule.payment_choice,p_quote_digest:quote.quote_digest}),quote.reservation_id,customerId);
 if(saved.quote_digest!==quote.quote_digest||saved.rent_schedule.term_months!==quote.rent_schedule.term_months||saved.rent_schedule.payment_choice!==quote.rent_schedule.payment_choice)throw new Error('The accepted agreement differs from your review. Refresh before paying.');
 return saved;
}
