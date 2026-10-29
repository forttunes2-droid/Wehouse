import {supabase} from './supabase/client';
import {withTimeout} from './withTimeout';
import {initializePaymentReference} from './supabase/housing-payments';
import {rentCreditCoverage} from './longLetRentTerms';
export type RentHistoryItem={contribution_id:string;agreement_sequence:number;target_year:number;due_date:string|null;amount:number;paystack_reference:string|null;payment_status:string;settlement_status:string;amount_commission:number|null;net_amount:number|null;paid_at:string|null;can_pay:boolean};
export type RentCreditYear={target_year:number;annual_rent:number;gross_rent_paid:number;completed_months:number;partial_month_credit:number;next_month_balance:number;remaining_year_rent:number};
export type LaterRentHistory={reservation_id:string;plan_id:string;viewer:'customer'|'partner';currency:string;agreement_digest:string;plan_status:string;collection_available:boolean;settlement_consent:{accepted_by:string;accepted_at:string;agreement_digest:string;payment_protection_hold:false;gross_rent_credit:true}|null;years:RentCreditYear[];items:RentHistoryItem[];has_more:boolean;next_sequence:number|null};
const uuid=(v:unknown)=>typeof v==='string'&&/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(v);
const money=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&Number.isSafeInteger(Math.round(v*100))&&Math.abs(v*100-Math.round(v*100))<0.0001;
function consent(value:unknown,digest:string){const c=value as NonNullable<LaterRentHistory['settlement_consent']>;if(!c||c.agreement_digest!==digest||typeof c.accepted_by!=='string'||!c.accepted_by||!Number.isFinite(Date.parse(c.accepted_at))||c.payment_protection_hold!==false||c.gross_rent_credit!==true)throw Error('Your rent settlement acceptance could not be confirmed.');return c;}
export function rentHistoryReceipt(value:unknown,id:string,after=0):LaterRentHistory{
 const r=value as LaterRentHistory;
 if(!r||r.reservation_id!==id||!uuid(r.plan_id)||!['customer','partner'].includes(r.viewer)||r.currency!=='NGN'||! /^[a-f\d]{32}$/.test(r.agreement_digest)||
  typeof r.collection_available!=='boolean'||!Array.isArray(r.items)||r.items.length>32||!Array.isArray(r.years)||r.years.length>4||typeof r.has_more!=='boolean'||(r.has_more? !Number.isSafeInteger(r.next_sequence)||Number(r.next_sequence)<=after:r.next_sequence!==null))throw Error('Rent history could not be confirmed. Refresh before paying.');
 let previous=after;
 for(const p of r.items){if(!uuid(p.contribution_id)||!Number.isSafeInteger(p.agreement_sequence)||p.agreement_sequence<=previous||!Number.isInteger(p.target_year)||p.target_year<2||p.target_year>5||!money(p.amount)||p.amount<=0||typeof p.can_pay!=='boolean'||!['paid','scheduled','pending','payment_pending','review_required'].includes(p.payment_status)||!['not_started','pending','checking','settled'].includes(p.settlement_status)||p.due_date!==null&&!/^\d{4}-\d{2}-\d{2}$/.test(p.due_date))throw Error('A rent payment record could not be confirmed.');previous=p.agreement_sequence;}
 if(r.has_more&&r.next_sequence!==previous)throw Error('Rent history cursor could not be confirmed.');
 for(const p of r.items)if(p.payment_status==='paid'&&(!money(p.amount_commission)||!money(p.net_amount)||Math.round(Number(p.amount_commission)*100)+Math.round(Number(p.net_amount)*100)!==Math.round(p.amount*100)))throw Error('Rent fee and Partner share do not reconcile.');
 for(const y of r.years){if(!Number.isInteger(y.target_year)||y.target_year<2||y.target_year>5||!money(y.annual_rent)||!money(y.gross_rent_paid))throw Error('Rent credit could not be confirmed.');const c=rentCreditCoverage(y.annual_rent,y.gross_rent_paid);if(c.completedMonths!==y.completed_months||c.partialMonthCredit!==y.partial_month_credit||c.nextMonthBalance!==y.next_month_balance||c.remainingYearRent!==y.remaining_year_rent)throw Error('Rent credit does not match verified payments.');}
 if(new Set(r.years.map(y=>y.target_year)).size!==r.years.length)throw Error('Rent years could not be confirmed.');
 if(r.settlement_consent!==null)consent(r.settlement_consent,r.agreement_digest);
 return r;
}
async function rpc(name:string,args:Record<string,unknown>){const{data,error}=await withTimeout(supabase.rpc(name,args),15000,'Rent confirmation took too long. Refresh before retrying.');if(error)throw error;return data;}
export async function getLaterRentHistory(id:string,after=0){return rentHistoryReceipt(await rpc('get_my_later_rent_history',{p_reservation_id:id,p_after_sequence:after,p_limit:16}),id,after);}
export async function acceptLaterRentSettlement(history:LaterRentHistory,userId:string){const c=consent(await rpc('accept_my_later_rent_settlement',{p_reservation_id:history.reservation_id,p_agreement_digest:history.agreement_digest}),history.agreement_digest);if(c.accepted_by!==userId)throw Error('Rent acceptance belongs to another account.');return c;}
export async function initializeLaterRentPayment(item:RentHistoryItem){
 const receipt=await rpc('create_rent_plan_contribution_payment',{p_contribution_id:item.contribution_id});
 if(receipt?.success!==true)throw Error('Rent checkout could not be confirmed.');
 if(receipt.already_paid===true)return{alreadyPaid:true};
 if(typeof receipt.reference!=='string'||!/^WHNEXT-[A-F\d]{32}$/.test(receipt.reference)||receipt.amount!==item.amount||receipt.currency!=='NGN')throw Error('Rent checkout does not match your scheduled payment.');
 const {result,error}=await withTimeout(initializePaymentReference(receipt.reference,'rent_plan_contribution'),25000,'Checkout result is unknown. Refresh before retrying.');
 if(error||result?.success!==true||result.reference!==receipt.reference)throw Error(result?.error||'Rent checkout could not be confirmed. Refresh before retrying.');
 if(result.already_paid)return{alreadyPaid:true};
 const url=new URL(String(result.authorization_url||''));if(url.protocol!=='https:'||url.hostname!=='checkout.paystack.com')throw Error('Payment destination could not be confirmed.');
 return{alreadyPaid:false,url:url.href};
}
