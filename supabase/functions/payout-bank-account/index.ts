import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
  'Content-Type':'application/json',
};
const json=(body:Record<string,unknown>,status=200)=>new Response(JSON.stringify(body),{status,headers:cors});

type Bank={name:string;code:string;active?:boolean;currency?:string;country?:string;type?:string};

function tokens(value:string){
  return [...new Set(String(value||'').toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]/g,' ').split(/\s+/).filter(v=>v.length>=2))];
}
function matchCount(a:string,b:string){const right=new Set(tokens(b));return tokens(a).filter(v=>right.has(v)).length;}

async function paystack(path:string,secret:string,init?:RequestInit){
  const response=await fetch(`https://api.paystack.co${path}`,{
    ...init,
    headers:{Authorization:`Bearer ${secret}`,'Content-Type':'application/json',...(init?.headers||{})},
  });
  let body:any=null;try{body=await response.json()}catch{body=null}
  if(!response.ok||!body?.status)throw new Error(body?.message||`Paystack request failed (${response.status})`);
  return body.data;
}
async function fetchBanks(secret:string):Promise<Bank[]>{
  const data=await paystack('/bank?country=nigeria&perPage=100',secret);
  return (Array.isArray(data)?data:[])
    .filter((bank:any)=>bank?.active!==false&&bank?.code&&bank?.name)
    .map((bank:any)=>({name:String(bank.name),code:String(bank.code),active:bank.active,currency:bank.currency,country:bank.country,type:bank.type}));
}
async function resolveAccount(secret:string,accountNumber:string,bankCode:string){
  const data=await paystack(`/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`,secret);
  const name=String(data?.account_name||'').trim();
  const number=String(data?.account_number||accountNumber).trim();
  if(!name)throw new Error('Paystack could not resolve the account holder name');
  return{account_name:name,account_number:number};
}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
  if(req.method!=='POST')return json({success:false,error:'Method not allowed'},405);
  try{
    const authHeader=req.headers.get('authorization');
    if(!authHeader)return json({success:false,error:'Authorization required'},401);
    const supabaseUrl=Deno.env.get('SUPABASE_URL');
    const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const paystackSecret=Deno.env.get('PAYSTACK_SECRET_KEY');
    if(!supabaseUrl||!serviceKey||!paystackSecret)return json({success:false,error:'Payout server configuration is incomplete'},503);

    const admin=createClient(supabaseUrl,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
    const token=authHeader.replace(/^Bearer\s+/i,'');
    const{data:{user},error:authError}=await admin.auth.getUser(token);
    if(authError||!user)return json({success:false,error:'Invalid or expired session'},401);
    const{data:profile,error:profileError}=await admin.from('profiles')
      .select('user_id,role,full_name,deleted,suspended,banned')
      .eq('auth_id',user.id).maybeSingle();
    if(profileError)return json({success:false,error:profileError.message},500);
    if(!profile||!['worker','property_partner'].includes(profile.role))return json({success:false,error:'Worker or Property Partner account required'},403);
    if(profile.deleted||profile.suspended||profile.banned)return json({success:false,error:'Account is not active'},403);

    const body=await req.json().catch(()=>({}));
    const action=String(body?.action||'banks');
    if(action==='banks'){
      const banks=await fetchBanks(paystackSecret);
      return json({success:true,banks:banks.map(bank=>({name:bank.name,code:bank.code}))});
    }

    const accountNumber=String(body?.account_number||'').replace(/\D/g,'');
    const bankCode=String(body?.bank_code||'').trim();
    if(!/^\d{10}$/.test(accountNumber))return json({success:false,error:'Enter a 10-digit bank account number'},400);
    if(!bankCode)return json({success:false,error:'Choose a bank'},400);

    const banks=await fetchBanks(paystackSecret);
    const bank=banks.find(item=>item.code===bankCode);
    if(!bank)return json({success:false,error:'Choose a supported Nigerian bank'},400);
    const resolved=await resolveAccount(paystackSecret,accountNumber,bankCode);

    const{data:existing,error:existingError}=await admin.from('bank_accounts')
      .select('id,bank_name,bank_code,account_number,account_name,verified_at')
      .eq('user_id',profile.user_id).maybeSingle();
    if(existingError)return json({success:false,error:existingError.message},500);
    const replacement=Boolean(existing);
    const matches=replacement?matchCount(String(profile.full_name||''),resolved.account_name):0;

    if(action==='resolve'){
      return json({
        success:true,
        replacement,
        bank_name:bank.name,
        bank_code:bank.code,
        account_number:resolved.account_number,
        account_name:resolved.account_name,
        name_match_count:matches,
        replacement_allowed:!replacement||matches>=2,
      });
    }
    if(action!=='save')return json({success:false,error:'Unsupported action'},400);

    if(replacement){
      if(tokens(String(profile.full_name||'')).length<2)return json({success:false,error:'Complete your WeHouse full name before changing your payout account'},409);
      if(matches<2)return json({success:false,error:'To change your payout account, at least two names on the bank account must match your WeHouse full name'},409);
    }

    const recipient=await paystack('/transferrecipient',paystackSecret,{
      method:'POST',
      body:JSON.stringify({
        type:'nuban',
        name:resolved.account_name,
        account_number:resolved.account_number,
        bank_code:bank.code,
        currency:'NGN',
        description:`WeHouse ${profile.role} payout account`,
        metadata:{wehouse_user_id:profile.user_id,role:profile.role},
      }),
    });
    const recipientCode=String(recipient?.recipient_code||'').trim();
    if(!recipientCode)return json({success:false,error:'Paystack did not create a payout recipient'},502);

    const{data:saved,error:saveError}=await admin.rpc('service_save_verified_payout_account',{
      p_user_id:profile.user_id,
      p_bank_name:bank.name,
      p_bank_code:bank.code,
      p_account_number:resolved.account_number,
      p_verified_account_name:resolved.account_name,
      p_paystack_recipient_code:recipientCode,
    });
    if(saveError)return json({success:false,error:saveError.message},409);

    return json({
      success:true,
      replacement:Boolean(saved?.replacement),
      bank_name:bank.name,
      account_last4:resolved.account_number.slice(-4),
      account_name:resolved.account_name,
      verified:true,
    });
  }catch(error){
    return json({success:false,error:error instanceof Error?error.message:'Unable to verify payout account'},400);
  }
});
