import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { verifyRefundLookup, verifyRefundPayment } from '../_shared/refund-reconciliation.ts';
import {reconcileLaterRentSettlements} from '../_shared/later-rent-settlement.ts';

const jsonHeaders={'Content-Type':'application/json'};
const json=(body:Record<string,unknown>,status=200)=>new Response(
  JSON.stringify(body),{status,headers:jsonHeaders}
);

async function sha256Hex(value:string){
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte)=>byte.toString(16).padStart(2,'0')).join('');
}

async function sameSecret(left:string,right:string){
  if(!left||!right)return false;
  const[a,b]=await Promise.all([sha256Hex(left),sha256Hex(right)]);
  let mismatch=0;for(let index=0;index<a.length;index++)mismatch|=a.charCodeAt(index)^b.charCodeAt(index);
  return mismatch===0;
}

Deno.serve(async(req)=>{
  if(req.method!=='POST')return json({success:false,error:'Method not allowed'},405);
  const supplied=req.headers.get('x-wehouse-cron-secret')||'';
  const expected=Deno.env.get('WEHOUSE_CRON_SECRET')||'';
  if(!(await sameSecret(supplied,expected)))return json({success:false,error:'Unauthorized'},401);
  const url=Deno.env.get('SUPABASE_URL');
  const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const paystackSecret=Deno.env.get('PAYSTACK_SECRET_KEY');
  if(!url||!serviceKey||!paystackSecret)return json({success:false,error:'Processor configuration is incomplete'},503);
  const db=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
  // A provider delay in direct rent must not block unrelated refunds/releases.
  try{await reconcileLaterRentSettlements(db,paystackSecret);}catch{console.error('[financial-action-processor] rent settlement queue needs attention');}
  const workerId=`financial-action-processor:${crypto.randomUUID()}`;
  const{data:recovered,error:recoveryError}=await db.rpc('recover_stale_financial_actions',{p_limit:100});
  if(recoveryError)return json({success:false,error:'Could not recover interrupted financial actions'},500);
  const{data:expiredShared,error:sharedSweepError}=await db.rpc('sweep_expired_shared_payment_checkouts',{p_limit:100});
  if(sharedSweepError)return json({success:false,error:'Could not reconcile expired shared checkouts'},500);
  const{data:prepared,error:prepareError}=await db.rpc('enqueue_due_canonical_financial_actions',{p_limit:100});
  if(prepareError)return json({success:false,error:'Could not prepare due financial actions'},500);
  const{data:dueRefunds,error:reconcileClaimError}=await db.rpc('claim_due_refund_reconciliations',{p_limit:2});
  if(reconcileClaimError)return json({success:false,error:'Could not claim provider refund checks'},500);
  const reconciliationOutcomes:Array<Record<string,unknown>>=[];
  for(const refund of dueRefunds||[]){
    try{
      const proof=await verifyRefundLookup(refund,String(refund.provider_action_id),paystackSecret);
      const{data:receipt,error}=await db.rpc('process_verified_paystack_refund_lookup',{
        p_financial_action_id:refund.financial_action_id,p_provider_refund_id:proof.providerId,
        p_provider_status:proof.status,p_original_reference:refund.paystack_reference,
        p_payload_sha256:proof.checksum,p_verified_at:new Date().toISOString(),
        p_amount_minor:proof.amountMinor,p_currency:proof.currency,
      });
      if(error||receipt?.success!==true||receipt.financial_action_id!==refund.financial_action_id)throw new Error('Refund receipt did not match');
      reconciliationOutcomes.push({id:refund.financial_action_id,type:'refund_reconciliation',success:true,status:receipt.status});
    }catch{
      await db.rpc('record_refund_reconciliation_failure',{p_financial_action_id:refund.financial_action_id});
      reconciliationOutcomes.push({id:refund.financial_action_id,type:'refund_reconciliation',success:false,manual_review:true});
    }
  }
  // Bound the sequential provider batch. Never automatically resubmit an uncertain refund.
  const{data:actions,error:claimError}=await db.rpc('claim_financial_actions',{p_worker_id:workerId,p_limit:3});
  if(claimError)return json({success:false,error:'Could not claim financial actions'},500);
  const outcomes:Array<Record<string,unknown>>=[...reconciliationOutcomes];
  for(const action of actions||[]){
    if(String(action.action_type).startsWith('release_')){
      const{data,error}=await db.rpc('complete_internal_release_action',{p_financial_action_id:action.financial_action_id});
      outcomes.push({id:action.financial_action_id,type:action.action_type,success:!error&&data?.success===true});
      if(error||data?.success!==true)await db.rpc('mark_financial_action_manual_review',{p_financial_action_id:action.financial_action_id,p_reason:'Internal release failed validation or returned no completion receipt'});
      continue;
    }
    if(!String(action.action_type).startsWith('refund_')||!action.paystack_reference){
      await db.rpc('mark_financial_action_manual_review',{p_financial_action_id:action.financial_action_id,p_reason:'Refund action is missing its original Paystack reference'});
      outcomes.push({id:action.financial_action_id,type:action.action_type,success:false,manual_review:true});
      continue;
    }
    try{
      const {amount:amountKobo}=await verifyRefundPayment(action,paystackSecret);
      const deadline=AbortSignal.timeout(12000);
      const response=await fetch('https://api.paystack.co/refund',{
        method:'POST',
        signal:deadline,
        headers:{Authorization:`Bearer ${paystackSecret}`,'Content-Type':'application/json'},
        body:JSON.stringify({
          transaction:action.paystack_reference,
          amount:amountKobo,
          currency:'NGN',
          customer_note:'WeHouse original-payment refund',
          merchant_note:`WeHouse ${action.idempotency_key}`,
        }),
      });
      const raw=await response.text();
      const checksum=await sha256Hex(raw);
      let result:any=null;try{result=JSON.parse(raw)}catch{result=null}
      const providerStatus=String(result?.data?.status||'');
      const providerId=String(result?.data?.id||'');
      if(!response.ok||result?.status!==true||!providerId||!['pending','processing','needs-attention'].includes(providerStatus)){
        await db.rpc('mark_financial_action_manual_review',{p_financial_action_id:action.financial_action_id,p_reason:'Paystack refund submission did not return a safely reconcilable queued status'});
        outcomes.push({id:action.financial_action_id,type:action.action_type,success:false,manual_review:true});
        continue;
      }
      const{data:receipt,error}=await db.rpc('record_refund_provider_submission',{
        p_financial_action_id:action.financial_action_id,
        p_provider_action_id:providerId,
        p_provider_status:providerStatus,
        p_response_checksum:checksum,
      });
      if(error||receipt?.financial_action_id!==action.financial_action_id||receipt?.provider_action_id!==providerId||!['provider_pending','provider_attention','completed'].includes(receipt?.status)){
        await db.rpc('mark_financial_action_manual_review',{p_financial_action_id:action.financial_action_id,p_reason:'Refund was queued but its provider receipt needs Finance reconciliation'});
        outcomes.push({id:action.financial_action_id,type:action.action_type,success:false,manual_review:true});
      }else outcomes.push({id:action.financial_action_id,type:action.action_type,success:true,provider_pending:receipt.status!=='completed'});
    }catch{
      await db.rpc('mark_financial_action_manual_review',{p_financial_action_id:action.financial_action_id,p_reason:'Refund provider outcome is uncertain; do not retry automatically'});
      outcomes.push({id:action.financial_action_id,type:action.action_type,success:false,manual_review:true});
    }
  }
  return json({success:outcomes.every(outcome=>outcome.success===true),recovered_for_review:recovered,expired_shared_checkouts:expiredShared,prepared,claimed:(actions||[]).length,outcomes});
});

