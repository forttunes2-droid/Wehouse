import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { uploadListingCandidateImage, uploadListingCandidateVideo } from '@/lib/supabase/listings';
import { ListingMediaImage, ListingMediaVideo, useListingMediaUrl } from './ListingCandidateMedia';
import InlineFilterChips from '@/components/InlineFilterChips';
import type { Profile } from '@/types';

type InspectionRow = {
  id:string; _source?:string; status:string; property_address?:string|null;
  property_city?:string|null; property_state?:string|null; owner_name?:string|null;
  owner_phone?:string|null; scheduled_date?:string|null; gps_latitude?:number|null;
  gps_longitude?:number|null; location_accuracy_m?:number|null; photo_urls?:string[]|null;
  video_urls?:string[]|null; notes?:string|null; completed_at?:string|null;
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
  const [saving,setSaving] = useState(false);
  const [locating,setLocating] = useState(false);

  const load = useCallback(async()=>{
    setLoading(true);
    const {data,error}=await supabase.rpc('get_my_inspections',{p_field_officer_id:profile.user_id});
    if(error)toast.error(error.message);
    setRows((data||[]) as InspectionRow[]);
    setLoading(false);
  },[profile.user_id]);

  useEffect(()=>{ void load(); },[load]);
  const previews=useMemo<Preview[]>(()=>media.map(file=>({file,url:URL.createObjectURL(file)})),[media]);
  useEffect(()=>()=>previews.forEach(item=>URL.revokeObjectURL(item.url)),[previews]);
  const shown=useMemo(()=>rows.filter(row=>{
    const status=String(row.status||'pending');
    const matchesStatus=filter==='all'||status===filter;
    const query=search.trim().toLowerCase();
    const matchesSearch=!query||[row.property_address,row.property_city,row.property_state,row.owner_name,row.status].filter(Boolean).join(' ').toLowerCase().includes(query);
    return matchesStatus&&matchesSearch;
  }).sort((a,b)=>Number(done(a))-Number(done(b))),[rows,search,filter]);

  function open(row:InspectionRow){
    setSelected(row); setReport(''); setCondition(''); setMedia([]);
    setLat(row.gps_latitude==null?'':String(row.gps_latitude));
    setLng(row.gps_longitude==null?'':String(row.gps_longitude));
    setAccuracy(row.location_accuracy_m==null?null:Number(row.location_accuracy_m));
  }
  function chooseMedia(list:FileList|null){
    if(!list)return;
    const picked=Array.from(list).filter(file=>file.type.startsWith('image/')||file.type.startsWith('video/'));
    setMedia(current=>[...current,...picked]);
    if(mediaInput.current)mediaInput.current.value='';
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
    if(!selected||selected._source!=='partner')return;
    const latitude=Number(lat),longitude=Number(lng);
    if(!Number.isFinite(latitude)||latitude<-90||latitude>90||!Number.isFinite(longitude)||longitude<-180||longitude>180)return toast.error('Enter valid property coordinates');
    const {error}=await supabase.rpc('field_officer_update_inspection_location',{p_inspection_id:selected.id,p_latitude:latitude,p_longitude:longitude,p_accuracy_m:accuracy});
    if(error)return toast.error(error.message); toast.success('Property location saved');
  }
  async function update(status:'in_progress'|'completed'){
    if(!selected)return;
    if(status==='completed'&&!report.trim())return toast.error('Add the inspection report');
    const fieldPhotoCount=(selected.photo_urls||[]).length+media.filter(file=>file.type.startsWith('image/')).length;
    if(status==='completed'&&selected._source==='partner'&&fieldPhotoCount<4)return toast.error(`Add ${4-fieldPhotoCount} more Field Operations photo${4-fieldPhotoCount===1?'':'s'}`);
    setSaving(true);
    const uploadedRefs:string[]=[];
    let mediaRegistered=false;
    try{
      if(status==='completed'&&media.length){
        const photoUrls:string[]=[],videoUrls:string[]=[];
        for(const file of media){
          const uploaded=file.type.startsWith('video/')?await uploadListingCandidateVideo(file,{kind:'field',inspectionId:selected.id}):await uploadListingCandidateImage(file,{kind:'field',inspectionId:selected.id});
          if(uploaded.error||!uploaded.url)throw new Error(uploaded.error?.message||`Could not upload ${file.name}`);
          uploadedRefs.push(uploaded.url);
          (file.type.startsWith('video/')?videoUrls:photoUrls).push(uploaded.url);
        }
        const saved=await supabase.rpc('field_officer_add_inspection_media',{p_inspection_id:selected.id,p_photo_urls:photoUrls,p_video_urls:videoUrls});
        if(saved.error)throw saved.error;
        mediaRegistered=true;
      }
      const {error}=await supabase.rpc('update_inspection_status',{p_inspection_id:selected.id,p_new_status:status,p_source:selected._source||'user',p_report:status==='completed'?report.trim():null,p_condition:status==='completed'?(condition.trim()||null):null});
      if(error)throw error;
      toast.success(status==='completed'?'Inspection evidence submitted for review':'Inspection started');
      setSelected(null); void load();
    }catch(error:unknown){if(uploadedRefs.length&&!mediaRegistered)await supabase.storage.from('listing-candidates').remove(uploadedRefs);toast.error(error instanceof Error?error.message:'Inspection could not be saved')}finally{setSaving(false)}
  }

  if(selected){
    const complete=done(selected);
    const fieldPhotoCount=(selected.photo_urls||[]).length+media.filter(file=>file.type.startsWith('image/')).length;
    return <div className="space-y-5">
      <button onClick={()=>setSelected(null)} className="text-[10px] font-semibold text-violet-300">← Inspections</button>
      <header className="border-b border-white/[.06] pb-4"><Head row={selected}/><p className="mt-2 text-[10px] text-[#747B8B]">{[selected.property_city,selected.property_state].filter(Boolean).join(', ')} · {selected.owner_name||selected.owner_phone||'Contact unavailable'}</p></header>
      {complete?<CompletedInspection row={selected}/>:selected.status!=='in_progress'?<section className="py-10 text-center"><h2 className="text-xl font-bold">Ready for the property visit?</h2><p className="mx-auto mt-2 max-w-sm text-[10px] leading-5 text-[#72798A]">Start only when you are ready to inspect this assigned property. The report and evidence workspace opens next.</p><button onClick={()=>void update('in_progress')} className="mt-5 h-12 rounded-full bg-violet-500 px-8 text-xs font-semibold">Start inspection</button></section>:<>
        {selected._source==='partner'&&<section className="space-y-3 border-b border-white/[.06] pb-5"><SectionTitle step="1" title="Confirm the property location"/><div className="grid grid-cols-2 gap-2"><Coordinate label="Latitude" value={lat} set={setLat}/><Coordinate label="Longitude" value={lng} set={setLng}/></div><div className="grid grid-cols-2 gap-2"><button onClick={capture} disabled={locating} className="h-11 rounded-xl border border-violet-500/20 text-[10px] font-semibold text-violet-200">{locating?'Getting GPS…':'Use GPS at property'}</button><button onClick={()=>void saveLocation()} className="h-11 rounded-xl bg-violet-500 text-[10px] font-semibold">Save location</button></div>{accuracy!=null&&<p className="text-[9px] text-[#66758C]">GPS accuracy approximately {Math.round(accuracy)} m</p>}</section>}
        <section className="space-y-3 border-b border-white/[.06] pb-5"><SectionTitle step={selected._source==='partner'?'2':'1'} title="Record what you found"/><textarea value={report} onChange={event=>setReport(event.target.value)} rows={5} placeholder="Inspection report" className="w-full rounded-2xl border border-white/[.08] bg-[#11151E] p-4 text-xs leading-5 outline-none focus:border-violet-500/40"/><input value={condition} onChange={event=>setCondition(event.target.value)} placeholder="Property condition (optional)" className="h-12 w-full rounded-2xl border border-white/[.08] bg-[#11151E] px-4 text-xs outline-none focus:border-violet-500/40"/></section>
        <section className="space-y-3"><div className="flex items-center justify-between gap-3"><SectionTitle step={selected._source==='partner'?'3':'2'} title="Add inspection evidence"/><button type="button" onClick={()=>mediaInput.current?.click()} className="shrink-0 rounded-full bg-violet-500 px-4 py-2 text-[10px] font-semibold">{media.length?'Add more':'Add evidence'}</button></div><input ref={mediaInput} type="file" accept="image/*,video/mp4,video/quicktime,video/webm" multiple className="hidden" onChange={event=>chooseMedia(event.target.files)}/><p className="text-[9px] text-[#747B8B]">Add at least 4 Field Operations photos from this visit. Optional videos stay as evidence. There is no maximum.</p>{previews.length?<><div className="flex items-center justify-between"><p className="text-[10px] font-medium">{fieldPhotoCount}/4 required photos · {previews.length} new file{previews.length===1?'':'s'}</p><button type="button" onClick={()=>setMedia([])} className="text-[9px] text-red-300">Remove all</button></div><div className="grid grid-cols-3 gap-1.5">{previews.map(({file,url},index)=><div key={`${file.name}-${file.lastModified}-${index}`} className="relative aspect-square overflow-hidden rounded-xl bg-black">{file.type.startsWith('video/')?<video src={url} controls playsInline preload="metadata" className="h-full w-full object-cover"/>:<img src={url} alt={`Selected evidence ${index+1}`} className="h-full w-full object-cover"/>}<button type="button" onClick={()=>setMedia(current=>current.filter((_,itemIndex)=>itemIndex!==index))} aria-label={`Remove ${file.name}`} className="absolute right-1 top-1 grid h-7 w-7 place-items-center rounded-full bg-black/75 text-sm">×</button><span className="absolute bottom-1 left-1 rounded-full bg-black/70 px-1.5 py-0.5 text-[7px]">{file.type.startsWith('video/')?'VIDEO':'PHOTO'}</span></div>)}</div></>:<button type="button" onClick={()=>mediaInput.current?.click()} className="grid min-h-36 w-full place-items-center rounded-2xl border border-dashed border-white/[.1] text-center"><span><span className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-violet-500/10 text-xl text-violet-300">＋</span><span className="mt-2 block text-[10px] text-[#7A8191]">Add 4 visit photos</span></span></button>}<p className="text-[9px] text-amber-200/75">These are independent Field Operations photos, not the Property Partner’s four. Submission sends them for review and does not publish anything.</p><button onClick={()=>void update('completed')} disabled={saving||!report.trim()||(selected._source==='partner'&&fieldPhotoCount<4)} className="h-12 w-full rounded-full bg-violet-500 text-xs font-semibold disabled:opacity-40">{saving?`Uploading ${media.length} file${media.length===1?'':'s'}…`:fieldPhotoCount<4?`${4-fieldPhotoCount} more photo${4-fieldPhotoCount===3?'s':''} required`:'Submit inspection for review'}</button></section>
      </>}
    </div>;
  }

  const active=rows.filter(row=>!done(row)).length;
  return <div className="space-y-4"><header><h2 className="text-lg font-bold">Inspections</h2><p className="mt-1 text-[10px] text-[#707687]">{active} active · {rows.length-active} completed</p></header><InlineFilterChips value={filter} options={INSPECTION_FILTERS} onChange={(value)=>setFilter(value as InspectionFilter)} ariaLabel="Show inspections by lifecycle"/><input value={search} onChange={event=>setSearch(event.target.value)} aria-label="Search inspections" placeholder="Search address or Property Partner" className="h-11 w-full border-b border-white/[.08] bg-transparent px-1 text-xs outline-none"/>{loading?<Empty text="Loading inspections…"/>:shown.length===0?<Empty text="No inspections match this view."/>:<div className="divide-y divide-white/[.06] border-y border-white/[.06]">{shown.map(row=><button key={`${row._source}-${row.id}`} onClick={()=>open(row)} className="w-full py-4 text-left"><Head row={row}/><p className="mt-2 text-[9px] text-[#73798B]">{row.scheduled_date?new Date(row.scheduled_date).toLocaleString():'Schedule pending'}</p></button>)}</div>}</div>;
}

function done(row:InspectionRow){return ['completed','approved'].includes(row.status)}
function SectionTitle({step,title}:{step:string;title:string}){return <div><p className="text-[8px] font-bold uppercase tracking-[.16em] text-violet-300">STEP {step}</p><h3 className="mt-1 text-sm font-semibold">{title}</h3></div>}
function Head({row}:{row:InspectionRow}){return <div className="flex items-start justify-between gap-3"><p className="min-w-0 break-words text-sm font-semibold">{row.property_address||'Property inspection'}</p><span className="shrink-0 text-[8px] capitalize text-violet-300">{String(row.status||'pending').replace(/_/g,' ')}</span></div>}
function Coordinate({label,value,set}:{label:string;value:string;set:(value:string)=>void}){return <label><span className="mb-1 block text-[9px] text-[#66758C]">{label}</span><input inputMode="decimal" value={value} onChange={event=>set(event.target.value.replace(/[^0-9+-.]/g,''))} className="h-11 w-full rounded-xl border border-white/[.08] bg-[#111722] px-3 text-xs"/></label>}
function CompletedInspection({row}:{row:InspectionRow}){const photos=row.photo_urls||[],videos=row.video_urls||[];return <section className="space-y-4"><div className="border-y border-emerald-500/15 py-4"><p className="text-xs font-semibold capitalize text-emerald-300">{String(row.status||'completed').replace(/_/g,' ')}</p><p className="mt-1 text-[9px] text-[#7B8791]">{row.completed_at?'Completed '+new Date(row.completed_at).toLocaleString():'The field visit is complete.'}</p></div>{row.notes&&<div className="border-b border-white/[.06] pb-4"><p className="text-[9px] font-semibold uppercase tracking-wide text-[#66758C]">Inspection report</p><p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-[#A5AAB7]">{row.notes}</p></div>}<div><p className="text-xs font-semibold">Submitted evidence</p>{photos.length||videos.length?<div className="mt-3 grid grid-cols-3 gap-1.5">{photos.map((reference,index)=><EvidenceImage key={reference} reference={reference} index={index}/>)}{videos.map(reference=><ListingMediaVideo key={reference} reference={reference} controls playsInline className="aspect-square w-full rounded-xl bg-black object-cover"/>)}</div>:<p className="mt-2 text-[9px] text-[#6D7383]">No media is attached.</p>}</div></section>}
function EvidenceImage({reference,index}:{reference:string;index:number}){const url=useListingMediaUrl(reference);return <a href={url||undefined} target="_blank" rel="noreferrer" aria-disabled={!url} className="aspect-square overflow-hidden rounded-xl bg-black"><ListingMediaImage reference={reference} alt={`Inspection evidence ${index+1}`} className="h-full w-full object-cover"/></a>}
function Empty({text}:{text:string}){return <div className="border-y border-dashed border-white/[.08] px-5 py-12 text-center text-[10px] text-[#666D7E]">{text}</div>}
