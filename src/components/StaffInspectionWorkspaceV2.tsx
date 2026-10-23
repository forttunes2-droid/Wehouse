import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { withTimeout } from '@/lib/withTimeout';
import { createInspectionEvidenceBatch } from '@/lib/inspectionEvidence';
import { supabase } from '@/lib/supabase';
import { uploadListingCandidateImage, uploadListingCandidateVideo } from '@/lib/supabase/listings';
import { ListingMediaImage, ListingMediaVideo, useListingMediaUrl } from './ListingCandidateMedia';
import WeHouseSelect from '@/components/WeHouseSelect';
import MediaViewer from '@/components/MediaViewer';
import VideoPlayer from '@/components/VideoPlayer';
import type { Profile } from '@/types';
import PropertySpaceSummary from '@/components/PropertySpaceSummary';
import { homeStyleLabel } from '@/lib/homeStyles';

type InspectionRow = {
  home_style?:string|null;
  id:string; _source?:string; status:string; property_address?:string|null;
  property_city?:string|null; property_state?:string|null; owner_name?:string|null;
  owner_phone?:string|null; scheduled_date?:string|null; gps_latitude?:number|null;
  gps_longitude?:number|null; location_accuracy_m?:number|null; photo_urls?:string[]|null;
  video_urls?:string[]|null; notes?:string|null; completed_at?:string|null;
  review_status?:string|null; review_note?:string|null;
  space_scope?:string|null;space_label?:string|null;shared_areas?:string[]|null;
};
type Preview = { file:File; url:string };
type InspectionFilter = 'pending'|'scheduled'|'in_progress'|'completed'|'approved'|'all';
const INSPECTION_FILTERS: Array<{value:InspectionFilter;label:string;description?:string}> = [
  {value:'all',label:'All statuses'},
  {value:'pending',label:'Pending'},
  {value:'scheduled',label:'Scheduled'},
  {value:'in_progress',label:'In progress'},
  {value:'completed',label:'Completed'},
  {value:'approved',label:'Approved'},
];

