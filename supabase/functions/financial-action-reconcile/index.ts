import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.106.1';
import { consumeUserAction } from '../_shared/rateLimit.ts';
import { verifyRefundLookup } from '../_shared/refund-reconciliation.ts';

const headers={'Content-Type':'application/json','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS'};
const json=(body:Record<string,unknown>,status=200)=>new Response(JSON.stringify(body),{status,headers});
Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers});
  if(req.method!=='POST')return json({success:false,error:'Method not allowed'},405);
  const token=req.headers.get('authorization')?.replace(/^Bearer\s+/i,'')||'';
  if(!token)return json({success:false,error:'Sign in required'},401);
  try{
    const url=Deno.env.get('SUPABASE_URL'),anon=Deno.env.get('SUPABASE_ANON_KEY'),service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),secret=Deno.env.get('PAYSTACK_SECRET_KEY');
    if(!url||!anon||!service)return json({success:false,error:'Refund verification is not configured'},503);
    const caller=createClient(url,anon,{global:{headers:{Authorization:`Bearer ${token}`}},auth:{persistSession:false,autoRefreshToken:false}});
    const {data:{user},error:authError}=await caller.auth.getUser(token);
    if(authError||!user)return json({success:false,error:'Sign in required'},401);
    const body=await req.json();const id=String(body?.financial_action_id||'');
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))return json({success:false,error:'Valid financial action required'},400);
    const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
    const limit=await consumeUserAction(admin,user.id,'refund_reconcile',10,600,true);
    if(!limit.allowed)return json({success:false,error:'Refund verification is temporarily limited. Please try again.',retry_after_seconds:limit.retryAfterSeconds},429);
    const {data:snapshot,error:snapshotError}=await caller.rpc('get_my_financial_action_reconciliation',{p_financial_action_id:id});
    if(snapshotError||snapshot?.financial_action_id!==id)return json({success:false,error:'Refund reconciliation unavailable for this account'},403);
    const refundId=String(snapshot.provider_action_id||body?.provider_refund_id||'').trim();
    if(!secret)return json({success:false,error:'Refund verification is not configured'},503);
    const proof=await verifyRefundLookup(snapshot,refundId,secret);
    const {data:receipt,error}=await admin.rpc('process_verified_paystack_refund_lookup',{
      p_financial_action_id:id,p_provider_refund_id:proof.providerId,p_provider_status:proof.status,
      p_original_reference:snapshot.paystack_reference,p_payload_sha256:proof.checksum,
      p_verified_at:new Date().toISOString(),p_amount_minor:proof.amountMinor,p_currency:proof.currency,
    });
    if(error||receipt?.success!==true||receipt.financial_action_id!==id||!['provider_pending','provider_attention','manual_review','completed'].includes(receipt.status))
      return json({success:false,error:'Reconciliation could not be confirmed. Refresh the action before retrying.'},409);
    return json({success:true,financial_action_id:id,status:receipt.status,provider_status:proof.status});
  }catch{return json({success:false,error:'Provider refund could not be verified. The action remains unresolved; no new refund was submitted.'},502);}
});
