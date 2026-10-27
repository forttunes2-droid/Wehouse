// Only authenticated provider shares prove the direct route; browser metadata
// and a successful charge alone never prove Partner settlement.
type Row=Record<string,unknown>;
const row=(value:unknown):Row=>value&&typeof value==='object'&&!Array.isArray(value)?value as Row:{};
export function rentCheckoutSplit(value:unknown,amountMinor:number,environment:string){
 const r=row(value),net=Number(r.partner_amount_minor),fee=Number(r.platform_amount_minor);
 if(r.version!==1||r.environment!==environment||typeof r.amount_minor!=='number'||r.amount_minor!==amountMinor||typeof r.partner_amount_minor!=='number'||typeof r.platform_amount_minor!=='number'||
  !Number.isSafeInteger(net)||net<=0||!Number.isSafeInteger(fee)||fee<0||net+fee!==amountMinor||
  typeof r.subaccount_code!=='string'||!/^ACCT_[A-Za-z0-9]+$/.test(r.subaccount_code))throw Error('Verified Partner settlement route is unavailable.');
 return{type:'flat',bearer_type:'account',subaccounts:[{subaccount:r.subaccount_code,share:net}]};
}
export function rentChargeRouteProof(value:unknown){
 const receipt=row(value),shares=row(row(receipt.split).shares);
 const entries=Array.isArray(shares.subaccounts)?shares.subaccounts:[];
 const share=entries.length===1?row(entries[0]):{};
 return{p_transaction_id:String(receipt.id??''),p_amount_minor:Number.isSafeInteger(receipt.amount)?receipt.amount:null,
  p_currency:typeof receipt.currency==='string'?receipt.currency:null,
  p_environment:['test','live'].includes(String(receipt.domain))?String(receipt.domain):null,
  p_subaccount_code:typeof share.subaccount_code==='string'?share.subaccount_code:null,
  p_subaccount_id:share.id==null?null:String(share.id),
  p_partner_minor:Number.isSafeInteger(share.amount)&&Number(share.amount)>0?share.amount:null};
}
export async function recordRentChargeRoute(db:{rpc:(name:string,args:Record<string,unknown>)=>PromiseLike<{error:unknown}>},reference:string,receipt:unknown){
 const {error}=await db.rpc('record_verified_rent_route',{p_reference:reference,...rentChargeRouteProof(receipt)});
 if(error)throw Error('Verified rent settlement route could not be recorded.');
}
