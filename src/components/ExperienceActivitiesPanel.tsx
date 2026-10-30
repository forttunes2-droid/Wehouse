import ExperiencePhotosPanel from '@/components/ExperiencePhotosPanel';
import ExperiencePublicationPanel from '@/components/ExperiencePublicationPanel';
import ExperienceHostBookings from '@/components/ExperienceHostBookings';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { Profile } from '@/types';
import { Button } from '@/components/ui/button';
import ExperienceActivityHistory from '@/components/ExperienceActivityHistory';
import ExperienceSessionsPanel from '@/components/ExperienceSessionsPanel';
import ReviewedDocuments from '@/components/ReviewedDocuments';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useRecordScreenBack } from '@/hooks/useRecordScreenBack';
import { getRegionalDefaults } from '@/lib/regional';
import { displayMoment } from '@/lib/displayDate';
import {
 emptyExperienceDraft, getExperienceActivity, listExperienceActivities, listExperienceCategories,
 saveExperienceActivity, transitionExperienceActivity,
 type ExperienceActivity, type ExperienceDraft, type ExperienceCategory,
} from '@/lib/experienceActivities';

const labels: Record<string,string> = { created:'Draft created',edited:'Draft updated',draft:'Draft',submitted:'In review',changes_required:'Changes requested',declined:'Declined',withdrawn:'Withdrawn',archived:'Archived',approved:'Activity approved' };
const editable = (row: ExperienceActivity | null) => !row || ['draft','changes_required','withdrawn'].includes(row.status);
const control = 'min-h-11 w-full rounded-xl border border-[var(--wh-border)] bg-[var(--wh-elevated)] px-3 py-2 text-sm text-[var(--wh-text)] outline-none focus-visible:ring-2 focus-visible:ring-violet-500';

