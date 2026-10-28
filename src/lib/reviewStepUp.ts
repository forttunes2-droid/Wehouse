import {supabase} from '@/lib/supabase/client';
import {withTimeout} from '@/lib/withTimeout';
/** Client checks only reduce prompts; PostgreSQL independently checks fresh MFA. */
export async function confirmAdminReview(code:string){
 const assurance=await withTimeout(supabase.auth.mfa.getAuthenticatorAssuranceLevel(),12000,'Security confirmation took too long.');
 const session=await withTimeout(supabase.auth.getSession(),12000,'Security session took too long.');
 if(!code&&assurance.data?.currentLevel==='aal2'&&session.data.session){
  try{const claims=JSON.parse(atob(session.data.session.access_token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
   if(claims.amr?.some((a:{method:string;timestamp:number})=>a.method==='totp'&&a.timestamp>Date.now()/1000-240))return;
  }catch{/* A fresh authenticator check is required below. */}
 }
 if(!/^\d{6}$/.test(code))throw Error('Enter a fresh authenticator code. If needed, enable your authenticator in Access & security first.');
 const factors=await withTimeout(supabase.auth.mfa.listFactors(),12000,'Authenticator status took too long.');
 const factor=factors.data?.totp.find(f=>f.status==='verified');
 if(factors.error||!factor)throw Error('Enable your authenticator in Access & security before changing access.');
 const verified=await withTimeout(supabase.auth.mfa.challengeAndVerify({factorId:factor.id,code}),15000,'Security confirmation took too long.');
 if(verified.error)throw Error('Authenticator confirmation failed. Check the current code and try again.');
}
