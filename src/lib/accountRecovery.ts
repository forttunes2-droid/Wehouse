import {supabase} from '@/lib/supabase/client';
import {withTimeout} from '@/lib/withTimeout';
export type Restriction={workspace:string;version:string;reason:string;changed_at:string};
export type AccountReview={case_id:string;case_number:number;workspace:string;restriction_version:string;explanation:string;status:string;updated_at:string;decision:string|null;public_decision:string|null;updates:Array<{note:string;created_at:string}>};
export type ReviewPortal={restrictions:Restriction[];appeals:AccountReview[]};
export const workspaceName=(value:string)=>({account:'Entire account',personal:'Personal',worker:'Services',worker_profile:'Service Worker profile',property_partner:'Property Partner',hosting:'Hosting',hotel:'Hotel Team',staff:'Operations',admin:'Admin'}[value]||value);
export function parseReviewPortal(data:unknown):ReviewPortal{
 const p=data as ReviewPortal;
 if(!p||!Array.isArray(p.restrictions)||!Array.isArray(p.appeals)||p.restrictions.some(r=>typeof r.workspace!=='string'||typeof r.version!=='string'||typeof r.reason!=='string')||
  p.appeals.some(a=>typeof a.case_id!=='string'||typeof a.case_number!=='number'||typeof a.workspace!=='string'||typeof a.restriction_version!=='string'||typeof a.status!=='string'||!Array.isArray(a.updates)||a.updates.some(e=>typeof e.note!=='string'||typeof e.created_at!=='string')))throw Error('Review records could not be confirmed. Refresh before retrying.');
 return p;
}
export async function recoveryRequest(body:Record<string,unknown>){
 const {data,error}=await withTimeout(supabase.functions.invoke('account-recovery',{body}),20000,'The result is uncertain. Refresh your reviews before retrying.');
 if(error||data?.success!==true)throw Error(typeof data?.error==='string'?data.error:'Account review could not be confirmed. Refresh before retrying.');
 return data;
}
export async function reviewPortal(token:string|null,mutation:Record<string,unknown>={}):Promise<ReviewPortal>{
 if(token)return parseReviewPortal((await recoveryRequest({action:'portal',recovery_token:token,...mutation})).portal);
 const {data,error}=await withTimeout(supabase.rpc('my_account_reviews',{
  p_workspace:mutation.workspace??null,p_explanation:mutation.explanation??null,p_version:mutation.version??null,
  p_case_id:mutation.case_id??null,p_reply:mutation.reply??null,p_reply_key:mutation.reply_key??null,
 }),20000,'The result is uncertain. Refresh your reviews before retrying.');
 if(error)throw Error('Review records could not be confirmed. Refresh before retrying.');
 return parseReviewPortal(data);
}
