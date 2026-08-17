import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Content-Type':'application/json',
};
const json=(body:Record<string,unknown>,status=200)=>new Response(JSON.stringify(body),{status,headers:cors});
const IGNORED_NAMES=new Set(['mr','mrs','miss','ms','dr','chief','alhaji','hajiya','hon','prof','sir','madam']);
function nameTokens(value:string){return [...new Set(value.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().split(/\s+/).filter(v=>v.length>1&&!IGNORED_NAMES.has(v)))];}
function matchCount(profileName:string,accountName:string){const profile=new Set(nameTokens(profileName));return nameTokens(accountName).filter(token=>profile.has(token)).length;}
async function paystack(path:string,secret:string,init?:RequestInit){const response=await fetch(`https://api.paystack.co${path}`,{...init,headers:{Authorization:`Bearer ${secret}`,'Content-Type':'application/json',...(init?.headers||{})}});let body:any=null;try{body=await response.json()}catch{body=null}if(!response.ok||!body?.status)throw new Error(body?.message||`Paystack request failed (${response.status})`);return body.data;}
function message(error:unknown,fallback:string){return error instanceof Error&&error.message?error.message:fallback;}

serve(async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
  if(req.method!=='POST')return json({success:false,error:'Method not allowed'},405);
  try{
    const authHeader=req.headers.get('authorization');if(!authHeader)return json({success:false,error:'Authorization required'},401);
    const supabaseUrl=Deno.env.get('SUPABASE_URL'),serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),paystackSecret=Deno.env.get('PAYSTACK_SECRET_KEY');
    if(!supabaseUrl||!serviceKey||!paystackSecret)return json({success:false,error:'Payout server configuration is incomplete'},503);
    const admin=createClient(supabaseUrl,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
    const token=authHeader.replace(/^Bearer\s+/i,'');const{data:{user},error:authError}=await admin.auth.getUser(token);if(authError||!user)return json({success:false,error:'Invalid or expired session'},401);
    const{data:profile,error:profileError}=await admin.from('profiles').select('user_id,role,full_name,deleted,suspended,banned').eq('auth_id',user.id).maybeSingle();
    if(profileError)return json({success:false,error:'Could not load your payout profile',stage:'profile'},500);
    if(!profile||!['worker','property_partner'].includes(profile.role))return json({success:false,error:'Worker or Property Partner account required'},403);
    if(profile.deleted||profile.suspended||profile.banned)return json({success:false,error:'Account is not active'},403);

    const body=await req.json().catch(()=>({}));const action=String(body?.action||'').trim();
    if(action==='banks'){
      try{const data=await paystack('/bank?currency=NGN&perPage=100',paystackSecret);const banks=(Array.isArray(data)?data:[]).filter((bank:any)=>bank?.active!==false&&bank?.code&&bank?.name&&(bank?.type==='nuban'||!bank?.type)).map((bank:any)=>({code:String(bank.code),name:String(bank.name)})).sort((a:any,b:any)=>a.name.localeCompare(b.name));return json({success:true,banks});}
      catch(error){console.error('payout-account banks failed',{error:message(error,'banks failed')});return json({success:false,error:'Could not load banks from Paystack. Try again.',stage:'banks'},502);}
    }

    const bankCode=String(body?.bank_code||'').trim(),accountNumber=String(body?.account_number||'').replace(/\D/g,'');
    if(!bankCode)return json({success:false,error:'Choose a bank'},400);if(!/^\d{10}$/.test(accountNumber))return json({success:false,error:'Enter a valid 10-digit account number'},400);
    let bankData:any;try{bankData=await paystack('/bank?currency=NGN&perPage=100',paystackSecret)}catch(error){console.error('payout-account bank lookup failed',{user_id:profile.user_id,last4:accountNumber.slice(-4),error:message(error,'bank lookup failed')});return json({success:false,error:'Could not confirm the selected bank with Paystack. Try again.',stage:'bank_lookup'},502)}
    const bank=(Array.isArray(bankData)?bankData:[]).find((item:any)=>String(item?.code||'')===bankCode&&item?.active!==false);if(!bank)return json({success:false,error:'Bank is unavailable'},400);
    let resolved:any;try{resolved=await paystack(`/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`,paystackSecret)}catch(error){console.error('payout-account resolve failed',{user_id:profile.user_id,bank_code:bankCode,last4:accountNumber.slice(-4),error:message(error,'resolve failed')});return json({success:false,error:message(error,'Paystack could not verify this account'),stage:'resolve'},400)}
    const accountName=String(resolved?.account_name||'').trim();if(!accountName)return json({success:false,error:'Paystack could not verify this account name',stage:'resolve'},400);
    const{count:existingCount,error:countError}=await admin.from('bank_accounts').select('id',{count:'exact',head:true}).eq('user_id',profile.user_id);if(countError)return json({success:false,error:'Could not check your existing payout account',stage:'existing_account'},500);
    const replacing=Number(existingCount||0)>0,profileTokens=nameTokens(String(profile.full_name||'')),matched=matchCount(String(profile.full_name||''),accountName),replacementAllowed=!replacing||(profileTokens.length>=2&&matched>=2);
    if(action==='resolve')return json({success:true,bank:{code:bankCode,name:String(bank.name)},account_number:accountNumber,account_name:accountName,replacement:replacing,replacement_allowed:replacementAllowed,matched_names:matched,needs_full_name:replacing&&profileTokens.length<2});
    if(action!=='save')return json({success:false,error:'Unknown action'},400);
    if(replacing&&profileTokens.length<2)return json({success:false,error:'Complete your full name in Personal Details before changing your payout account.',code:'FULL_NAME_REQUIRED'},409);
    if(replacing&&matched<2)return json({success:false,error:'The verified bank account name must match at least two names from your WeHouse full name.',code:'NAME_MISMATCH'},409);

    let recipient:any;try{recipient=await paystack('/transferrecipient',paystackSecret,{method:'POST',body:JSON.stringify({type:'nuban',name:accountName,account_number:accountNumber,bank_code:bankCode,currency:'NGN'})})}
    catch(error){console.error('payout-account recipient failed',{user_id:profile.user_id,bank_code:bankCode,last4:accountNumber.slice(-4),error:message(error,'recipient failed')});return json({success:false,error:message(error,'Paystack could not create the payout recipient'),stage:'recipient'},502)}
    const recipientCode=String(recipient?.recipient_code||'').trim();if(!recipientCode)return json({success:false,error:'Paystack did not return a payout recipient code. Try again.',stage:'recipient'},502);

    const{data:saved,error:saveError}=await admin.rpc('save_verified_payout_account',{p_user_id:profile.user_id,p_bank_code:bankCode,p_bank_name:String(bank.name),p_account_number:accountNumber,p_account_name:accountName,p_recipient_code:recipientCode});
    if(saveError){console.error('payout-account database save failed',{user_id:profile.user_id,bank_code:bankCode,last4:accountNumber.slice(-4),error:saveError.message});return json({success:false,error:'We verified the bank account but could not save it. Please try again.',stage:'database_save'},500)}
    return json({success:true,replacement:replacing,account:(saved as any)?.account||saved});
  }catch(error){console.error('payout-account unhandled',{error:message(error,'unknown')});return json({success:false,error:'Payout account request failed. Please try again.',stage:'unexpected'},500);}
});
