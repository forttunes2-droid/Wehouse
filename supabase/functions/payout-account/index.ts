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
const REQUEST_ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function nameTokens(value:string){return [...new Set(value.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().split(/\s+/).filter(v=>v.length>1&&!IGNORED_NAMES.has(v)))];}
function matchCount(profileName:string,accountName:string){const profile=new Set(nameTokens(profileName));return nameTokens(accountName).filter(token=>profile.has(token)).length;}
async function paystack(path:string,secret:string,init?:RequestInit){const response=await fetch(`https://api.paystack.co${path}`,{...init,headers:{Authorization:`Bearer ${secret}`,'Content-Type':'application/json',...(init?.headers||{})}});let body:any=null;try{body=await response.json()}catch{body=null}if(!response.ok||!body?.status)throw new Error(body?.message||`Paystack request failed (${response.status})`);return body.data;}
function message(error:unknown,fallback:string){return error instanceof Error&&error.message?error.message:fallback;}
function accountPayload(value:any){return value?.account||value||null;}

async function markRequest(admin:any,requestId:string,userId:string,patch:Record<string,unknown>){
  const{data,error}=await admin.from('payout_account_change_requests').update({...patch,updated_at:new Date().toISOString()}).eq('request_id',requestId).eq('user_id',userId).select('request_id').maybeSingle();
  if(error)throw error;
  if(!data)throw new Error('Payout-account request ledger row is missing');
  return data;
}
async function promoteDefault(admin:any,userId:string,accountId:string){
  const{data,error}=await admin.rpc('set_default_payout_account_for_user',{p_user_id:userId,p_account_id:accountId});
  if(error)throw error;
  return accountPayload(data);
}
async function finishSucceeded(admin:any,row:any,account:any){
  if(!account?.id)throw new Error('Succeeded payout-account change is missing its account');
  await markRequest(admin,row.request_id,row.user_id,{status:'succeeded',bank_account_id:account.id,error_code:null,error_message:null});
  return account;
}
async function findMatchingRecipient(paystackSecret:string,bankCode:string,accountNumber:string){
  for(let page=1;page<=5;page++){
    const data=await paystack(`/transferrecipient?perPage=100&page=${page}`,paystackSecret);
    const rows=Array.isArray(data)?data:[];
    const found=rows.find((item:any)=>String(item?.details?.bank_code||item?.details?.bank?.code||'')===bankCode&&String(item?.details?.account_number||'').replace(/\D/g,'')===accountNumber&&item?.recipient_code);
    if(found)return String(found.recipient_code);
    if(rows.length<100)break;
  }
  return '';
}
async function reconcileChange(admin:any,paystackSecret:string,row:any){
  if(row.status==='succeeded'){
    if(row.bank_account_id){
      const{data:account,error}=await admin.from('bank_accounts').select('id,bank_name,bank_code,account_number,account_name,verified_at,is_default,is_active').eq('id',row.bank_account_id).eq('user_id',row.user_id).maybeSingle();
      if(error)throw error;
      if(account)return{pending:false,status:'succeeded',account};
    }
    // A success marker without its referenced account is incomplete. Continue
    // reconciling the original target instead of telling the client to retry.
  }
  if(row.status==='failed')return{pending:false,status:'failed',error:row.error_message||'Payout account change failed'};

  // Read-before-retry: the original request may have completed after the client
  // stopped waiting. Never create a second recipient if the destination exists.
  const{data:existing,error:existingError}=await admin.from('bank_accounts').select('id,bank_name,bank_code,account_number,account_name,verified_at,is_default,is_active,recipient_code').eq('user_id',row.user_id).eq('bank_code',row.bank_code).eq('account_number',row.account_number).eq('is_active',true).maybeSingle();
  if(existingError)throw existingError;
  if(existing?.recipient_code){
    const account=await promoteDefault(admin,row.user_id,existing.id);
    return{pending:false,status:'succeeded',account:await finishSucceeded(admin,row,account)};
  }

  let recipientCode=String(row.recipient_code||'');
  const ageMs=Date.now()-new Date(row.created_at).getTime();
  if(!recipientCode&&ageMs>=90_000){
    try{
      recipientCode=await findMatchingRecipient(paystackSecret,row.bank_code,row.account_number);
      if(recipientCode)await markRequest(admin,row.request_id,row.user_id,{recipient_code:recipientCode,status:'uncertain'});
    }catch(error){
      console.error('payout-account recipient reconciliation failed',{request_id:row.request_id,user_id:row.user_id,error:message(error,'recipient lookup failed')});
      return{pending:true,status:'uncertain'};
    }
    if(!recipientCode){
      // A bounded provider listing cannot prove that the original recipient
      // mutation failed. Keep the same request blocked for reconciliation so a
      // retry can never create a second economic destination.
      await markRequest(admin,row.request_id,row.user_id,{status:'uncertain',error_code:'PROVIDER_RESULT_NOT_FOUND_YET',error_message:'The payout recipient is still being reconciled with Paystack.'});
      return{pending:true,status:'uncertain'};
    }
  }

  if(recipientCode){
    const{data:saved,error:saveError}=await admin.rpc('save_verified_payout_account',{p_user_id:row.user_id,p_bank_code:row.bank_code,p_bank_name:row.bank_name,p_account_number:row.account_number,p_account_name:row.account_name,p_recipient_code:recipientCode});
    if(saveError){
      await markRequest(admin,row.request_id,row.user_id,{status:'uncertain',error_code:'DATABASE_RECONCILING',error_message:saveError.message});
      return{pending:true,status:'uncertain'};
    }
    const savedAccount=accountPayload(saved);
    if(!savedAccount?.id)throw new Error('Saved payout account is missing its id');
    const account=await promoteDefault(admin,row.user_id,String(savedAccount.id));
    return{pending:false,status:'succeeded',account:await finishSucceeded(admin,row,account)};
  }
  return{pending:true,status:row.status||'processing'};
}

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

    if(action==='get_change_status'){
      const requestId=String(body?.request_id||'').trim();
      if(!REQUEST_ID.test(requestId))return json({success:false,error:'Valid payout change request id required'},400);
      const{data:row,error}=await admin.from('payout_account_change_requests').select('*').eq('request_id',requestId).eq('user_id',profile.user_id).maybeSingle();
      if(error)return json({success:false,error:'Could not reconcile this payout-account change',stage:'reconcile_read'},500);
      // The original request may still be resolving the bank before it creates
      // its mutation ledger row. Treat that short race as pending, not failure.
      if(!row)return json({success:true,pending:true,status:'not_found'},202);
      try{
        const result=await reconcileChange(admin,paystackSecret,row);
        return json({success:true,...result},result.pending?202:200);
      }catch(error){
        console.error('payout-account reconciliation failed',{request_id:requestId,user_id:profile.user_id,error:message(error,'reconciliation failed')});
        return json({success:true,pending:true,status:'uncertain'},202);
      }
    }

    const bankCode=String(body?.bank_code||'').trim(),accountNumber=String(body?.account_number||'').replace(/\D/g,'');
    if(!bankCode)return json({success:false,error:'Choose a bank'},400);if(!/^\d{10}$/.test(accountNumber))return json({success:false,error:'Enter a valid 10-digit account number'},400);
    let bankData:any;try{bankData=await paystack('/bank?currency=NGN&perPage=100',paystackSecret)}catch(error){console.error('payout-account bank lookup failed',{user_id:profile.user_id,last4:accountNumber.slice(-4),error:message(error,'bank lookup failed')});return json({success:false,error:'Could not confirm the selected bank with Paystack. Try again.',stage:'bank_lookup'},502)}
    const bank=(Array.isArray(bankData)?bankData:[]).find((item:any)=>String(item?.code||'')===bankCode&&item?.active!==false);if(!bank)return json({success:false,error:'Bank is unavailable'},400);
    let resolved:any;try{resolved=await paystack(`/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`,paystackSecret)}catch(error){console.error('payout-account resolve failed',{user_id:profile.user_id,bank_code:bankCode,last4:accountNumber.slice(-4),error:message(error,'resolve failed')});return json({success:false,error:message(error,'Paystack could not verify this account'),stage:'resolve'},400)}
    const accountName=String(resolved?.account_name||'').trim();if(!accountName)return json({success:false,error:'Paystack could not verify this account name',stage:'resolve'},400);
    const{count:existingCount,error:countError}=await admin.from('bank_accounts').select('id',{count:'exact',head:true}).eq('user_id',profile.user_id).eq('is_active',true);if(countError)return json({success:false,error:'Could not check your existing payout account',stage:'existing_account'},500);
    const replacing=Number(existingCount||0)>0,profileTokens=nameTokens(String(profile.full_name||'')),matched=matchCount(String(profile.full_name||''),accountName),replacementAllowed=!replacing||(profileTokens.length>=2&&matched>=2);
    if(action==='resolve')return json({success:true,bank:{code:bankCode,name:String(bank.name)},account_number:accountNumber,account_name:accountName,replacement:replacing,replacement_allowed:replacementAllowed,addition_allowed:replacementAllowed,matched_names:matched,needs_full_name:replacing&&profileTokens.length<2,saved_count:Number(existingCount||0)});
    if(action!=='save')return json({success:false,error:'Unknown action'},400);
    if(replacing&&profileTokens.length<2)return json({success:false,error:'Complete your full name in Personal Details before changing your payout account.',code:'FULL_NAME_REQUIRED'},409);
    if(replacing&&matched<2)return json({success:false,error:'The verified bank account name must match at least two names from your WeHouse full name.',code:'NAME_MISMATCH'},409);
    if(replacing)return json({success:false,error:'Changing an existing payout account requires fresh sign-in and OTP verification. This security step is not available yet.',code:'PAYOUT_REPLACEMENT_STEP_UP_REQUIRED'},409);

    const requestId=String(body?.request_id||'').trim();
    if(!REQUEST_ID.test(requestId))return json({success:false,error:'Valid payout change request id required'},400);
    const confirmedAt=new Date().toISOString();
    const target={request_id:requestId,idempotency_key:requestId,user_id:profile.user_id,auth_session_id:`edge:${requestId}`,bank_code:bankCode,bank_name:String(bank.name),account_number:accountNumber,account_name:accountName,replacement:false,account_name_confirmed_at:confirmedAt,cooling_ends_at:confirmedAt,status:'processing'};
    const{data:known,error:knownError}=await admin.from('payout_account_change_requests').select('*').eq('request_id',requestId).eq('user_id',profile.user_id).maybeSingle();
    if(knownError)return json({success:false,error:'Could not begin payout-account reconciliation',stage:'request_read'},500);
    if(known){
      if(known.bank_code!==bankCode||known.account_number!==accountNumber)return json({success:false,error:'This request id belongs to a different payout account change',code:'REQUEST_TARGET_MISMATCH'},409);
      const result=await reconcileChange(admin,paystackSecret,known);
      return json({success:true,replacement:replacing,...result},result.pending?202:200);
    }
    const{error:requestError}=await admin.from('payout_account_change_requests').insert(target);
    if(requestError){
      // A concurrent invocation with the same id may have won the insert.
      const{data:raced}=await admin.from('payout_account_change_requests').select('*').eq('request_id',requestId).eq('user_id',profile.user_id).maybeSingle();
      if(raced){const result=await reconcileChange(admin,paystackSecret,raced);return json({success:true,replacement:replacing,...result},result.pending?202:200);}
      return json({success:false,error:'Could not begin payout-account change',stage:'request_create'},500);
    }

    const{data:existing}=await admin.from('bank_accounts').select('id,bank_name,bank_code,account_number,account_name,verified_at,is_default,is_active,recipient_code').eq('user_id',profile.user_id).eq('bank_code',bankCode).eq('account_number',accountNumber).eq('is_active',true).maybeSingle();
    if(existing?.recipient_code){
      const account=await promoteDefault(admin,profile.user_id,existing.id);
      const row={...target};
      return json({success:true,replacement:replacing,status:'succeeded',pending:false,account:await finishSucceeded(admin,row,account)});
    }

    let recipient:any;try{recipient=await paystack('/transferrecipient',paystackSecret,{method:'POST',body:JSON.stringify({type:'nuban',name:accountName,account_number:accountNumber,bank_code:bankCode,currency:'NGN'})})}
    catch(error){
      console.error('payout-account recipient uncertain',{request_id:requestId,user_id:profile.user_id,bank_code:bankCode,last4:accountNumber.slice(-4),error:message(error,'recipient failed')});
      await markRequest(admin,requestId,profile.user_id,{status:'uncertain',error_code:'PROVIDER_RESULT_UNCERTAIN',error_message:message(error,'Paystack recipient result is uncertain')});
      return json({success:true,pending:true,status:'uncertain'},202);
    }
    const recipientCode=String(recipient?.recipient_code||'').trim();
    if(!recipientCode){await markRequest(admin,requestId,profile.user_id,{status:'uncertain',error_code:'RECIPIENT_CODE_MISSING',error_message:'Paystack did not return a recipient code'});return json({success:true,pending:true,status:'uncertain'},202);}
    await markRequest(admin,requestId,profile.user_id,{recipient_code:recipientCode,status:'processing',error_code:null,error_message:null});

    const{data:saved,error:saveError}=await admin.rpc('save_verified_payout_account',{p_user_id:profile.user_id,p_bank_code:bankCode,p_bank_name:String(bank.name),p_account_number:accountNumber,p_account_name:accountName,p_recipient_code:recipientCode});
    if(saveError){
      console.error('payout-account database save uncertain',{request_id:requestId,user_id:profile.user_id,bank_code:bankCode,last4:accountNumber.slice(-4),error:saveError.message});
      await markRequest(admin,requestId,profile.user_id,{status:'uncertain',error_code:'DATABASE_RECONCILING',error_message:saveError.message});
      return json({success:true,pending:true,status:'uncertain'},202);
    }
    const savedAccount=accountPayload(saved);if(!savedAccount?.id){await markRequest(admin,requestId,profile.user_id,{status:'uncertain',error_code:'ACCOUNT_ID_MISSING',error_message:'Saved payout account is missing its id'});return json({success:true,pending:true,status:'uncertain'},202);}
    const account=await promoteDefault(admin,profile.user_id,String(savedAccount.id));
    const row={...target,recipient_code:recipientCode};
    return json({success:true,replacement:replacing,status:'succeeded',pending:false,account:await finishSucceeded(admin,row,account)});
  }catch(error){console.error('payout-account unhandled',{error:message(error,'unknown')});return json({success:false,error:'Payout account request failed. Please try again.',stage:'unexpected'},500);}
});
