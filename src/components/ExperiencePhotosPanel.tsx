import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { ExperienceActivity } from '@/lib/experienceActivities';
import { changeExperiencePhoto, experiencePhotoPreviews, finishExperiencePhoto, listExperiencePhotos, uploadExperiencePhoto, type ExperiencePhoto } from '@/lib/experiencePhotos';

export default function ExperiencePhotosPanel({activity,review=false,disabled=false,onBusyChange,onChanged}:{activity:ExperienceActivity;review?:boolean;disabled?:boolean;onBusyChange?:(busy:boolean)=>void;onChanged?:()=>void}){
 const [rows,setRows]=useState<ExperiencePhoto[]>([]),[urls,setUrls]=useState<Record<string,string>>({}),[loaded,setLoaded]=useState<Record<string,boolean>>({});
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[caption,setCaption]=useState(''),[attempt,setAttempt]=useState(0);
 const [notes,setNotes]=useState<Record<string,string>>({});const lock=useRef(false),generation=useRef(0);
 const editable=!review&&!disabled&&['draft','changes_required','withdrawn'].includes(activity.status);
 useEffect(()=>{onBusyChange?.(busy);return()=>onBusyChange?.(false);},[busy,onBusyChange]);
 useEffect(()=>{
  const request=++generation.current;setLoading(true);setError('');setRows([]);setUrls({});setLoaded({});
  void listExperiencePhotos(activity.id).then(async items=>{
   if(request!==generation.current)return;setRows(items);
   const previews=await experiencePhotoPreviews(items);if(request===generation.current)setUrls(previews);
  }).catch(cause=>{if(request===generation.current)setError(message(cause));}).finally(()=>{if(request===generation.current)setLoading(false);});
  return()=>{generation.current++;};
 },[activity.id,activity.revision,attempt]);
 async function act(work:()=>Promise<unknown>,success:string){
  if(lock.current||disabled)return;lock.current=true;setBusy(true);setError('');setNotice('');const request=generation.current;
  try{await work();if(request!==generation.current)return;setNotice(success);setAttempt(n=>n+1);onChanged?.();}
  catch(cause){if(request===generation.current){setError(message(cause));}}
  finally{lock.current=false;if(request===generation.current)setBusy(false);}
 }
 const control='min-h-11 w-full rounded-xl border border-[var(--wh-border)] bg-[var(--wh-elevated)] p-3 text-sm';
 return <section aria-label="Activity photos" className="space-y-4 rounded-2xl border border-[var(--wh-border)] bg-[var(--wh-surface)] p-4 sm:p-5">
  <header className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">Activity photos</h3><p className="mt-1 max-w-xl text-sm leading-6 text-[var(--wh-text-secondary)]">Show the real activity, venue and what participants can expect. Photos stay private during review. Do not upload identity documents or private guest information here.</p></div><Button type="button" variant="outline" disabled={busy||disabled} onClick={()=>setAttempt(n=>n+1)}>Refresh photos</Button></header>
  {editable&&<div className="space-y-3"><label className="block space-y-2 text-sm"><span>What does this photo show?</span><input className={control} maxLength={240} value={caption} disabled={busy||disabled} onChange={e=>setCaption(e.target.value)}/></label><label className={`inline-flex min-h-11 cursor-pointer items-center rounded-xl bg-violet-600 px-4 text-sm font-semibold text-white ${busy?'pointer-events-none opacity-50':''}`}>Add activity photo<input aria-label="Add activity photo" type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={busy||caption.trim().length<5||rows.length>=20} onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void act(()=>uploadExperiencePhoto(activity,file,caption),'Photo submitted privately for review.');}}/></label><p className="text-xs leading-5 text-[var(--wh-text-secondary)]">JPG, PNG or WebP up to 10 MB. Prepared photos are optimized to at most 2 MB. Up to 20 active photos. Add only photos you have permission to use.</p></div>}
  {!editable&&!review&&<p className="text-sm text-[var(--wh-text-secondary)]">{disabled?'Finish the current action before changing photos.':'Withdraw the application before changing photos.'}</p>}
  {loading&&<p role="status" className="text-sm">Loading activity photos...</p>}
  {error&&<p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
  {notice&&<p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">{notice}</p>}
  {!loading&&!error&&!rows.length&&<p className="text-sm text-[var(--wh-text-secondary)]">No activity photos yet.</p>}
  <div className="grid gap-4 sm:grid-cols-2">{rows.map(row=><article key={row.id} className="min-w-0 overflow-hidden rounded-xl border border-[var(--wh-border)]">
   {urls[row.object_path]?<img src={urls[row.object_path]} alt={row.caption} className="aspect-[4/3] w-full object-cover" onLoad={()=>setLoaded(previous=>({...previous,[row.id]:true}))} onError={()=>{setLoaded(previous=>({...previous,[row.id]:false}));setError('A photo preview could not be loaded. Refresh photos before reviewing.');}}/>:<div className="flex aspect-[4/3] items-center justify-center bg-[var(--wh-elevated)] text-sm text-[var(--wh-text-secondary)]">{row.status==='uploading'?'Upload unfinished':'Preview unavailable'}</div>}
   <div className="space-y-3 p-3"><div className="flex flex-wrap items-start justify-between gap-2"><p className="break-words text-sm font-medium">{row.caption}</p><span className="rounded-full bg-[var(--wh-elevated)] px-2 py-1 text-xs">{row.status==='submitted'?'Awaiting review':row.status==='uploading'?'Upload unfinished':row.status==='approved'?'Photo approved':'Changes needed'}</span></div>
    {!row.context_current&&<p className="text-sm text-amber-800 dark:text-amber-200">The activity changed. The host must submit this photo for review against the current details.</p>}
    {row.review_note&&<p className="whitespace-pre-wrap break-words text-sm text-[var(--wh-text-secondary)]">{row.review_note}</p>}
    {editable&&<div className="flex flex-wrap gap-2">{row.status==='uploading'&&<Button type="button" variant="outline" disabled={busy||disabled} onClick={()=>void act(()=>finishExperiencePhoto(row),'Photo submitted privately for review.')}>Confirm uploaded photo</Button>}{!row.context_current&&row.status!=='uploading'&&<Button type="button" variant="outline" disabled={busy||disabled} onClick={()=>void act(()=>changeExperiencePhoto(row,'refresh_context'),'Photo submitted against current activity details.')}>Use for revised activity</Button>}<Button type="button" variant="outline" disabled={busy||disabled} onClick={()=>void act(()=>changeExperiencePhoto(row,'archive'),'Photo archived.')}>Archive photo</Button></div>}
    {review&&activity.status==='submitted'&&row.status!=='uploading'&&<div className="space-y-2"><label className="block space-y-1 text-sm"><span>Photo review note</span><textarea aria-label={`Photo review note: ${row.caption}`} className={control} maxLength={2000} rows={2} disabled={busy||disabled} value={notes[row.id]||''} onChange={e=>setNotes(previous=>({...previous,[row.id]:e.target.value}))}/></label><div className="flex flex-wrap gap-2"><Button type="button" disabled={busy||disabled||!loaded[row.id]||!row.context_current||(notes[row.id]||'').trim().length<5} onClick={()=>void act(()=>changeExperiencePhoto(row,'approved',notes[row.id]),'Photo approved. Activity publication still requires its final review.')}>Approve photo</Button><Button type="button" variant="outline" disabled={busy||disabled||!row.context_current||(notes[row.id]||'').trim().length<5} onClick={()=>void act(()=>changeExperiencePhoto(row,'rejected',notes[row.id]),'Photo correction requested.')}>Request replacement</Button></div></div>}
   </div>
  </article>)}</div>
 </section>;
}
function message(cause:unknown){return cause instanceof Error?cause.message:(cause as {message?:string})?.message||'Photo action could not be confirmed. Refresh before retrying.';}