export default function StaffInspectionWorkspaceV2({ profile }:{ profile:Profile }) {
  const mediaInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);
  const [rows,setRows] = useState<InspectionRow[]>([]);
  const [selected,setSelected] = useState<InspectionRow|null>(null);
  const [search,setSearch] = useState('');
  const [filter,setFilter] = useState<InspectionFilter>('all');
  const [report,setReport] = useState('');
  const [condition,setCondition] = useState('');
  const [media,setMedia] = useState<File[]>([]);
  const [lat,setLat] = useState('');
  const [lng,setLng] = useState('');
  const [accuracy,setAccuracy] = useState<number|null>(null);
  const [loading,setLoading] = useState(true);
  const [loadError,setLoadError] = useState('');
  const loadGeneration=useRef(0);
  const [saving,setSaving] = useState(false);
  const mutationPending = useRef(false);
  const evidenceBatch = useRef(createInspectionEvidenceBatch());
  const [locating,setLocating] = useState(false);

  const load = useCallback(async()=>{
    const request=++loadGeneration.current;
    setLoading(true);setLoadError('');
    try {
      const {data,error}=await withTimeout(supabase.rpc('get_my_inspections',{p_field_officer_id:profile.user_id}),15000,'Assigned inspections could not be confirmed. Try again.');
      if(request!==loadGeneration.current)return;
      if(error)throw error;
      if(!Array.isArray(data)||data.some(row=>!row||typeof row.id!=='string'||typeof row.status!=='string'))throw new Error('Assigned inspections could not be confirmed. Try again.');
      setRows(data as InspectionRow[]);
    } catch(cause) {
      if(request===loadGeneration.current)setLoadError((cause as Error)?.message||'Assigned inspections could not be loaded. Try again.');
    } finally {
      if(request===loadGeneration.current)setLoading(false);
    }
  },[profile.user_id]);

  useEffect(()=>{
    setRows([]);setSelected(null);setReport('');setCondition('');setMedia([]);
    void load();
    return ()=>{loadGeneration.current++;};
  },[load]);
  const previews=useMemo<Preview[]>(()=>media.map(file=>({file,url:URL.createObjectURL(file)})),[media]);
  useEffect(()=>()=>previews.forEach(item=>URL.revokeObjectURL(item.url)),[previews]);
  const shown=useMemo(()=>rows.filter(row=>{
    const status=String(row.status||'pending');
    const matchesStatus=filter==='all'||status===filter;
    const query=search.trim().toLowerCase();
    const matchesSearch=!query||[row.property_address,row.space_label,row.property_city,row.property_state,row.owner_name,row.status].filter(Boolean).join(' ').toLowerCase().includes(query);
    return matchesStatus&&matchesSearch;
  }).sort((a,b)=>Number(done(a))-Number(done(b))),[rows,search,filter]);

  function open(row:InspectionRow){
    if(mutationPending.current)return;
    evidenceBatch.current=createInspectionEvidenceBatch();
    setSelected(row); setReport(row.review_status==='changes_requested'?(row.notes||''):''); setCondition(''); setMedia([]);
    setLat(row.gps_latitude==null?'':String(row.gps_latitude));
    setLng(row.gps_longitude==null?'':String(row.gps_longitude));
    setAccuracy(row.location_accuracy_m==null?null:Number(row.location_accuracy_m));
  }
  function chooseMedia(list:FileList|null){
    if(!list||mutationPending.current)return;
    const picked=Array.from(list).filter(file=>file.type.startsWith('image/')||file.type.startsWith('video/'));
    if(media.length+picked.length>12){toast.error('Add up to 12 new evidence files per submission');return;}
    setMedia(current=>[...current,...picked].slice(0,12));
    if(mediaInput.current)mediaInput.current.value='';
    if(videoInput.current)videoInput.current.value='';
  }
  function capture(){
    if(!navigator.geolocation)return toast.error('Location is not supported on this device');
    setLocating(true);
    navigator.geolocation.getCurrentPosition(position=>{
      setLocating(false); setLat(position.coords.latitude.toFixed(7)); setLng(position.coords.longitude.toFixed(7));
      setAccuracy(Number(position.coords.accuracy||0)); toast.success('Property location captured');
    },error=>{setLocating(false);toast.error(error.message||'Could not get the property location')},{enableHighAccuracy:true,timeout:20000,maximumAge:0});
  }
  async function saveLocation(){
    if(!selected||selected._source!=='partner'||mutationPending.current)return;
    const latitude=Number(lat),longitude=Number(lng);
    if(!lat.trim()||!lng.trim()||!Number.isFinite(latitude)||latitude<-90||latitude>90||!Number.isFinite(longitude)||longitude<-180||longitude>180)return toast.error('Choose a valid property location');
    mutationPending.current=true;setSaving(true);
    try {
      const {data,error}=await withTimeout(supabase.rpc('field_officer_update_inspection_location',{p_inspection_id:selected.id,p_latitude:latitude,p_longitude:longitude,p_accuracy_m:accuracy}),15000,'Location save could not be confirmed. Retry to confirm.');
      if(error)throw error;
      if(data!==true)throw new Error('Location save could not be confirmed. Retry to confirm.');
      toast.success('Property location saved');
    }catch(error:unknown){toast.error(error instanceof Error?error.message:'Location could not be saved');}
    finally{mutationPending.current=false;setSaving(false);}
  }
  async function update(status:'in_progress'|'completed'){
    if(!selected||mutationPending.current)return;
    if(status==='completed'&&!report.trim())return toast.error('Add the inspection report');
    const fieldPhotoCount=(selected.photo_urls||[]).length+media.filter(file=>file.type.startsWith('image/')).length;
    if(status==='completed'&&selected._source==='partner'&&fieldPhotoCount<4)return toast.error(`Add ${4-fieldPhotoCount} more Field Operations photo${4-fieldPhotoCount===1?'':'s'}`);
    mutationPending.current=true;setSaving(true);
    try{
      if(status==='completed'&&media.length){
        const {photoUrls,videoUrls}=await evidenceBatch.current(media,async file=>{
          const uploaded=file.type.startsWith('video/')?await uploadListingCandidateVideo(file,{kind:'field',inspectionId:selected.id}):await uploadListingCandidateImage(file,{kind:'field',inspectionId:selected.id});
          if(uploaded.error||!uploaded.url)throw new Error(uploaded.error?.message||`Could not upload ${file.name}`);
          return uploaded.url;
        });
        const saved=await withTimeout(supabase.rpc('field_officer_add_inspection_media',{p_inspection_id:selected.id,p_photo_urls:photoUrls,p_video_urls:videoUrls}),15000,'Evidence receipt could not be confirmed. Retry with these files.');
        if(saved.error)throw saved.error;
        if(saved.data!==true)throw new Error('Evidence receipt could not be confirmed. Retry with these files.');
      }
      const {data,error}=await withTimeout(supabase.rpc('update_inspection_status',{p_inspection_id:selected.id,p_new_status:status,p_source:selected._source||'user',p_report:status==='completed'?report.trim():null,p_condition:status==='completed'?(condition.trim()||null):null}),15000,'Inspection save could not be confirmed. Retry to confirm.');
      if(error)throw error;
      if(data!==true)throw new Error('Inspection save could not be confirmed. Retry to confirm.');
      toast.success(status==='completed'?'Inspection evidence submitted for review':'Inspection started');
      setSelected(status==='in_progress'?{...selected,status}:null); void load();
    }catch(error:unknown){toast.error(error instanceof Error?error.message:'Inspection could not be saved')}finally{mutationPending.current=false;setSaving(false)}
  }

  if(selected){
    const complete=done(selected);
    const requiresPhotos=selected._source==='partner';
    const fieldPhotoCount=(selected.photo_urls||[]).length+media.filter(file=>file.type.startsWith('image/')).length;
    return <div className="space-y-5">
      <button onClick={()=>setSelected(null)} className="text-xs font-semibold text-[var(--wh-accent-text)]">← Inspections</button>
      <header className="border-b border-[var(--wh-border-subtle)] pb-4"><Head row={selected}/><p className="mt-2 text-xs text-[var(--wh-text-muted)]">{[selected.property_city,selected.property_state].filter(Boolean).join(', ')} · {selected.owner_name||selected.owner_phone||'Contact unavailable'}</p></header>
      <PropertySpaceSummary record={selected}/>
      {selected.review_note&&<section role="status" className="space-y-2 rounded-xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-4"><h2 className="text-sm font-semibold">{selected.review_status==='changes_requested'?'Changes requested by Property Operations':'Property Operations review'}</h2><p className="whitespace-pre-wrap text-sm text-[var(--wh-text-secondary)]">{selected.review_note}</p></section>}
      {complete?<CompletedInspection row={selected}/>:selected.status!=='in_progress'?<section className="py-10 text-center"><h2 className="text-xl font-bold">Ready for the property visit?</h2><p className="mx-auto mt-2 max-w-sm text-xs leading-5 text-[var(--wh-text-muted)]">Start only when you are ready to inspect this assigned property. The report and evidence workspace opens next.</p><button onClick={()=>void update('in_progress')} disabled={saving} className="mt-5 h-12 rounded-full bg-violet-500 px-8 text-xs font-semibold">Start inspection</button></section>:<>
        {selected._source==='partner'&&<section className="space-y-3 border-b border-[var(--wh-border-subtle)] pb-5"><SectionTitle step="1" title="Confirm the property location"/><div className="grid grid-cols-2 gap-2"><Coordinate label="Latitude" value={lat} set={setLat}/><Coordinate label="Longitude" value={lng} set={setLng}/></div><div className="grid grid-cols-2 gap-2"><button onClick={capture} disabled={locating} className="h-11 rounded-xl border border-violet-500/20 text-xs font-semibold text-[var(--wh-accent-text)]">{locating?'Finding location…':'Use current property location'}</button><button onClick={()=>void saveLocation()} disabled={saving} className="h-11 rounded-xl bg-violet-500 text-xs font-semibold">Save location</button></div>{accuracy!=null&&<p className="text-xs text-[var(--wh-text-muted)]">Location accurate to about {Math.round(accuracy)} m</p>}</section>}
        <section className="space-y-3 border-b border-[var(--wh-border-subtle)] pb-5"><SectionTitle step={selected._source==='partner'?'2':'1'} title="Record what you found"/><textarea value={report} onChange={event=>setReport(event.target.value)} rows={5} placeholder="Inspection report" className="w-full rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-4 text-xs leading-5 outline-none focus:border-violet-500/40"/><input value={condition} onChange={event=>setCondition(event.target.value)} placeholder="Property condition (optional)" className="h-12 w-full rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] px-4 text-xs outline-none focus:border-violet-500/40"/></section>
        <section className="space-y-3"><div className="flex items-start justify-between gap-3"><SectionTitle step={selected._source==='partner'?'3':'2'} title="Add inspection evidence"/><div className="flex shrink-0 gap-2"><button type="button" onClick={()=>mediaInput.current?.click()} className="rounded-full border border-violet-500/30 px-3 py-2 text-xs font-semibold text-[var(--wh-accent-text)]">Add photos</button><button type="button" onClick={()=>videoInput.current?.click()} className="rounded-full bg-violet-500 px-3 py-2 text-xs font-semibold">Add video</button></div></div><input ref={mediaInput} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={event=>chooseMedia(event.target.files)}/><input ref={videoInput} type="file" accept="video/mp4,video/quicktime,video/webm" className="hidden" onChange={event=>chooseMedia(event.target.files)}/><p className="text-xs text-[var(--wh-text-muted)]">{requiresPhotos?'Add at least 4 independent photos from this visit. Videos are optional.':'Photos and videos are optional supporting evidence for this customer visit.'}</p>{previews.length?<><div className="flex items-center justify-between"><p className="text-xs font-medium">{fieldPhotoCount}{requiresPhotos?'/4 required photos':' visit photos'} · {previews.length} new file{previews.length===1?'':'s'}</p><button type="button" onClick={()=>setMedia([])} className="text-xs text-[var(--wh-danger-text)]">Remove all</button></div><div className="grid grid-cols-3 gap-1.5">{previews.map(({file,url},index)=><div key={`${file.name}-${file.lastModified}-${index}`} className="relative aspect-square overflow-hidden rounded-xl bg-black">{file.type.startsWith('video/')?<VideoPlayer src={url} className="h-full w-full object-cover"/>:<img src={url} alt={`Selected evidence ${index+1}`} className="h-full w-full object-cover"/>}<button type="button" onClick={()=>setMedia(current=>current.filter((_,itemIndex)=>itemIndex!==index))} aria-label={`Remove ${file.name}`} className="absolute right-1 top-1 grid h-7 w-7 place-items-center rounded-full bg-black/75 text-sm">×</button><span className="absolute bottom-1 left-1 rounded-full bg-black/70 px-1.5 py-0.5 text-xs">{file.type.startsWith('video/')?'VIDEO':'PHOTO'}</span></div>)}</div></>:<button type="button" onClick={()=>mediaInput.current?.click()} className="grid min-h-36 w-full place-items-center rounded-2xl border border-dashed border-[var(--wh-border-subtle)] text-center"><span><span className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-violet-500/10 text-xl text-[var(--wh-accent-text)]">＋</span><span className="mt-2 block text-xs text-[var(--wh-text-secondary)]">{requiresPhotos&&fieldPhotoCount<4?'Add 4 visit photos':'Add more visit photos'}</span></span></button>}<p className="text-xs text-[var(--wh-text-secondary)]">{requiresPhotos?'These visit photos are separate from the Property Partner’s submission. Property Operations reviews them before publication.':'The submitted report records the customer visit. It does not approve or publish a property.'}</p><button onClick={()=>void update('completed')} disabled={saving||!report.trim()||(selected._source==='partner'&&fieldPhotoCount<4)} className="h-12 w-full rounded-full bg-violet-500 text-xs font-semibold disabled:opacity-40">{saving?`Uploading ${media.length} file${media.length===1?'':'s'}…`:requiresPhotos&&fieldPhotoCount<4?`${4-fieldPhotoCount} more photo${4-fieldPhotoCount===3?'s':''} required`:requiresPhotos?'Submit inspection for review':'Submit visit report'}</button></section>
      </>}
    </div>;
  }

  const active=rows.filter(row=>!done(row)).length;
  return <div className="space-y-4"><header><h2 className="text-lg font-bold">Inspections</h2><p className="mt-1 text-xs text-[var(--wh-text-muted)]">{active} active · {rows.length-active} completed</p></header><div className="flex items-center gap-3"><WeHouseSelect value={filter} options={INSPECTION_FILTERS} onChange={setFilter} title="Filter inspections" eyebrow="Status filter" ariaLabel="Filter inspections by status"/><input value={search} onChange={event=>setSearch(event.target.value)} aria-label="Search inspections" placeholder="Search address or Property Partner" className="h-10 min-w-0 flex-1 border-b border-[var(--wh-border-subtle)] bg-transparent px-1 text-xs outline-none"/></div>{loadError?<section role="alert" className="space-y-3 rounded-xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-4 text-sm"><p>Assigned inspections could not be refreshed.</p><p className="text-[var(--wh-text-secondary)]">{loadError}</p><button type="button" onClick={()=>void load()} className="min-h-11 rounded-xl border border-[var(--wh-border-subtle)] px-4 font-semibold">Retry inspections</button></section>:loading?<Empty text="Loading inspections…"/>:shown.length===0?<Empty text="No inspections match this filter."/>:<div className="divide-y divide-[var(--wh-border-subtle)] border-y border-[var(--wh-border-subtle)]">{shown.map(row=><button key={`${row._source}-${row.id}`} onClick={()=>open(row)} className="w-full py-4 text-left"><Head row={row}/><p className="mt-2 text-xs text-[var(--wh-text-muted)]">{row.scheduled_date?new Date(row.scheduled_date).toLocaleString():'Schedule pending'}</p></button>)}</div>}</div>;
}

