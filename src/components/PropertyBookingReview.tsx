import {useEffect,useRef,useState} from 'react';
import {getBookingReview,submitBookingReview,type BookingReview} from '@/lib/propertyReviews';
import {Button} from '@/components/ui/button';
export default function PropertyBookingReview({reservationId}:{reservationId:string}){
 const [state,setState]=useState<BookingReview|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[attempt,setAttempt]=useState(0);
 const [rating,setRating]=useState(5),[comment,setComment]=useState('');const generation=useRef(0),lock=useRef(false);
 useEffect(()=>{const current=++generation.current;setLoading(true);setState(null);setError('');void getBookingReview(reservationId).then(row=>{if(current===generation.current)setState(row);}).catch(e=>{if(current===generation.current)setError(message(e));}).finally(()=>{if(current===generation.current)setLoading(false);});return()=>{generation.current++;};},[reservationId,attempt]);
 async function submit(){if(lock.current||!state?.eligible)return;lock.current=true;setBusy(true);setError('');const current=generation.current;try{const review=await submitBookingReview(reservationId,rating,comment);if(current===generation.current){setState(previous=>previous?{...previous,eligible:false,review}:previous);setComment('');}}catch(e){if(current===generation.current)setError(message(e));}finally{lock.current=false;if(current===generation.current)setBusy(false);}}
 const tenant=state?.stay_type==='long_stay';
 return <section aria-label="Your property review" className="space-y-3 rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-4 text-[var(--wh-text)]">
 <h3 className="font-semibold">Your property review</h3>
 {loading&&<p role="status" className="text-sm">Checking your review...</p>}
 {error&&<div role="alert" className="text-sm"><p>{error}</p><Button type="button" variant="outline" disabled={busy} onClick={()=>setAttempt(n=>n+1)}>Refresh review</Button></div>}
 {state?.review?<div role="status" className="space-y-2 text-sm"><p>Your review is saved · {state.review.rating} out of 5</p>{state.review.comment&&<p className="whitespace-pre-wrap break-words">{state.review.comment}</p>}</div>:state?.eligible?<form className="space-y-3" onSubmit={e=>{e.preventDefault();void submit();}}>
 <p className="text-sm text-[var(--wh-text-secondary)]">{tenant?'Share your experience living in this home with future tenants.':'Share your stay experience with future guests.'} Your review is linked to this booking.</p>
 <label className="block space-y-1 text-sm"><span>Your rating</span><select aria-label="Your rating" disabled={busy} value={rating} onChange={e=>setRating(Number(e.target.value))} className="min-h-11 w-full rounded-xl border border-[var(--wh-border)] bg-[var(--wh-elevated)] px-3">{[5,4,3,2,1].map(n=><option key={n} value={n}>{n} out of 5</option>)}</select></label>
 <label className="block space-y-1 text-sm"><span>Your review (optional)</span><textarea disabled={busy} maxLength={2000} rows={4} value={comment} onChange={e=>setComment(e.target.value)} className="w-full rounded-xl border border-[var(--wh-border)] bg-[var(--wh-elevated)] p-3"/></label>
 <Button type="submit" disabled={busy}>{busy?'Saving review...':'Submit review'}</Button></form>:state?<p className="text-sm text-[var(--wh-text-secondary)]">{tenant?'Reviews open after paid rent and verified handover or move-in. You do not need to wait until your tenancy ends.':'Reviews open after a paid, verified stay has ended.'}</p>:null}
 </section>;
}
function message(e:unknown){return e instanceof Error?e.message:(e as {message?:string})?.message||'Review could not be confirmed.';}
