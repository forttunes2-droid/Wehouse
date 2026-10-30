import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.106.1';
import {consumeUserAction} from '../_shared/rateLimit.ts';
import {resolvePaymentReturnUrl} from '../_shared/payment-return.ts';
import {reusableRentCard} from '../_shared/later-rent-debit.ts';
const headers={'Content-Type':'application/json','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,x-client-info,content-type','Access-Control-Allow-Methods':'POST,OPTIONS','Cache-Control':'no-store'};
const json=(body:Record<string,unknown>,status=200)=>new Response(JSON.stringify(body),{status,headers});
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers});if(req.method!=='POST')return json({error:'Method not allowed'},405);
 try{
  const url=Deno.env.get('SUPABASE_URL'),anon=Deno.env.get('SUPABASE_ANON_KEY'),service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),secret=Deno.env.get('PAYSTACK_SECRET_KEY');
  const token=req.headers.get('authorization');if(!token)return json({error:'Sign in required'},401);
  if(!url||!anon||!service||!secret||!resolvePaymentReturnUrl(url,Deno.env.get('APP_URL'),secret,'payment-return'))return json({error:'Automatic payment provider is unavailable. Manual payment remains available.'},503);
  const caller=createClient(url,anon,{global:{headers:{Authorization:token}},auth:{persistSession:false,autoRefreshToken:false}});
  const{data:{user},error}=await caller.auth.getUser();if(error||!user)return json({error:'Sign in required'},401);
  const db=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
  if(secret.startsWith('sk_live_')){const approved=await db.rpc('_legal_launch_gate_is_approved',{p_gate_key:'payments_protection_payouts'});if(approved.error||approved.data!==true)return json({error:'Automatic rent awaits the marketplace payment approval.'},503);}
  if(!(await consumeUserAction(db,user.id,'rent_automatic_payment',5,3600,true)).allowed)return json({error:'Please wait before checking automatic payment again.'},429);
  const body=await req.json();if(body.accept!==true||typeof body.reservation_id!=='string'||typeof body.agreement_digest!=='string')return json({error:'Explicit automatic-payment consent required'},400);
  const{data:source,error:sourceError}=await caller.rpc('prepare_my_later_rent_debit',{p_reservation_id:body.reservation_id,p_agreement_digest:body.agreement_digest,p_accept:true});
  if(sourceError||!source?.consent_id)return json({error:'Automatic payment consent could not be confirmed. Refresh the booking.'},409);
  if(source.already_active)return json({success:true,already_active:true});
  const response=await fetch('https://api.paystack.co/transaction/verify/'+encodeURIComponent(source.source_reference),{headers:{Authorization:'Bearer '+secret},signal:AbortSignal.timeout(12000)});
  const verified=await response.json();if(!response.ok||verified.status!==true)throw Error('Provider payment lookup unavailable');
  const card=reusableRentCard(verified.data,source,secret.startsWith('sk_test_')?'test':'live');
  const{data:saved,error:saveError}=await db.rpc('bind_verified_later_rent_debit',{p_consent_id:source.consent_id,p_reference:source.source_reference,...card});
  if(saveError||saved?.success!==true)return json({error:'Automatic payment setup result is uncertain. Refresh before retrying.'},409);
  return json({success:true});
 }catch{return json({error:'A reusable card could not be confirmed. Refresh automatic payment status; you can continue paying manually.'},503);}
});
