import {supabase} from '@/lib/supabase/client';
import {withTimeout} from '@/lib/withTimeout';

export type ProviderReview={id:string;experience_booking_id:string|null;booking_id:string|null;rating:number;comment:string|null;created_at:string;updated_at:string;hidden_at:string|null;moderation_reason:string|null};
export type ExperienceReviewState={booking_id:string;eligible:boolean;review:ProviderReview|null};
export type PublicProviderReview={id:string;rating:number;comment:string|null;created_at:string;reviewer_name:string};
export type ReviewPage={items:PublicProviderReview[];summary:{count:number;rating:number|null}};
export type ReviewModeration={report_id:string;status:string;snapshot:{rating:number;comment:string|null;updated_at:string;title:string};review:ProviderReview;context:{title:string;state:string|null;area:string|null};can_moderate:boolean};
const uuid=(v:unknown)=>typeof v==='string'&&/^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v);
const date=(v:unknown)=>typeof v==='string'&&Number.isFinite(Date.parse(v));
function review(value:unknown):ProviderReview{
 const r=value as ProviderReview;
 if(!r||!uuid(r.id)||Number(r.booking_id!==null)+Number(r.experience_booking_id!==null)!==1||r.booking_id!==null&&!uuid(r.booking_id)||r.experience_booking_id!==null&&!uuid(r.experience_booking_id)||!Number.isInteger(r.rating)||r.rating<1||r.rating>5||r.comment!==null&&(typeof r.comment!=='string'||r.comment.length>1200)||!date(r.created_at)||!date(r.updated_at)||r.hidden_at!==null&&!date(r.hidden_at)||r.moderation_reason!==null&&typeof r.moderation_reason!=='string')throw Error('The saved review could not be confirmed. Refresh before retrying.');
 return r;
}
async function rpc(name:string,args:Record<string,unknown>){const result=await withTimeout(supabase.rpc(name,args),15000,'Review confirmation took too long. Refresh before retrying.');if(result.error)throw result.error;return result.data;}
export async function getExperienceReview(bookingId:string):Promise<ExperienceReviewState>{
 const data=await rpc('get_my_experience_review',{p_booking_id:bookingId}) as ExperienceReviewState;
 if(!data||data.booking_id!==bookingId||typeof data.eligible!=='boolean')throw Error('Review eligibility could not be confirmed.');
 if(data.review){data.review=review(data.review);if(data.review.experience_booking_id!==bookingId)throw Error('An unrelated review was returned.');}
 return data;
}
export async function submitExperienceReview(bookingId:string,rating:number,comment:string,expectedUpdatedAt:string|null){
 const data=review(await rpc('submit_my_experience_review',{p_booking_id:bookingId,p_rating:rating,p_comment:comment.trim()||null,p_expected_updated_at:expectedUpdatedAt}));
 if(data.experience_booking_id!==bookingId||data.rating!==rating||data.comment!==(comment.trim()||null))throw Error('The review receipt does not match your submission. Refresh to check its saved state.');
 return data;
}
export async function getExperienceReviews(activityId:string,before?:PublicProviderReview):Promise<ReviewPage>{
 const data=await rpc('get_public_experience_reviews',{p_activity_id:activityId,p_before:before?.created_at||null,p_before_id:before?.id||null}) as ReviewPage;
 if(!data||!data.summary||!Number.isInteger(data.summary.count)||data.summary.count<0||data.summary.count===0&&data.summary.rating!==null||data.summary.count>0&&data.summary.rating===null||data.summary.rating!==null&&(!Number.isFinite(data.summary.rating)||data.summary.rating<1||data.summary.rating>5)||!Array.isArray(data.items)||data.items.length>20||data.items.some(r=>!uuid(r.id)||!Number.isInteger(r.rating)||r.rating<1||r.rating>5||!date(r.created_at)||typeof r.reviewer_name!=='string'||r.comment!==null&&typeof r.comment!=='string')||new Set(data.items.map(r=>r.id)).size!==data.items.length)throw Error('Activity reviews could not be confirmed.');
 return data;
}
function moderation(value:unknown,reportId:string):ReviewModeration{
 const data=value as ReviewModeration;
 if(!data||data.report_id!==reportId||!['open','reviewing','actioned','dismissed'].includes(data.status)||typeof data.can_moderate!=='boolean'||!data.snapshot||!Number.isInteger(data.snapshot.rating)||data.snapshot.rating<1||data.snapshot.rating>5||!date(data.snapshot.updated_at)||typeof data.snapshot.title!=='string'||data.snapshot.comment!==null&&typeof data.snapshot.comment!=='string'||!data.context||typeof data.context.title!=='string'||data.context.state!==null&&typeof data.context.state!=='string'||data.context.area!==null&&typeof data.context.area!=='string')throw Error('The moderation record could not be confirmed.');
 data.review=review(data.review);return data;
}
export async function getReviewModeration(reportId:string){return moderation(await rpc('get_provider_review_moderation',{p_report_id:reportId}),reportId);}
export async function moderateReview(reportId:string,hidden:boolean,note:string,expectedUpdatedAt:string,requestId:string){
 const data=moderation(await rpc('moderate_provider_review',{p_report_id:reportId,p_hidden:hidden,p_note:note.trim(),p_expected_updated_at:expectedUpdatedAt,p_request_id:requestId}),reportId);
 if(Boolean(data.review.hidden_at)!==hidden||data.review.moderation_reason!==note.trim())throw Error('The moderation outcome does not match this request. Refresh before retrying.');
 return data;
}
