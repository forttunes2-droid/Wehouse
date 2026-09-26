import { hasLiveSession } from "../_shared/liveSession.ts";
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const headers = {
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Content-Type':'application/json',
};
const json=(body:Record<string,unknown>,status=200)=>new Response(JSON.stringify(body),{status,headers});

serve(async(request)=>{
  if(request.method==='OPTIONS') return new Response('ok',{headers});
  if(request.method!=='POST') return json({success:false,error:'Method not allowed'},405);
  const authorization=request.headers.get('authorization');
  if(!authorization) return json({success:false,error:'Authorization required'},401);
  const token=authorization.replace(/^Bearer\s+/i,'');
  const url=Deno.env.get('SUPABASE_URL');
  const anonKey=Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if(!url||!anonKey||!serviceKey) return json({success:false,error:'Creator security is unavailable'},503);

  try{
    const body=await request.json().catch(()=>({}));
    const accountPassword=String(body?.account_password||'');
    const newSecret=String(body?.new_creator_secret||'');
    const otp=String(body?.otp_code||'').replace(/\D/g,'');
    if(!accountPassword || newSecret.length<12 || newSecret.length>128)
      return json({success:false,error:'Complete the account confirmation and use a Creator security password of 12–128 characters.'},400);

    const admin=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data:{user},error:authError}=await admin.auth.getUser(token);
    if(authError||!user?.email) return json({success:false,error:'Session expired. Sign in again.'},401);
    if(!await hasLiveSession(admin,user.id,token)) return json({success:false,error:'Session ended. Sign in again.'},401);

    const {data:profile}=await admin.from('profiles').select('user_id').eq('auth_id',user.id).maybeSingle();
    if(!profile) return json({success:false,error:'Creator authority required'},403);
    const {data:grants}=await admin.from('workspace_role_assignments')
      .select('workspace_role,scope_type,status,revoked_at').eq('user_id',profile.user_id)
      .eq('workspace_role','creator').eq('status','active').is('revoked_at',null);
    if(!(grants||[]).some((row:any)=>row.scope_type==='global'))
      return json({success:false,error:'Creator authority required'},403);

    const verifier=createClient(url,anonKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
    const {data:passwordSession,error:passwordError}=await verifier.auth.signInWithPassword({email:user.email,password:accountPassword});
    if(passwordError||passwordSession.user?.id!==user.id)
      return json({success:false,error:'Account confirmation failed'},200);

    const {data:existing}=await admin.from('creator_security_credentials')
      .select('creator_user_id').eq('creator_user_id',profile.user_id).maybeSingle();
    const {data:factors,error:factorError}=await verifier.auth.mfa.listFactors();
    if(factorError) throw factorError;
    const verified=factors.totp.find((factor)=>factor.status==='verified');

    if(existing && !verified)
      return json({success:false,needs_mfa_enrollment:true,error:'Enroll an authenticator before resetting an existing Creator security password.'},409);

    if(verified){
      if(!/^\d{6}$/.test(otp)) return json({success:false,needs_mfa:true},200);
      const {data:challenge,error:challengeError}=await verifier.auth.mfa.challenge({factorId:verified.id});
      if(challengeError) throw challengeError;
      const {error:verifyError}=await verifier.auth.mfa.verify({factorId:verified.id,challengeId:challenge.id,code:otp});
      if(verifyError) return json({success:false,error:'Authenticator code is incorrect'},200);
      const {data:assurance,error:assuranceError}=await verifier.auth.mfa.getAuthenticatorAssuranceLevel();
      if(assuranceError||assurance.currentLevel!=='aal2')
        return json({success:false,error:'Authenticator assurance could not be confirmed'},403);
    }

    const {data:saved,error:saveError}=await admin.rpc('set_creator_security_secret_from_service',{
      p_auth_user_id:user.id,p_secret:newSecret
    });
    if(saveError||saved!==true) return json({success:false,error:'Creator security password could not be saved'},500);
    return json({success:true,mfa_enrolled:Boolean(verified)});
  }catch(error){
    console.error('creator-security-setup failed',error instanceof Error?error.message:error);
    return json({success:false,error:'Creator security setup failed'},500);
  }
});