function done(row:InspectionRow){return ['completed','approved'].includes(row.status)}
function SectionTitle({step,title}:{step:string;title:string}){return <div><p className="text-xs font-bold uppercase tracking-[.16em] text-[var(--wh-accent-text)]">STEP {step}</p><h3 className="mt-1 text-sm font-semibold">{title}</h3></div>}
function Head({row}:{row:InspectionRow}){return <div><div className="flex items-start justify-between gap-3"><p className="min-w-0 break-words text-sm font-semibold">{row.property_address||'Property inspection'}</p><span className="shrink-0 text-xs capitalize text-[var(--wh-accent-text)]">{String(row.status||'pending').replace(/_/g,' ')}</span></div>{homeStyleLabel(row.home_style)&&<p className="mt-1 text-xs text-[var(--wh-text-secondary)]">{homeStyleLabel(row.home_style)}</p>}<PropertySpaceSummary record={row} compact/></div>}
function Coordinate({label,value,set}:{label:string;value:string;set:(value:string)=>void}){return <label><span className="mb-1 block text-xs text-[var(--wh-text-muted)]">{label}</span><input inputMode="decimal" value={value} onChange={event=>set(event.target.value.replace(/[^0-9+-.]/g,''))} className="h-11 w-full rounded-xl border border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)] px-3 text-xs"/></label>}
function CompletedInspection({row}:{row:InspectionRow}){const photos=row.photo_urls||[],videos=row.video_urls||[];return <section className="space-y-4"><div className="border-y border-emerald-500/15 py-4"><p className="text-xs font-semibold capitalize text-[var(--wh-accent-text)]">{String(row.status||'completed').replace(/_/g,' ')}</p><p className="mt-1 text-xs text-[var(--wh-text-secondary)]">{row.completed_at?'Completed '+new Date(row.completed_at).toLocaleString():'The field visit is complete.'}</p></div>{row.notes&&<div className="border-b border-[var(--wh-border-subtle)] pb-4"><p className="text-xs font-semibold uppercase tracking-wide text-[var(--wh-text-muted)]">Inspection report</p><p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-[var(--wh-text-secondary)]">{row.notes}</p></div>}<div><p className="text-xs font-semibold">Submitted evidence</p>{photos.length||videos.length?<div className="mt-3 grid grid-cols-3 gap-1.5">{photos.map((reference,index)=><EvidenceImage key={reference} reference={reference} index={index}/>)}{videos.map(reference=><ListingMediaVideo key={reference} reference={reference} controls playsInline className="aspect-square w-full rounded-xl bg-black object-cover"/>)}</div>:<p className="mt-2 text-xs text-[var(--wh-text-muted)]">No media is attached.</p>}</div></section>}
function EvidenceImage({reference,index}:{reference:string;index:number}){const url=useListingMediaUrl(reference),[open,setOpen]=useState(false);return <><button type="button" onClick={()=>url&&setOpen(true)} disabled={!url} className="aspect-square overflow-hidden rounded-xl bg-black disabled:cursor-wait"><ListingMediaImage reference={reference} alt={`Inspection evidence ${index+1}`} className="h-full w-full object-cover"/></button>{open&&url?<MediaViewer src={url} kind="image" title={`Inspection evidence ${index+1}`} onClose={()=>setOpen(false)}/>:null}</>}
function Empty({text}:{text:string}){return <div className="border-y border-dashed border-[var(--wh-border-subtle)] px-5 py-12 text-center text-xs text-[var(--wh-text-muted)]">{text}</div>}
