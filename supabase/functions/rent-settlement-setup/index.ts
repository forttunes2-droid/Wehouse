import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.106.1';
import {consumeUserAction} from '../_shared/rateLimit.ts';
import {resolvePaymentReturnUrl} from '../_shared/payment-return.ts';
const headers={'Content-Type':'application/json','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Cache-Control':'no-store'};
const json=(body:Record<string,unknown>,status=200)=>new Response(JSON.stringify(body),{status,headers});
const normalize=(s:unknown)=>String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers});if(req.method!=='POST')return json({success:false,error:'Method not allowed'},405);
 try{
  const url=Deno.env.get('SUPABASE_URL'),anon=Deno.env.get('SUPABASE_ANON_KEY'),service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),secret=Deno.env.get('PAYSTACK_SECRET_KEY');
  const auth=req.headers.get('authorization');if(!auth)return json({success:false,error:'Sign in required'},401);
  if(!url||!anon||!service||!secret||!/^sk_(test|live)_/.test(secret))return json({success:false,error:'Partner settlement provider is not configured'},503);
  if(!resolvePaymentReturnUrl(url,Deno.env.get('APP_URL'),secret,'payment-return'))return json({success:false,error:'Settlement provider environment does not match this app'},503);
  const caller=createClient(url,anon,{global:{headers:{Authorization:auth}},auth:{persistSession:false,autoRefreshToken:false}});
  const {data:{user},error:authError}=await caller.auth.getUser();if(authError||!user)return json({success:false,error:'Sign in required'},401);
  const body=await req.json();const bankId=String(body.bank_account_id||'');if(!/^[a-f\d-]{36}$/i.test(bankId))return json({success:false,error:'Choose a verified bank account'},400);
  const {data:bank,error:bankError}=await caller.rpc('get_my_rent_settlement_bank',{p_bank_id:bankId});if(bankError||bank?.id!==bankId)return json({success:false,error:'Your verified default Partner bank is required'},403);
  const db=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
  const limit=await consumeUserAction(db,user.id,'rent_settlement_setup',6,3600,true);if(!limit.allowed)return json({success:false,error:'Please wait before checking settlement setup again.'},429);
  const {data:claim,error}=await db.rpc('claim_rent_settlement_setup',{p_bank_id:bankId});if(error||!claim)return json({success:false,error:'Settlement setup could not be reserved'},409);
  const description=`WeHouse rent bank ${bankId} attempt ${claim.reference}`;
  const options={headers:{Authorization:`Bearer ${secret}`,'Content-Type':'application/json'},signal:AbortSignal.timeout(12000)};
  let response:Response;
  if(claim.existing_code){response=await fetch(`https://api.paystack.co/subaccount/${encodeURIComponent(claim.existing_code)}`,options);}
  else if(claim.claimed){response=await fetch('https://api.paystack.co/subaccount',{...options,method:'POST',body:JSON.stringify({business_name:bank.account_name,settlement_bank:bank.bank_code,account_number:bank.account_number,percentage_charge:0,description})});}
  else{
   const page=Number.isInteger(body.page)&&body.page>0&&body.page<=1000?body.page:1;
   const list=await fetch(`https://api.paystack.co/subaccount?perPage=50&page=${page}`,options);const found=await list.json();
   if(!list.ok||found.status!==true||!Array.isArray(found.data)||found.data.length>50)throw Error('Provider account lookup unavailable');
   const matches=found.data.filter((v:any)=>v.description===description);
   if(matches.length!==1)return json({success:false,pending:true,bank_account_id:bankId,next_page:matches.length===0&&found.data.length===50?page+1:null,error:'The earlier setup result is not confirmed. No duplicate account was created. Contact Help if checking all pages does not resolve it.'},202);
   response=await fetch(`https://api.paystack.co/subaccount/${encodeURIComponent(matches[0].subaccount_code)}`,{...options,signal:AbortSignal.timeout(12000)});
  }
  const result=await response.json();const p=result.data;const environment=secret.startsWith('sk_live_')?'live':'test';
  if(!response.ok||result.status!==true||!p||p.account_number!==bank.account_number||p.currency!=='NGN'||p.domain!==environment||![true,1].includes(p.active)||
   normalize(p.settlement_bank)!==normalize(bank.bank_name)||!/^ACCT_[A-Za-z0-9]+$/.test(String(p.subaccount_code))||!/^\d+$/.test(String(p.id)))throw Error('Provider account does not match the verified Partner bank');
  const {data:saved,error:saveError}=await db.rpc('bind_verified_rent_settlement_bank',{p_bank_id:bankId,p_account_number:p.account_number,p_bank_code:bank.bank_code,p_subaccount_code:p.subaccount_code,p_subaccount_id:String(p.id),p_environment:environment});
  if(saveError||saved?.ready!==true)return json({success:false,pending:true,error:'Provider setup needs reconciliation. Refresh before retrying.'},409);
  return json({success:true,ready:true,bank_account_id:bankId});
 }catch{return json({success:false,pending:true,error:'Settlement setup could not be confirmed. Check the saved setup before retrying; no rent was charged.'},503);}
});
