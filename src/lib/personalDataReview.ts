import type {SupportOpenContext} from '@/lib/supabase/support';

export const PERSONAL_DATA_REASONS=['personal_data_access','personal_data_correction','personal_data_deletion'] as const;
export type PersonalDataOutcome='completed'|'partly_completed'|'not_completed';
export type PersonalDataReview={conversation_id:string;case_id:string;case_number:number;reason_code:string;status:string;revision:string;can_respond:boolean;response:null|{request_id:string;outcome:PersonalDataOutcome;completed:string;retained:string;responded_at:string}};
const uuid=/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
export function personalDataRequest(kind:'access'|'correction'|'deletion',person:string):SupportOpenContext{
 return {subject:kind==='access'?'Get a copy of my data':kind==='correction'?'Correct personal information':'Request data deletion',category:'account_access',contextType:'contextual_help',contextId:person,contextSnapshot:{reason_code:'personal_data_'+kind,subject_type:'account',source_id:person}};
}
export function personalDataReview(value:unknown,conversation:string):PersonalDataReview{
 const r=value as PersonalDataReview;
 if(!r||r.conversation_id!==conversation||!uuid.test(r.case_id)||!Number.isSafeInteger(r.case_number)||!PERSONAL_DATA_REASONS.includes(r.reason_code as typeof PERSONAL_DATA_REASONS[number])||!Number.isFinite(Date.parse(r.revision))||typeof r.can_respond!=='boolean'||!['open','assigned','investigating','waiting_customer','resolved','closed'].includes(r.status))throw Error('The personal-data review could not be confirmed. Refresh this request.');
 const response=r.response;
 if(response!==null&&(!response||!uuid.test(response.request_id)||!['completed','partly_completed','not_completed'].includes(response.outcome)||typeof response.completed!=='string'||typeof response.retained!=='string'||response.completed.length>4000||response.retained.length>4000||!Number.isFinite(Date.parse(response.responded_at))))throw Error('The review response could not be confirmed. Refresh this request.');
 return r;
}
