import {supabase} from './supabase/client';
import {withTimeout} from './withTimeout';
import {LONG_LET_TERMS,longLetAgreementReceipt,type LongLetAgreement,type RentPaymentChoice} from './longLetRentTerms';

export type SharedRentAgreement=LongLetAgreement&{payer_user_id:string;parent_agreement_digest:string};
export type SharedRentOffer={group_id:string;reservation_id:string;checkout_attempt:number;accepted_terms_months:number[];monthly_accepted:boolean;monthly_ready:boolean;editable:boolean;agreement:SharedRentAgreement|null;tenancy_agreement:LongLetAgreement|null};
export type SharedRentQuote={group_id:string;checkout_attempt:number;agreement:LongLetAgreement;payer_agreements:SharedRentAgreement[]};
const record=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=='object'||Array.isArray(v))throw Error('Shared rental terms could not be confirmed.');return v as Record<string,unknown>;};
const digest=(v:unknown)=>typeof v==='string'&&/^[a-f\d]{32}$/.test(v);
export function sharedRentAgreementReceipt(value:unknown,reservationId:string,userId?:string):SharedRentAgreement{
 const row=longLetAgreementReceipt(value,reservationId) as SharedRentAgreement;
 if(typeof row.payer_user_id!=='string'||!row.payer_user_id||!digest(row.parent_agreement_digest)
  ||userId&&row.payer_user_id!==userId||row.rent_schedule.payments.some(p=>typeof p.partner_net_amount!=='number'||typeof p.wehouse_amount!=='number')
  ||row.accepted_by!==undefined&&(row.accepted_by!==row.payer_user_id||!Number.isFinite(Date.parse(row.accepted_at||''))))throw Error('Your rent share belongs to a different accepted agreement.');
 return row;
}
async function rpc(name:string,args:Record<string,unknown>){const{data,error}=await withTimeout(supabase.rpc(name,args),15000,'Rental agreement confirmation took too long. Refresh before retrying.');if(error)throw error;return data;}
export async function getSharedRentOffer(groupId:string,userId:string):Promise<SharedRentOffer>{
 const row=record(await rpc('get_my_shared_long_let_terms',{p_group_id:groupId}));
 if(row.group_id!==groupId||typeof row.reservation_id!=='string'||!row.reservation_id||!Number.isSafeInteger(row.checkout_attempt)||Number(row.checkout_attempt)<1
  ||!Array.isArray(row.accepted_terms_months)||row.accepted_terms_months.length<1||row.accepted_terms_months.length>7
  ||row.accepted_terms_months.some(term=>!LONG_LET_TERMS.some(allowed=>allowed===term))||new Set(row.accepted_terms_months).size!==row.accepted_terms_months.length
  ||typeof row.monthly_accepted!=='boolean'||typeof row.monthly_ready!=='boolean'||typeof row.editable!=='boolean')throw Error('The shared rental offer could not be confirmed.');
 return {...row,agreement:row.agreement==null?null:sharedRentAgreementReceipt(row.agreement,row.reservation_id,userId),
  tenancy_agreement:row.tenancy_agreement==null?null:longLetAgreementReceipt(row.tenancy_agreement,row.reservation_id)} as SharedRentOffer;
}
export function sharedRentQuoteReceipt(value:unknown,groupId:string,reservationId:string):SharedRentQuote{
 const row=record(value),agreement=longLetAgreementReceipt(row.agreement,reservationId);
 if(row.group_id!==groupId||!Number.isSafeInteger(row.checkout_attempt)||Number(row.checkout_attempt)<1
  ||!Array.isArray(row.payer_agreements)||row.payer_agreements.length<2||row.payer_agreements.length>3)throw Error('Shared rental quote could not be confirmed.');
 const people=row.payer_agreements.map(value=>sharedRentAgreementReceipt(value,reservationId));
 if(new Set(people.map(p=>p.payer_user_id)).size!==people.length||people.some(p=>p.parent_agreement_digest!==agreement.quote_digest
  ||p.rent_schedule.term_months!==agreement.rent_schedule.term_months||p.rent_schedule.payment_choice!==agreement.rent_schedule.payment_choice
  ||p.rent_schedule.payments.length!==agreement.rent_schedule.payments.length))throw Error('The participant shares do not belong to one rental agreement.');
 for(let i=0;i<agreement.rent_schedule.payments.length;i++){
  if(people.reduce((sum,p)=>sum+Math.round(p.rent_schedule.payments[i].amount*100),0)!==Math.round(agreement.rent_schedule.payments[i].amount*100))throw Error('The rent shares do not add up to the agreed payment.');
  for(const field of ['partner_net_amount','wehouse_amount'] as const)if(typeof agreement.rent_schedule.payments[i][field]!=='number'||people.reduce((sum,p)=>sum+Math.round(p.rent_schedule.payments[i][field]!*100),0)!==Math.round(agreement.rent_schedule.payments[i][field]!*100))throw Error('The shared rent fee and Partner allocations do not add up.');
 }
 return {...row,agreement,payer_agreements:people} as SharedRentQuote;
}
export async function previewSharedRent(offer:SharedRentOffer,months:number,choice:RentPaymentChoice){
 const quote=sharedRentQuoteReceipt(await rpc('preview_my_shared_long_let_agreement',{p_group_id:offer.group_id,p_term_months:months,p_payment_choice:choice}),offer.group_id,offer.reservation_id);
 if(quote.checkout_attempt!==offer.checkout_attempt||quote.agreement.rent_schedule.term_months!==months||quote.agreement.rent_schedule.payment_choice!==choice)throw Error('The shared rental agreement changed. Refresh before accepting.');
 return quote;
}
export async function startSharedRent(quote:SharedRentQuote,userId:string){
 const saved=record(await rpc('start_my_shared_contract_split',{p_group_id:quote.group_id,p_term_months:quote.agreement.rent_schedule.term_months,
  p_payment_choice:quote.agreement.rent_schedule.payment_choice,p_quote_digest:quote.agreement.quote_digest}));
 const mine=quote.payer_agreements.find(p=>p.payer_user_id===userId);
 const accepted=sharedRentAgreementReceipt(saved.rent_agreement,quote.agreement.reservation_id,userId);
 if(saved.id!==quote.group_id||saved.payment_phase!=='contract_rent'||saved.checkout_attempt!==quote.checkout_attempt+1
  ||!mine||accepted.quote_digest!==mine.quote_digest||accepted.accepted_by!==userId||!Number.isFinite(Date.parse(accepted.accepted_at||'')))throw Error('The shared rent agreement could not be confirmed. Refresh before paying.');
 return saved;
}
