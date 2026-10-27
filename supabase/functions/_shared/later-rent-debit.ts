import {rentCheckoutSplit,recordRentChargeRoute} from './later-rent.ts';
type Db={rpc:(name:string,args:Record<string,unknown>)=>PromiseLike<{data:any;error:unknown}>};
async function rpc(db:Db,name:string,args:Record<string,unknown>={}){const r=await db.rpc(name,args);if(r.error)throw Error('Rent debit state could not be confirmed');return r.data;}
async function provider(path:string,secret:string,body?:unknown){const r=await fetch('https://api.paystack.co'+path,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${secret}`,'Content-Type':'application/json'},signal:AbortSignal.timeout(10000),...(body?{body:JSON.stringify(body)}:{})});const v=await r.json();if(!r.ok||v.status!==true||!v.data)throw Error('Provider result is unknown');return v.data;}
export function reusableRentCard(receipt:any,source:any,environment:string){
 const a=receipt?.authorization;
 if(receipt?.status!=='success'||receipt.reference!==source.source_reference||String(receipt.id)!==String(source.transaction_id)||receipt.amount!==source.amount_minor||receipt.currency!==source.currency||receipt.domain!==environment||a?.reusable!==true||a.channel!=='card'||!/^AUTH_[A-Za-z0-9]+$/.test(a.authorization_code)||!/^\d{4}$/.test(a.last4)||typeof receipt.customer?.email!=='string'||receipt.customer.email.length>320)throw Error('The rent payment does not provide an eligible reusable card. Continue with manual payment.');
 const year=Number(a.exp_year),month=Number(a.exp_month);if(!Number.isInteger(year)||year<2020||year>2200||!Number.isInteger(month)||month<1||month>12)throw Error('Card expiry could not be confirmed');
 const end=new Date(Date.UTC(year,month,0));if(end.getTime()<Date.now())throw Error('This card has expired. Continue with manual payment.');
 return{p_authorization:a.authorization_code,p_email:receipt.customer.email,p_last4:a.last4,p_card_type:String(a.card_type||'Card').slice(0,40),p_environment:environment,p_expires_on:end.toISOString().slice(0,10)};
}
function assertSplit(value:any,name:string,net:number,code:string,currency:string){
 if(value?.name!==name||value.type!=='flat'||value.currency!==currency||value.active!==true||value.bearer_type!=='account'||!/^SPL_[A-Za-z0-9]+$/.test(value.split_code)||!Array.isArray(value.subaccounts)||value.subaccounts.length!==1||value.subaccounts[0].subaccount?.subaccount_code!==code||value.subaccounts[0].share!==net)throw Error('Provider split no longer matches the accepted Partner share');return value.split_code;
}
/** One leased obligation. A lost charge response is verified, never charged twice. */
export async function runLaterRentDebit(db:Db,secret:string){
 const p=await rpc(db,'claim_due_later_rent_debit');if(!p)return{status:'idle'};
 const args={p_consent_id:p.consent_id,p_payment_id:p.payment_id};let splitPage=Number(p.split_lookup_page)||1;
 try{
  const environment=secret.startsWith('sk_test_')?'test':secret.startsWith('sk_live_')?'live':null;
  if(!environment||p.environment!==environment)throw Error('Provider environment mismatch');
  if(!p.attempted){
   if(p.status!=='active')throw Error('Automatic debit is disabled');
   const split=rentCheckoutSplit(p.route,p.amount_minor,environment),name='WeHouse rent '+p.reference;
   let code=p.split_code;
   if(!code){
    const create=await rpc(db,'start_later_rent_debit_split',args);let found:any;
    if(create)found=await provider('/split',secret,{name,currency:p.currency,...split});
    else{
     const list=await provider(`/split?perPage=50&page=${splitPage}`,secret);if(!Array.isArray(list)||list.length>50)throw Error('Provider split page unavailable');
     const matches=list.filter(s=>s.name===name);if(matches.length!==1){if(matches.length===0&&list.length===50)splitPage++;else splitPage=1;throw Error('Split creation is still being reconciled');}found=matches[0];
    }
    code=assertSplit(found,name,p.route.partner_amount_minor,p.route.subaccount_code,p.currency);
    if(await rpc(db,'save_later_rent_debit_split',{...args,p_split_code:code})!==true)throw Error('Split was not saved');
   }
   const saved=await provider('/split/'+encodeURIComponent(code),secret);assertSplit(saved,name,p.route.partner_amount_minor,p.route.subaccount_code,p.currency);
   if(await rpc(db,'authorize_later_rent_debit_dispatch',args)!==true)throw Error('Automatic debit was stopped or already sent');
   // The dispatch grant is consumed before this HTTP request. An unknown result
   // can only reach the read-only verification branch on the next job.
   try{await provider('/transaction/charge_authorization',secret,{authorization_code:p.authorization_code,email:p.email,amount:String(p.amount_minor),currency:p.currency,reference:p.reference,split_code:code,queue:true,metadata:JSON.stringify({purpose:'rent_plan_contribution',payment_id:p.payment_id})});}catch{/* Verify the existing reference. Never resubmit this charge. */}
  }
  const receipt=await provider('/transaction/verify/'+encodeURIComponent(p.reference),secret);
  if(receipt.reference!==p.reference||receipt.domain!==environment||receipt.currency!==p.currency||receipt.amount!==p.amount_minor)throw Error('Provider payment identity mismatch');
  if(receipt.status==='failed'){await rpc(db,'finish_later_rent_debit_check',{...args,p_status:'failed'});return{status:'needs_action'};}
  if(receipt.status!=='success')throw Error('Payment still pending');
  await recordRentChargeRoute(db,p.reference,receipt);
  const bytes=new TextEncoder().encode(JSON.stringify(receipt));const checksum=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(n=>n.toString(16).padStart(2,'0')).join('');
  const result=await rpc(db,'process_verified_paystack_charge',{p_provider_event_key:'charge.success:'+receipt.id,p_event_type:'charge.success',p_provider_reference:p.reference,p_payload_sha256:checksum,p_signature_verified_at:new Date().toISOString(),p_amount_minor:receipt.amount,p_currency:receipt.currency,p_transaction_id:String(receipt.id)});
  if(result?.success!==true)throw Error('The charge needs payment reconciliation');
  await rpc(db,'finish_later_rent_debit_check',{...args,p_status:'confirmed'});return{status:'confirmed'};
 }catch{
  await rpc(db,'finish_later_rent_debit_check',{...args,p_status:'pending',p_split_page:splitPage});return{status:'pending'};
 }
}
