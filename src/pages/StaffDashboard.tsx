import { useEffect, useMemo, useState } from 'react';
import { Toaster, toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useStaffPermissions } from '@/hooks/useStaffPermissions';
import type { Profile, StaffPermission } from '@/types';
import { STAFF_PERMISSION_LABELS } from '@/types';

type ModuleKey = 'overview' | 'operations' | 'finance' | 'support' | 'verification' | 'field_officer';
type Props = { profile: Profile; onLogout: () => void; onGoToChat: (convId?: string) => void; onNavigate?: (page: string) => void };

const MODULES: Array<{ key: Exclude<ModuleKey,'overview'>; permission: StaffPermission; label: string; note: string }> = [
  { key:'operations', permission:'operations', label:'Operations', note:'Review property listings in your assigned branch' },
  { key:'finance', permission:'finance', label:'Finance', note:'Monitor canonical withdrawals and commission records' },
  { key:'support', permission:'support', label:'Support', note:'Respond to support requests from your assigned branch' },
  { key:'verification', permission:'verification', label:'Verification', note:'Review worker applications in your assigned branch' },
  { key:'field_officer', permission:'field_officer', label:'Field Work', note:'Complete inspections assigned directly to you' },
];

export default function StaffDashboard({ profile, onLogout }: Props) {
  const { permissions, loading } = useStaffPermissions(profile.user_id);
  const [tab,setTab] = useState<ModuleKey>('overview');
  const allowed = useMemo(() => MODULES.filter(m => permissions.includes(m.permission)),[permissions]);
  useEffect(() => { if (tab !== 'overview' && !allowed.some(m => m.key===tab)) setTab('overview'); },[allowed,tab]);
  if (loading) return <PageLoading/>;
  return <div className="min-h-[100dvh] bg-[#080A0F] text-white">
    <Toaster position="top-center" richColors/>
    <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-[#080A0F]/90 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 lg:px-8">
        <div><p className="text-[10px] font-semibold uppercase tracking-[.22em] text-blue-400">WeHouse Staff</p><h1 className="mt-1 text-base font-bold">{profile.full_name || profile.username || 'Staff workspace'}</h1><p className="mt-0.5 text-[10px] text-[#707386]">{profile.assigned_lga || profile.assigned_state ? [profile.assigned_lga,profile.assigned_state].filter(Boolean).join(', ') : 'Branch assignment required for branch-scoped modules'}</p></div>
        <button onClick={onLogout} className="rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-[10px] text-[#9A9CAD] hover:text-white">Log out</button>
      </div>
      <div className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-3 pb-3 lg:px-8">
        <Nav active={tab==='overview'} onClick={()=>setTab('overview')}>Overview</Nav>
        {allowed.map(m=><Nav key={m.key} active={tab===m.key} onClick={()=>setTab(m.key)}>{m.label}</Nav>)}
      </div>
    </header>
    <main className="mx-auto max-w-7xl px-4 py-6 pb-24 lg:px-8 lg:py-8">
      {tab==='overview' && <Overview profile={profile} permissions={permissions} modules={allowed} onOpen={setTab}/>} 
      {tab==='operations' && <Operations/>}
      {tab==='finance' && <Finance/>}
      {tab==='support' && <Support/>}
      {tab==='verification' && <Verification/>}
      {tab==='field_officer' && <FieldWork profile={profile}/>} 
    </main>
  </div>;
}

function Overview({profile,permissions,modules,onOpen}:{profile:Profile;permissions:StaffPermission[];modules:typeof MODULES;onOpen:(k:ModuleKey)=>void}) {
  return <div className="space-y-6">
    <section className="rounded-3xl border border-blue-500/15 bg-gradient-to-br from-blue-500/[0.12] via-[#111522] to-[#0D1018] p-6 lg:p-8"><span className="rounded-full bg-blue-500/10 px-3 py-1 text-[9px] font-semibold text-blue-300">ASSIGNED WORKSPACE</span><h2 className="mt-4 max-w-2xl text-2xl font-bold lg:text-3xl">Only the work assigned to you appears here.</h2><p className="mt-2 max-w-2xl text-xs leading-relaxed text-[#9295A7]">Every module is permission-gated. Branch-scoped modules use your assigned state/LGA on the server; field inspections use direct assignment.</p></section>
    {permissions.length===0 ? <Empty title="No staff modules assigned" text="An Admin or the Creator must assign your staff responsibilities before operational tools appear."/> : <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{modules.map(m=><button key={m.key} onClick={()=>onOpen(m.key)} className="rounded-2xl border border-white/[0.06] bg-[#10131B] p-5 text-left transition hover:-translate-y-0.5 hover:border-blue-500/25"><p className="text-sm font-semibold">{m.label}</p><p className="mt-2 text-[10px] leading-relaxed text-[#727587]">{m.note}</p><p className="mt-4 text-[9px] font-semibold text-blue-400">OPEN MODULE →</p></button>)}</section>}
    <section className="rounded-2xl border border-white/[0.06] bg-[#10131B] p-5"><p className="text-[10px] font-semibold uppercase tracking-wide text-[#717487]">Account</p><p className="mt-2 text-xs text-[#B5B7C3]">{profile.email}</p><p className="mt-1 text-[10px] text-[#66697B]">{permissions.map(p=>STAFF_PERMISSION_LABELS[p]).join(' · ') || 'No operational permission'}</p></section>
  </div>;
}

function Operations(){
 const [rows,setRows]=useState<any[]>([]),[loading,setLoading]=useState(true),[filter,setFilter]=useState('pending_approval'),[rejectId,setRejectId]=useState<string|null>(null),[reason,setReason]=useState('');
 async function load(){setLoading(true);const {data,error}=await supabase.rpc('get_my_staff_operations_listings',{p_status:filter});if(error)toast.error(error.message);setRows(data||[]);setLoading(false)}
 useEffect(()=>{void load()},[filter]);
 async function review(id:string,decision:'approve'|'reject'){const {error}=await supabase.rpc('review_my_staff_listing',{p_listing_id:id,p_decision:decision,p_reason:decision==='reject'?reason:null});if(error)return toast.error(error.message);toast.success(decision==='approve'?'Listing approved':'Listing rejected');setRejectId(null);setReason('');void load()}
 return <Module title="Property operations" note="Only listings inside your assigned branch are returned by the server." right={<Select value={filter} onChange={setFilter} options={[['pending_approval','Pending'],['available','Live'],['rejected','Rejected'],['all','All']]}/>}>
  {loading?<Loading/>:rows.length===0?<Empty title="No listings in this queue" text="There is nothing requiring action in your assigned branch."/>:<div className="grid gap-3 md:grid-cols-2">{rows.map(r=><Card key={r.id}><div className="flex justify-between gap-3"><div><p className="text-sm font-semibold">{r.title||'Property'}</p><p className="mt-1 text-[10px] text-[#6F7284]">{[r.city,r.state].filter(Boolean).join(', ')} · {money(r.price)}</p></div><Badge value={r.status}/></div>{r.status==='pending_approval'&&(rejectId===r.id?<div className="mt-4 space-y-2"><textarea value={reason} onChange={e=>setReason(e.target.value)} placeholder="Reason for rejection" className="w-full rounded-xl border border-white/[0.08] bg-[#171A23] p-3 text-xs outline-none"/><div className="flex gap-2"><Button secondary onClick={()=>{setRejectId(null);setReason('')}}>Cancel</Button><Button danger onClick={()=>void review(r.id,'reject')}>Confirm rejection</Button></div></div>:<div className="mt-4 flex gap-2"><Button onClick={()=>void review(r.id,'approve')}>Approve</Button><Button danger onClick={()=>setRejectId(r.id)}>Reject</Button></div>)}</Card>)}</div>}
 </Module>
}

function Finance(){
 const [data,setData]=useState<any>({withdrawals:[],commissions:[]}),[loading,setLoading]=useState(true),[view,setView]=useState<'withdrawals'|'commissions'>('withdrawals');
 useEffect(()=>{(async()=>{const {data,error}=await supabase.rpc('get_my_staff_finance_queue');if(error)toast.error(error.message);setData(data||{withdrawals:[],commissions:[]});setLoading(false)})()},[]);
 const rows=data[view]||[];
 return <Module title="Finance monitor" note="Canonical finance records only. Transfer execution is intentionally not duplicated in this dashboard." right={<div className="flex gap-1"><Mini active={view==='withdrawals'} onClick={()=>setView('withdrawals')}>Withdrawals</Mini><Mini active={view==='commissions'} onClick={()=>setView('commissions')}>Commission</Mini></div>}>
  {loading?<Loading/>:rows.length===0?<Empty title="No finance records" text="Nothing has been recorded in this queue yet."/>:<div className="space-y-2">{rows.map((r:any)=><Card key={r.id}><div className="flex items-center justify-between gap-4"><div><p className="text-xs font-semibold">{view==='withdrawals'?(r.snapshot_bank_account_name||'Withdrawal'):(r.booking_type||'Commission')}</p><p className="mt-1 text-[9px] text-[#696C7E]">{new Date(r.created_at).toLocaleDateString()}</p></div><div className="text-right"><p className="text-sm font-bold">{money(view==='withdrawals'?r.amount:r.commission_amount)}</p><Badge value={r.status||'recorded'}/></div></div></Card>)}</div>}
 </Module>
}

function Support(){
 const [rows,setRows]=useState<any[]>([]),[loading,setLoading]=useState(true),[filter,setFilter]=useState('all'),[replyId,setReplyId]=useState<string|null>(null),[reply,setReply]=useState('');
 async function load(){setLoading(true);const {data,error}=await supabase.rpc('get_my_staff_support_tickets',{p_status:filter});if(error)toast.error(error.message);setRows(data||[]);setLoading(false)} useEffect(()=>{void load()},[filter]);
 async function send(id:string,resolved:boolean){const {error}=await supabase.rpc('reply_my_staff_support_ticket',{p_ticket_id:id,p_reply:reply,p_resolve:resolved});if(error)return toast.error(error.message);toast.success(resolved?'Ticket resolved':'Reply saved');setReply('');setReplyId(null);void load()}
 return <Module title="Customer support" note="Support requests are restricted to customers in your assigned branch." right={<Select value={filter} onChange={setFilter} options={[['all','All'],['open','Open'],['in_progress','In progress'],['resolved','Resolved']]}/>}>
  {loading?<Loading/>:rows.length===0?<Empty title="No support requests" text="There are no matching requests in your branch."/>:<div className="space-y-3">{rows.map(t=><Card key={t.id}><div className="flex justify-between gap-3"><div><p className="text-xs font-semibold">{t.user_email||'WeHouse user'}</p><p className="mt-2 text-xs leading-relaxed text-[#A5A7B4]">{t.message}</p>{t.reply&&<div className="mt-3 rounded-xl bg-blue-500/[0.06] p-3 text-[10px] text-blue-200">Latest reply: {t.reply}</div>}</div><Badge value={t.status}/></div>{t.status!=='resolved'&&(replyId===t.id?<div className="mt-4 space-y-2"><textarea value={reply} onChange={e=>setReply(e.target.value)} placeholder="Write the WeHouse response" className="w-full rounded-xl border border-white/[0.08] bg-[#171A23] p-3 text-xs outline-none"/><div className="flex gap-2"><Button secondary onClick={()=>setReplyId(null)}>Cancel</Button><Button secondary onClick={()=>void send(t.id,false)}>Save reply</Button><Button onClick={()=>void send(t.id,true)}>Reply & resolve</Button></div></div>:<div className="mt-4"><Button onClick={()=>setReplyId(t.id)}>Respond</Button></div>)}</Card>)}</div>}
 </Module>
}

function Verification(){
 const [rows,setRows]=useState<any[]>([]),[loading,setLoading]=useState(true),[filter,setFilter]=useState('pending');
 async function load(){setLoading(true);const {data,error}=await supabase.rpc('get_my_staff_worker_reviews',{p_status:filter});if(error)toast.error(error.message);setRows(data||[]);setLoading(false)} useEffect(()=>{void load()},[filter]);
 async function review(id:string,status:string){const {error}=await supabase.rpc('review_my_staff_worker',{p_worker_id:id,p_status:status});if(error)return toast.error(error.message);toast.success('Worker record updated');void load()}
 return <Module title="Worker verification" note="Worker records are branch-scoped and status changes are validated on the server." right={<Select value={filter} onChange={setFilter} options={[['pending','Pending'],['verification_paid','Verified'],['suspended','Suspended'],['rejected','Rejected'],['all','All']]}/>}>
  {loading?<Loading/>:rows.length===0?<Empty title="No workers to review" text="No worker applications match this queue in your branch."/>:<div className="grid gap-3 md:grid-cols-2">{rows.map(w=><Card key={w.user_id}><div className="flex justify-between gap-3"><div><p className="text-sm font-semibold">{w.full_name||w.username||'Worker'}</p><p className="mt-1 text-[10px] text-[#6D7082]">{w.worker_occupation||'Occupation not supplied'} · {[w.local_government||w.city,w.state].filter(Boolean).join(', ')}</p></div><Badge value={w.worker_status||'pending'}/></div>{w.worker_status==='pending'&&<div className="mt-4 flex gap-2"><Button onClick={()=>void review(w.user_id,'verification_paid')}>Approve</Button><Button danger onClick={()=>void review(w.user_id,'rejected')}>Reject</Button></div>}{w.worker_status==='verification_paid'&&<div className="mt-4"><Button danger onClick={()=>void review(w.user_id,'suspended')}>Suspend</Button></div>}{w.worker_status==='suspended'&&<div className="mt-4"><Button onClick={()=>void review(w.user_id,'verification_paid')}>Reinstate</Button></div>}</Card>)}</div>}
 </Module>
}

function FieldWork({profile}:{profile:Profile}){
 const [rows,setRows]=useState<any[]>([]),[loading,setLoading]=useState(true),[completeId,setCompleteId]=useState<string|null>(null),[report,setReport]=useState(''),[condition,setCondition]=useState('good'),[postId,setPostId]=useState<string|null>(null),[form,setForm]=useState({title:'',price:'',description:'',bedrooms:'1',bathrooms:'1'});
 async function load(){setLoading(true);const {data,error}=await supabase.rpc('get_my_inspections',{p_field_officer_id:profile.user_id});if(error)toast.error(error.message);setRows(data||[]);setLoading(false)} useEffect(()=>{void load()},[profile.user_id]);
 async function status(id:string,next:string){const args:any={p_inspection_id:id,p_new_status:next,p_source:'user'};if(next==='completed'){if(!report.trim())return toast.error('Inspection report is required');args.p_report=report;args.p_condition=condition}const {error}=await supabase.rpc('update_inspection_status',args);if(error)return toast.error(error.message);toast.success(next==='completed'?'Inspection completed':'Inspection started');setCompleteId(null);setReport('');void load()}
 function openPost(r:any){setPostId(r.id);setForm({title:`${r.property_type||'Property'} in ${r.property_city||''}`.trim(),price:String(r.expected_rent||''),description:r.notes||'',bedrooms:String(r.bedrooms||1),bathrooms:String(r.bathrooms||1)})}
 async function post(r:any){if(!form.title.trim()||Number(form.price)<=0)return toast.error('Title and valid price are required');const {error}=await supabase.rpc('post_property_from_inspection',{p_data:{inspection_id:r.id,title:form.title.trim(),description:form.description.trim()||null,price:Number(form.price),state:r.property_state,city:r.property_city,address:r.property_address,bedrooms:Number(form.bedrooms)||1,bathrooms:Number(form.bathrooms)||1,property_type:r.property_type||'apartment',images:r.photo_urls||[],videos:[]}});if(error)return toast.error(error.message);toast.success('Listing sent to Operations for approval');setPostId(null);void load()}
 return <Module title="Assigned field work" note="Only inspections assigned to your staff identity are loaded.">
  {loading?<Loading/>:rows.length===0?<Empty title="No inspections assigned" text="New field assignments will appear here."/>:<div className="space-y-3">{rows.map(r=><Card key={r.id}><div className="flex justify-between gap-3"><div><p className="text-sm font-semibold">{r.property_address||'Property inspection'}</p><p className="mt-1 text-[10px] text-[#6E7183]">{[r.property_city,r.property_state].filter(Boolean).join(', ')} · {r.request_code||''}</p></div><Badge value={r.status}/></div>{r.photo_urls?.length>0&&<div className="mt-3 flex gap-2 overflow-x-auto">{r.photo_urls.map((u:string)=><img key={u} src={u} alt="Inspection" className="h-20 w-24 rounded-xl object-cover"/>)}</div>}{r.status==='scheduled'&&<div className="mt-4"><Button onClick={()=>void status(r.id,'in_progress')}>Start inspection</Button></div>}{r.status==='in_progress'&&(completeId===r.id?<div className="mt-4 space-y-2"><textarea value={report} onChange={e=>setReport(e.target.value)} placeholder="Inspection report" className="w-full rounded-xl border border-white/[0.08] bg-[#171A23] p-3 text-xs"/><Select value={condition} onChange={setCondition} options={[['excellent','Excellent'],['good','Good'],['fair','Fair'],['poor','Poor']]}/><div className="flex gap-2"><Button secondary onClick={()=>setCompleteId(null)}>Cancel</Button><Button onClick={()=>void status(r.id,'completed')}>Complete</Button></div></div>:<div className="mt-4"><Button onClick={()=>setCompleteId(r.id)}>Complete inspection</Button></div>)}{['completed','approved'].includes(r.status)&&!r.draft_listing_id&&(postId===r.id?<div className="mt-4 grid gap-2"><Input value={form.title} onChange={v=>setForm({...form,title:v})} placeholder="Listing title"/><Input value={form.price} onChange={v=>setForm({...form,price:v})} placeholder="Rent / price" type="number"/><textarea value={form.description} onChange={e=>setForm({...form,description:e.target.value})} placeholder="Listing description" className="rounded-xl border border-white/[0.08] bg-[#171A23] p-3 text-xs"/><div className="grid grid-cols-2 gap-2"><Input value={form.bedrooms} onChange={v=>setForm({...form,bedrooms:v})} placeholder="Bedrooms" type="number"/><Input value={form.bathrooms} onChange={v=>setForm({...form,bathrooms:v})} placeholder="Bathrooms" type="number"/></div><div className="flex gap-2"><Button secondary onClick={()=>setPostId(null)}>Cancel</Button><Button onClick={()=>void post(r)}>Send for approval</Button></div></div>:<div className="mt-4"><Button onClick={()=>openPost(r)}>Prepare listing</Button></div>)}{r.draft_listing_id&&<p className="mt-4 rounded-xl bg-emerald-500/[0.06] p-3 text-[10px] text-emerald-300">Listing created and handed to Operations.</p>}</Card>)}</div>}
 </Module>
}

function Module({title,note,right,children}:{title:string;note:string;right?:React.ReactNode;children:React.ReactNode}){return <div className="space-y-5"><div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-lg font-bold">{title}</h2><p className="mt-1 text-[10px] text-[#707386]">{note}</p></div>{right}</div>{children}</div>}
function Nav({active,onClick,children}:{active:boolean;onClick:()=>void;children:React.ReactNode}){return <button onClick={onClick} className={`shrink-0 rounded-xl px-3.5 py-2 text-[10px] font-semibold ${active?'bg-blue-500 text-white':'text-[#747789] hover:bg-white/[0.04] hover:text-white'}`}>{children}</button>}
function Card({children}:{children:React.ReactNode}){return <div className="rounded-2xl border border-white/[0.06] bg-[#10131B] p-4">{children}</div>}
function Button({children,onClick,secondary,danger}:{children:React.ReactNode;onClick:()=>void;secondary?:boolean;danger?:boolean}){return <button onClick={onClick} className={`min-h-9 flex-1 rounded-xl px-3 text-[10px] font-semibold ${danger?'border border-red-500/20 bg-red-500/10 text-red-300':secondary?'border border-white/[0.08] bg-white/[0.04] text-[#A7A9B6]':'bg-blue-500 text-white hover:bg-blue-400'}`}>{children}</button>}
function Mini({active,onClick,children}:{active:boolean;onClick:()=>void;children:React.ReactNode}){return <button onClick={onClick} className={`rounded-lg px-3 py-2 text-[9px] ${active?'bg-blue-500 text-white':'bg-white/[0.04] text-[#777A8C]'}`}>{children}</button>}
function Select({value,onChange,options}:{value:string;onChange:(v:string)=>void;options:string[][]}){return <select value={value} onChange={e=>onChange(e.target.value)} className="h-9 rounded-xl border border-white/[0.08] bg-[#141720] px-3 text-[10px] outline-none">{options.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select>}
function Input({value,onChange,placeholder,type='text'}:{value:string;onChange:(v:string)=>void;placeholder:string;type?:string}){return <input value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} type={type} className="h-10 rounded-xl border border-white/[0.08] bg-[#171A23] px-3 text-xs outline-none"/>}
function Badge({value}:{value:string}){const good=['available','approved','completed','resolved','verification_paid'].includes(value);const bad=['rejected','suspended','failed'].includes(value);return <span className={`h-fit rounded-full px-2 py-1 text-[8px] font-semibold capitalize ${good?'bg-emerald-500/10 text-emerald-300':bad?'bg-red-500/10 text-red-300':'bg-amber-500/10 text-amber-300'}`}>{String(value).replace(/_/g,' ')}</span>}
function Empty({title,text}:{title:string;text:string}){return <div className="rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.015] px-5 py-12 text-center"><p className="text-sm font-semibold">{title}</p><p className="mx-auto mt-2 max-w-md text-[10px] leading-relaxed text-[#66697B]">{text}</p></div>}
function Loading(){return <div className="grid min-h-40 place-items-center"><div className="h-7 w-7 animate-spin rounded-full border-2 border-blue-500 border-t-transparent"/></div>}
function PageLoading(){return <div className="grid min-h-screen place-items-center bg-[#080A0F]"><Loading/></div>}
function money(v:any){return `₦${Number(v||0).toLocaleString('en-NG')}`}
