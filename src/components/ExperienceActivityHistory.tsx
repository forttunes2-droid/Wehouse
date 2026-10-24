import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { displayMoment } from '@/lib/displayDate';
import { getExperienceActivityHistory, type ExperienceActivityEvent } from '@/lib/experienceActivities';
const labels:Record<string,string>={created:'Draft created',edited:'Draft updated',submitted:'Submitted for review',changes_required:'Changes requested',declined:'Declined',withdrawn:'Withdrawn',archived:'Archived',approved:'Activity review approved'};
export default function ExperienceActivityHistory({id}:{id:string}){
 const [rows,setRows]=useState<ExperienceActivityEvent[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(true),[attempt,setAttempt]=useState(0);
 useEffect(()=>{let active=true;setLoading(true);setError('');void getExperienceActivityHistory(id).then(data=>{if(active)setRows(data);}).catch(cause=>{if(active)setError(message(cause));}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[id,attempt]);
 return <section className="space-y-3 rounded-2xl border border-[var(--wh-border)] bg-[var(--wh-surface)] p-4"><h3 className="font-semibold">Application history</h3>{loading?<p role="status" className="text-sm">Loading history...</p>:error?<div role="alert"><p className="text-sm">{error}</p><Button type="button" variant="outline" onClick={()=>setAttempt(value=>value+1)}>Try again</Button></div>:<ol className="space-y-3">{rows.map(row=><li key={row.id} className="text-sm"><p className="font-medium">{labels[row.action]||row.action.replaceAll('_',' ')} · {displayMoment(row.created_at)}</p>{row.note&&<p className="mt-1 whitespace-pre-wrap break-words text-[var(--wh-text-secondary)]">{row.note}</p>}</li>)}</ol>}</section>;
}
function message(cause:unknown){return cause instanceof Error?cause.message:(cause as {message?:string})?.message||'Activity history could not be loaded. Please try again.';}