type Props = { profile: Profile; initialApplication?: { id: string; sequence: number } | null };
export default function ExperienceActivitiesPanel(props: Props) {
 return <Activities key={props.profile.user_id} {...props} />;
}
function Activities({ profile, initialApplication }: Props) {
 const categoryDescriptionId=useId(),participationDescriptionId=useId();
 const [rows,setRows]=useState<ExperienceActivity[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState('');
 const [editor,setEditor]=useState(false),[selected,setSelected]=useState<ExperienceActivity|null>(null);
 const [draft,setDraft]=useState<ExperienceDraft>(emptyExperienceDraft),[savedDraft,setSavedDraft]=useState('');
 const [issues,setIssues]=useState<string[]>([]),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[discard,setDiscard]=useState(false),[archive,setArchive]=useState(false);
 const id=useRef(''),active=useRef(false),generation=useRef(0),pageRows=useRef<ExperienceActivity[]>([]);
 const [hasMore,setHasMore]=useState(false);
 const [categories,setCategories]=useState<ExperienceCategory[]>([]);
 const [categoryError,setCategoryError]=useState('');
 const [linkError,setLinkError]=useState(''),[linkAttempt,setLinkAttempt]=useState(0);
 const [sessionDirty,setSessionDirty]=useState(false);
 const [photoBusy,setPhotoBusy]=useState(false);
 const [bookingsOpen,setBookingsOpen]=useState(false);
 const dirty=editor && JSON.stringify(draft)!==savedDraft;
 const load=useCallback(async (more=false) => {
  const request=++generation.current;
  setLoading(true);setError('');
  try {
   const [activities,choices]=await Promise.allSettled([
    listExperienceActivities(false,more ? pageRows.current.at(-1) : undefined),
    listExperienceCategories(getRegionalDefaults().countryCode),
   ]);
   if(request!==generation.current)return;
   if(choices.status==='fulfilled'){setCategories(choices.value);setCategoryError('');}
   else {setCategories([]);setCategoryError(message(choices.reason));}
   if(activities.status==='rejected')throw activities.reason;
   const next=activities.value;
   setHasMore(next.length===20);pageRows.current=more?[...pageRows.current,...next]:next;
   setRows(previous=>more?[...previous,...next.filter(row=>!previous.some(item=>item.id===row.id))]:next);
  }
  catch(cause){if(request===generation.current)setError(message(cause));}
  finally{if(request===generation.current)setLoading(false);}
 },[]);
 useEffect(()=>{void load();return()=>{generation.current+=1;};},[load]);
 useEffect(()=>{
  if(!initialApplication)return;
  let current=true;setBusy(true);setLinkError('');
  void getExperienceActivity(initialApplication.id).then(row=>{
   if(!current)return;
   id.current=row.id;setSelected(row);setDraft(row.details);setSavedDraft(JSON.stringify(row.details));
   setIssues([]);setNotice('');setEditor(true);
  }).catch(cause=>{if(current)setLinkError(message(cause));}).finally(()=>{if(current)setBusy(false);});
  return()=>{current=false;};
 },[initialApplication,linkAttempt]);
 useEffect(()=>{if(!dirty&&!sessionDirty)return;const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[dirty,sessionDirty]);
 const close=()=>{if(busy||photoBusy)return;if(dirty||sessionDirty){setDiscard(true);return;}setEditor(false);setSelected(null);setError('');};
 useRecordScreenBack(close,editor);
 function open(row:ExperienceActivity|null){const regional=getRegionalDefaults();const details=row?.details||{...emptyExperienceDraft(),country_code:regional.countryCode,timezone:regional.timeZone,host_expertise:profile.worker_experience||''};id.current=row?.id||crypto.randomUUID();setSelected(row);setDraft(details);setSavedDraft(JSON.stringify(details));setIssues([]);setError('');setNotice('');setArchive(false);setEditor(true);}
 async function save(){if(active.current||sessionDirty||photoBusy)return;active.current=true;setBusy(true);setError('');setNotice('');try{const receipt=await saveExperienceActivity(id.current,selected?.revision||0,{...draft,inclusions:draft.inclusions.map(text=>text.trim()).filter(Boolean),exclusions:draft.exclusions.map(text=>text.trim()).filter(Boolean)});setSelected(receipt.activity);setDraft(receipt.activity.details);setSavedDraft(JSON.stringify(receipt.activity.details));setIssues(receipt.issues);setRows(previous=>[receipt.activity,...previous.filter(row=>row.id!==receipt.activity.id)]);setNotice('Draft saved.');}catch(cause){setError(message(cause));}finally{active.current=false;setBusy(false);}}
 async function transition(action:'submit'|'withdraw'|'archive'){if(!selected||active.current||dirty||sessionDirty||photoBusy)return;active.current=true;setBusy(true);setError('');setNotice('');try{const receipt=await transitionExperienceActivity(selected,action);setSelected(receipt);setRows(previous=>[receipt,...previous.filter(row=>row.id!==receipt.id)]);setNotice(action==='submit'?'Your activity was submitted to WeHouse.':action==='withdraw'?(selected.status==='approved'?'Approval withdrawn. Update the activity and submit it for review again.':'Submission withdrawn. You can edit your draft.'):'Activity archived.');}catch(cause){setError(message(cause));}finally{active.current=false;setBusy(false);}}
 function field(key:keyof ExperienceDraft,value:string|number|null|string[]){setDraft(previous=>({...previous,[key]:value}));setNotice('');}
 const errors=error?<p role="alert" className="rounded-xl border border-red-500/20 bg-red-500/5 p-3 text-sm text-red-700 dark:text-red-300">{error}</p>:null;
 const categoryFeedback=categoryError?<div className="space-y-2"><p role="alert" className="text-sm text-red-700 dark:text-red-300">Categories could not be loaded. Your saved activities remain available. {categoryError}</p><Button type="button" variant="outline" disabled={loading||busy} onClick={()=>void load()}>Retry categories</Button></div>:null;
 const linkFeedback=linkError?<div className="space-y-2"><p role="alert" className="text-sm text-red-700 dark:text-red-300">{linkError}</p><Button type="button" variant="outline" disabled={busy||sessionDirty||photoBusy} onClick={()=>setLinkAttempt(value=>value+1)}>Retry application link</Button></div>:null;
 if(bookingsOpen)return <ExperienceHostBookings userId={profile.user_id} onBack={()=>setBookingsOpen(false)}/>;
 if(editor)return <section className="space-y-5 text-[var(--wh-text)]">
  <header className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 flex-1"><h2 className="break-words text-xl font-semibold">{selected?draft.title||'Activity application':'Create an Experience'}</h2><p className="mt-1 text-sm text-[var(--wh-text-secondary)] [overflow-wrap:anywhere]">{selected?labels[selected.status]:'Private draft'} · {selected?`Reference ${selected.id}`:'Save your idea before submitting it for review.'}</p></div><Button type="button" variant="outline" disabled={busy} onClick={close}>Back to activities</Button></header>
  <p className="text-sm leading-6 text-[var(--wh-text-secondary)]">Describe the activity you will guide and what participants will do with you. WeHouse reviews the expertise and any venue responsibility relevant to this Experience. Your application stays private during review.</p>
  {selected?.status==='approved'&&<p className="rounded-xl bg-[var(--wh-elevated)] p-4 text-sm leading-6">Activity review approved. Manage publication and dates below. Revising activity details requires a new review.</p>}
  {errors}{categoryFeedback}{linkFeedback}{notice&&<p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">{notice}</p>}
  {issues.length>0&&<section aria-label="Application requirements" className="rounded-xl border border-[var(--wh-border)] p-4"><h3 className="font-semibold">Complete before submitting</h3><ul className="mt-2 list-disc space-y-1 pl-5 text-sm">{issues.map(issue=><li key={issue}>{issue.replaceAll('_',' ')}</li>)}</ul></section>}
  <form onSubmit={event=>{event.preventDefault();void save();}} className="space-y-5">
   <fieldset disabled={busy||sessionDirty||photoBusy||!editable(selected)} className="grid gap-4 rounded-2xl border border-[var(--wh-border)] bg-[var(--wh-surface)] p-4 sm:grid-cols-2">
    <legend className="px-1 font-semibold">Activity details</legend>
    <Field label="Activity name"><input className={control} maxLength={120} value={draft.title} onChange={event=>field('title',event.target.value)}/></Field>
    <Field label="Category"><select aria-label="Category" aria-describedby={categories.some(item=>item.code===draft.category)?categoryDescriptionId:undefined} className={control} value={draft.category} onChange={event=>field('category',event.target.value)}><option value="">Choose a category</option>{draft.category&&!categories.some(item=>item.code===draft.category)&&<option value={draft.category}>{draft.category.replaceAll('_',' ')} (not accepting submissions)</option>}{categories.map(item=><option key={item.code} value={item.code}>{item.name}</option>)}</select>{categories.find(item=>item.code===draft.category)&&<span id={categoryDescriptionId} className="block text-sm leading-6 text-[var(--wh-text-secondary)]">{categories.find(item=>item.code===draft.category)?.description} Examples: {categories.find(item=>item.code===draft.category)?.examples.join(', ')}.</span>}</Field>
    <Field label="What participants will do" wide><textarea aria-label="What participants will do" aria-describedby={participationDescriptionId} className={control} rows={5} maxLength={6000} value={draft.what_to_expect} onChange={event=>field('what_to_expect',event.target.value)}/><span id={participationDescriptionId} className="text-sm leading-6 text-[var(--wh-text-secondary)]">For a garden visit or tour, explain what you will guide participants through, the access included and how the booked time is used.</span></Field>
    <Field label="Your expertise or venue responsibility" wide><textarea className={control} rows={4} maxLength={4000} value={draft.host_expertise} onChange={event=>field('host_expertise',event.target.value)}/></Field>
    <Field label="Duration in minutes"><input className={control} type="number" min={15} max={1440} step={1} value={draft.duration_minutes??''} onChange={event=>field('duration_minutes',event.target.value?Number(event.target.value):null)}/></Field>
    <Field label="Maximum participants"><input className={control} type="number" min={1} max={100} step={1} value={draft.max_group_size??''} onChange={event=>field('max_group_size',event.target.value?Number(event.target.value):null)}/></Field>
   </fieldset>
   <fieldset disabled={busy||sessionDirty||photoBusy||!editable(selected)} className="grid gap-4 rounded-2xl border border-[var(--wh-border)] bg-[var(--wh-surface)] p-4 sm:grid-cols-2">
    <legend className="px-1 font-semibold">Location and meeting point</legend>
    <Field label="Activity country"><input className={control} readOnly value={draft.country_code===getRegionalDefaults().countryCode?getRegionalDefaults().countryName:draft.country_code}/></Field>
    {(['state','local_area','city','meeting_area'] as const).map(key=><Field key={key} label={{state:'State or region',local_area:'Local government or district',city:'City or town',meeting_area:'Meeting area'}[key]}><input className={control} maxLength={250} value={draft[key]} onChange={event=>field(key,event.target.value)}/></Field>)}
    <Field label="Activity timezone"><input className={control} readOnly value={draft.timezone}/></Field>
   </fieldset>
   <fieldset disabled={busy||sessionDirty||photoBusy||!editable(selected)} className="grid gap-4 rounded-2xl border border-[var(--wh-border)] bg-[var(--wh-surface)] p-4 sm:grid-cols-2">
    <legend className="px-1 font-semibold">Participation and inclusions</legend>
    <Field label="What is included (one item per line)" wide><textarea className={control} rows={3} value={draft.inclusions.join('\n')} onChange={event=>field('inclusions',event.target.value.split('\n'))}/></Field>
    <Field label="What is not included (one item per line)" wide><textarea className={control} rows={3} value={draft.exclusions.join('\n')} onChange={event=>field('exclusions',event.target.value.split('\n'))}/></Field>
    <Field label="Age, ability, equipment and participation requirements" wide><textarea className={control} rows={3} maxLength={4000} value={draft.participation_requirements} onChange={event=>field('participation_requirements',event.target.value)}/></Field>
    <Field label="Accessibility and assistance available" wide><textarea className={control} rows={3} maxLength={4000} value={draft.accessibility_information} onChange={event=>field('accessibility_information',event.target.value)}/></Field>
   </fieldset>
   <div className="flex flex-wrap gap-3">{editable(selected)&&<Button type="submit" disabled={busy||sessionDirty||photoBusy}>{busy?'Saving...':'Save draft'}</Button>}{selected&&editable(selected)&&<Button type="button" variant="outline" disabled={busy||sessionDirty||photoBusy||dirty||issues.length>0} onClick={()=>void transition('submit')}>Submit for review</Button>}{selected&&['submitted','approved'].includes(selected.status)&&<Button type="button" variant="outline" disabled={busy||sessionDirty||photoBusy} onClick={()=>void transition('withdraw')}>{selected.status==='approved'?'Revise approved activity':'Withdraw submission'}</Button>}{selected&&['draft','withdrawn','changes_required','declined'].includes(selected.status)&&<Button type="button" variant="outline" disabled={busy||sessionDirty||photoBusy||dirty} onClick={()=>setArchive(true)}>Archive activity</Button>}</div>
   {dirty&&<p className="text-sm text-[var(--wh-text-secondary)]">Save your changes before submitting.</p>}
  </form>
  {selected&&!dirty&&selected.status==='approved'&&<ExperiencePublicationPanel key={`publication:${selected.id}:${selected.revision}`} activity={selected}/>}
  {selected&&!dirty&&<ExperiencePhotosPanel activity={selected} disabled={busy||sessionDirty} onBusyChange={setPhotoBusy}/>}
  {selected&&!dirty&&<ReviewedDocuments key={`evidence:${selected.id}:${selected.revision}`} requestId={selected.id} accountId={profile.user_id} kind="experience"/>}
  {selected&&!dirty&&<ExperienceSessionsPanel key={selected.id} activity={selected} onDirtyChange={setSessionDirty}/>}
  {selected&&<ExperienceActivityHistory key={`history:${selected.id}:${selected.revision}`} id={selected.id}/>}
  <Dialog open={archive} onOpenChange={setArchive}><DialogContent><DialogTitle>Archive this activity?</DialogTitle><DialogDescription>The saved application and review history will be retained. You will need a new application to offer a different activity.</DialogDescription><div className="flex flex-wrap gap-3"><Button type="button" variant="outline" onClick={()=>setArchive(false)}>Keep activity</Button><Button type="button" onClick={()=>{setArchive(false);void transition('archive');}}>Archive activity</Button></div></DialogContent></Dialog>
  <Dialog open={discard} onOpenChange={setDiscard}><DialogContent><DialogTitle>Discard unsaved changes?</DialogTitle><DialogDescription>Your last saved draft will remain available.</DialogDescription><div className="flex flex-wrap gap-3"><Button type="button" variant="outline" onClick={()=>setDiscard(false)}>Keep editing</Button><Button type="button" onClick={()=>{setDiscard(false);setEditor(false);setSelected(null);setError('');}}>Discard changes</Button></div></DialogContent></Dialog>
 </section>;
 return <section className="space-y-4 text-[var(--wh-text)]"><header className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-semibold">Your Experiences</h2><p className="mt-1 text-sm text-[var(--wh-text-secondary)]">Create activity applications and follow WeHouse review.</p></div><div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={busy||loading} onClick={()=>setBookingsOpen(true)}>View Experience bookings</Button><Button type="button" disabled={busy||loading||categories.length===0} onClick={()=>open(null)}>Create an Experience</Button></div></header>{errors}{categoryFeedback}{linkFeedback}{error&&<Button type="button" variant="outline" onClick={()=>void load()}>Try again</Button>}{loading&&<p role="status" className="text-sm">Loading activities...</p>}{!loading&&!error&&!categoryError&&categories.length===0&&<p className="text-sm text-[var(--wh-text-secondary)]">Activity applications are not available in this country yet.</p>}{!loading&&!error&&rows.length===0&&categories.length>0&&<p className="rounded-2xl border border-dashed border-[var(--wh-border)] p-6 text-sm text-[var(--wh-text-secondary)]">No Experiences yet. Start with an activity or visit you can guide safely.</p>}<div className="divide-y divide-[var(--wh-border)]">{rows.map(row=><button type="button" key={row.id} disabled={busy||sessionDirty||photoBusy} onClick={()=>open(row)} className="wh-motion-control flex min-h-20 w-full items-start justify-between gap-4 py-4 text-left"><span className="min-w-0"><span className="block break-words font-semibold">{row.details.title||'Untitled activity'}</span><span className="mt-1 block text-sm text-[var(--wh-text-secondary)]">Updated {displayMoment(row.updated_at)}</span></span><span className="shrink-0 text-sm text-[var(--wh-accent-text)]">{labels[row.status]}</span></button>)}</div>{hasMore&&<Button type="button" variant="outline" disabled={loading} onClick={()=>void load(true)}>Load more</Button>}</section>;
}
function Field({label,wide=false,children}:{label:string;wide?:boolean;children:React.ReactNode}){return <label className={`block min-w-0 space-y-2 ${wide?'sm:col-span-2':''}`}><span className="block text-sm font-medium">{label}</span>{children}</label>;}

function message(cause:unknown){return cause instanceof Error?cause.message:(cause as {message?:string})?.message||'The activity action could not be confirmed. Refresh before retrying.';}
