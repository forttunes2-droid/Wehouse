import {rentChargeRouteProof} from './later-rent.ts';
type Db={rpc:(name:string,args:Record<string,unknown>)=>PromiseLike<{data:any;error:unknown}>};
const digest=async(value:unknown)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))).map(x=>x.toString(16).padStart(2,'0')).join('');
async function provider(path:string,secret:string){const r=await fetch('https://api.paystack.co'+path,{headers:{Authorization:`Bearer ${secret}`},signal:AbortSignal.timeout(10000)});const body=await r.json();if(!r.ok||body.status!==true||!Array.isArray(body.data))throw Error('Provider settlement lookup unavailable');return body;}
/** Bounded, leased read-only provider reconciliation. Never starts a transfer. */
export async function reconcileLaterRentSettlements(db:Db,secret:string){
 const {data:payments,error}=await db.rpc('claim_due_rent_settlement_checks',{p_limit:2});
 if(error||!Array.isArray(payments))throw Error('Rent settlement queue unavailable');
 const outcomes=[];
 for(const p of payments){let next=Number(p.page)||1;let txPage=Number(p.transaction_page)||1;let settled=false;
  try{
   const environment=secret.startsWith('sk_live_')?'live':secret.startsWith('sk_test_')?'test':null;
   const route=p.route;if(!route||route.environment!==environment||!/^[0-9]+$/.test(route.subaccount_provider_id)||!Number.isSafeInteger(Number(route.partner_amount_minor)))throw Error('Payment provider environment or Partner route needs review');
   const netMinor=Number(route.partner_amount_minor);
   const from=new Date(p.created_at||p.paid_at);if(!Number.isFinite(from.getTime()))throw Error('Payment start time is unavailable');from.setUTCDate(from.getUTCDate()-2);
   const page=await provider(`/settlement?subaccount=${encodeURIComponent(route.subaccount_provider_id)}&status=success&perPage=1&page=${next}&from=${encodeURIComponent(from.toISOString())}`,secret);
   if(page.data.length>1)throw Error('Provider ignored the settlement page limit');
   for(const batch of page.data){
    if(batch.status!=='success'||batch.currency!==p.currency||batch.domain!==environment||!Number.isSafeInteger(Number(batch.id))||Number(batch.id)<1)continue;
    const txs=await provider(`/settlement/${batch.id}/transactions?perPage=25&page=${txPage}`,secret);
    if(txs.data.length>25)throw Error('Provider ignored transaction pagination');
    const tx=txs.data.find((tx:any)=>tx.reference===p.reference&&String(tx.id)===p.transaction_id&&tx.status==='success'&&tx.currency===p.currency&&tx.domain===environment);
    if(!tx){if(txs.data.length===25){txPage++;}else{txPage=1;next++;}continue;}
    const proof=rentChargeRouteProof(tx);
    // Prior signed/API charge proof is canonical when the settlement response
    // omits split details; the provider's batch membership confirms settlement.
    if(proof.p_partner_minor!==null&&proof.p_partner_minor!==netMinor)throw Error('Provider settlement share differs from the accepted rent');
    const {data:receipt,error}=await db.rpc('record_verified_rent_settlement',{p_payment_id:p.payment_id,p_settlement_id:String(batch.id),p_transaction_id:p.transaction_id,
     p_subaccount_id:route.subaccount_provider_id,p_net_minor:netMinor,p_currency:p.currency,p_environment:environment,
     p_payload_sha256:await digest({settlement_id:batch.id,reference:p.reference,transaction_id:tx.id,subaccount_id:route.subaccount_provider_id,net_minor:netMinor,status:batch.status})});
    if(error||receipt?.success!==true)throw Error('Settlement receipt could not be saved');settled=true;break;
   }
   if(!settled&&page.data.length===0){next=1;txPage=1;}
   outcomes.push({payment_id:p.payment_id,status:settled?'settled':'pending'});
  }catch{outcomes.push({payment_id:p.payment_id,status:'pending'});}
  if(!settled){const {error}=await db.rpc('finish_rent_settlement_check',{p_payment_id:p.payment_id,p_next_page:next,p_transaction_page:txPage,p_error:'Provider settlement not yet confirmed. No transfer was initiated.'});if(error)throw Error('Settlement check lease could not be completed');}
 }
 return outcomes;
}
