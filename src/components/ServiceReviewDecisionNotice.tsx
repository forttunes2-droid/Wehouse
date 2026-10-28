import {useEffect,useState} from 'react';
import {getMyWorkerBookingReview} from '@/lib/supabase/worker-bookings';
import {withTimeout} from '@/lib/withTimeout';
export default function ServiceReviewDecisionNotice({bookingId}:{bookingId:string}){
 const [review,setReview]=useState<{hidden_at?:string|null;moderation_reason?:string|null}|null>(null),[error,setError]=useState(false),[attempt,setAttempt]=useState(0);
 useEffect(()=>{let active=true;setError(false);setReview(null);void withTimeout(getMyWorkerBookingReview(bookingId),12000,'Review check timed out.').then(result=>{const r=result.review;if(result.error||r&&(typeof r!=='object'||Array.isArray(r)||typeof r.id!=='string'||r.hidden_at!=null&&(typeof r.hidden_at!=='string'||!Number.isFinite(Date.parse(r.hidden_at)))||r.moderation_reason!=null&&typeof r.moderation_reason!=='string'))throw Error('Unavailable');if(active)setReview(r);}).catch(()=>{if(active)setError(true);});return()=>{active=false;};},[bookingId,attempt]);
 if(error)return <div role="alert" className="mt-4 text-sm"><p>Your saved review could not be checked.</p><button type="button" onClick={()=>setAttempt(n=>n+1)} className="min-h-11 underline">Refresh saved review</button></div>;
 if(!review?.hidden_at)return null;
 return <section className="mt-4 space-y-2 rounded-xl border border-[var(--wh-border)] p-4 text-sm"><h3 className="font-semibold">Your review is hidden</h3><p className="whitespace-pre-wrap leading-6">{review.moderation_reason}</p><p className="text-[var(--wh-text-secondary)]">The review is retained with this booking but excluded from public ratings. Contact WeHouse through Help with this booking reference if you disagree with the decision.</p></section>;
}
