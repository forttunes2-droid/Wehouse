import { useEffect,useMemo,useState } from 'react';
import { deleteAnnouncement,getAllAnnouncements,getAllUsers,getAnnouncementsSentBy,getFilteredRecipientCount,sendAnnouncement } from '@/lib/supabase';
import { canSendAnnouncements } from '@/hooks/useAuth';
import { useConfirm } from '@/hooks/useConfirm';
import ConfirmDialog from '@/components/ConfirmDialog';
import { Toaster,toast } from 'sonner';
import type { Profile } from '@/types';

type Scope='all'|{state:string;lga:string};
type View='compose'|'history';
type Mode='roles'|'people';
const isCreator=(profile:Profile)=>profile.role==='creator';

export function AnnouncementsTab({profile,scope}:{profile:Profile;scope:Scope}){
  const canSend=canSendAnnouncements(profile.role);
  const branchScope=scope!=='all';
  const[view,setView]=useState<View>('compose');
  const[mode,setMode]=useState<Mode>('roles');
  const[title,setTitle]=useState('');
  const[message,setMessage]=useState('');
  const[history,setHistory]=useState<any[]>([]);
  const[historyError,setHistoryError]=useState<string|null>(null);
  const[people,setPeople]=useState<any[]>([]);
  const[peopleError,setPeopleError]=useState<string|null>(null);
  const[search,setSearch]=useState('');
  const[selectedPeople,setSelectedPeople]=useState<string[]>([]);
  const[roles,setRoles]=useState<Record<string,boolean>>({user:false,worker:false,staff:false,property_partner:false});
  const[recipientCount,setRecipientCount]=useState(0);
  const[counting,setCounting]=useState(false);
  const[sending,setSending]=useState(false);
  const{ask,dialogProps}=useConfirm();

  useEffect(()=>{void loadHistory();if(canSend)void loadPeople()},[]);
  useEffect(()=>{
    if(!canSend||mode!=='roles')return;
    let cancelled=false;
    void(async()=>{
      setCounting(true);
      const{count}=await getFilteredRecipientCount(roles.user,roles.worker,roles.staff,roles.property_partner,branchScope?scope.state:undefined,branchScope?scope.lga:undefined,profile.role);
      if(!cancelled){setRecipientCount(Number(count||0));setCounting(false)}
    })();
    return()=>{cancelled=true};
  },[roles.user,roles.worker,roles.staff,roles.property_partner,mode,canSend,branchScope,profile.role]);

  async function loadHistory(){
    setHistoryError(null);
    const result=isCreator(profile)?await getAllAnnouncements():await getAnnouncementsSentBy(profile.user_id);
    if(result.error){setHistory([]);setHistoryError(result.error.message);return}
    setHistory(result.messages||[]);
  }

  async function loadPeople(){
    setPeopleError(null);
    const{users,error}=await getAllUsers();
    if(error||!users){setPeople([]);setPeopleError(error?.message||'Could not load recipients');return}
    let list=users.filter((u:any)=>u.user_id!==profile.user_id&&!u.deleted&&!u.deleted_at&&['user','worker','staff','property_partner'].includes(u.role));
    if(branchScope)list=list.filter((u:any)=>{
      const state=u.role==='staff'?u.assigned_state:u.state;
      const lga=u.role==='staff'?u.assigned_lga:(u.local_government||u.city);
      return state===scope.state&&lga===scope.lga;
    });
    setPeople(list);
  }

  const shownPeople=useMemo(()=>{
    const q=search.trim().toLowerCase();
    if(!q)return people;
    return people.filter((u:any)=>[u.full_name,u.username,u.email,u.role,u.state,u.assigned_state,u.local_government,u.city,u.assigned_lga].filter(Boolean).join(' ').toLowerCase().includes(q));
  },[people,search]);

  const selectedRoles=Object.entries(roles).filter(([,selected])=>selected).map(([role])=>role);

  async function send(){
    if(!title.trim())return toast.error('Add a title');
    if(!message.trim())return toast.error('Write the announcement');
    if(mode==='roles'&&!selectedRoles.length)return toast.error('Choose at least one recipient type');
    if(mode==='people'&&!selectedPeople.length)return toast.error('Choose at least one recipient');
    setSending(true);
    const{error,recipientCount:sentCount}=await sendAnnouncement(
      profile.user_id,
      profile.role,
      profile.full_name||profile.username||'WeHouse',
      title.trim(),
      message.trim(),
      mode==='roles'?'all_users':'specific_user',
      {
        recipientIds:mode==='people'?selectedPeople:undefined,
        scopeState:branchScope?scope.state:undefined,
        scopeLga:branchScope?scope.lga:undefined,
        targetRoles:mode==='people'?Array.from(new Set(people.filter((p:any)=>selectedPeople.includes(p.user_id)).map((p:any)=>p.role))):selectedRoles,
      }
    );
    setSending(false);
    if(error)return toast.error(error.message||'Announcement could not be sent');
    toast.success(`Sent to ${Number(sentCount||0)} recipient${Number(sentCount||0)===1?'':'s'}`);
    setTitle('');setMessage('');setSelectedPeople([]);setRoles({user:false,worker:false,staff:false,property_partner:false});
    await loadHistory();
    setView('history');
  }

  async function remove(id:number){
    if(!await ask({title:'Delete this announcement?',confirmLabel:'Delete',variant:'danger'}))return;
    const{error}=await deleteAnnouncement(id);
    if(error)return toast.error(error.message);
    setHistory(current=>current.filter(row=>Number(row.id)!==id));
    toast.success('Announcement deleted');
  }

  return <div className="min-w-0 space-y-4">
    <ConfirmDialog {...dialogProps}/><Toaster position="top-center" richColors theme="dark"/>
    {branchScope&&<div className="rounded-2xl border border-violet-500/15 bg-violet-500/[.05] p-3 text-[10px] leading-relaxed text-violet-300">Delivery is restricted by the server to {scope.lga}, {scope.state}.</div>}
    <div className="flex gap-6 border-b border-white/[.06]">
      <button onClick={()=>setView('compose')} className={`border-b-2 pb-3 text-xs font-semibold ${view==='compose'?'border-violet-400 text-white':'border-transparent text-[#777B8D]'}`}>Compose</button>
      <button onClick={()=>setView('history')} className={`border-b-2 pb-3 text-xs font-semibold ${view==='history'?'border-violet-400 text-white':'border-transparent text-[#777B8D]'}`}>Sent · {history.length}</button>
    </div>

    {view==='compose'&&canSend&&<section className="overflow-hidden">
      <div className="border-b border-white/[.05] px-1 pb-4 pt-2">
        <p className="text-sm font-semibold">New official announcement</p>
        <p className="mt-1 text-[10px] leading-relaxed text-[#6C7080]">Recipients receive this inside the same WeHouse Official channel used throughout the app.</p>
      </div>
      <div className="space-y-4 py-4">
        <label className="block border-b border-white/[.08] py-2"><span className="mb-1 block text-[9px] font-semibold uppercase tracking-[.1em] text-[#676B7B]">Title</span><input value={title} onChange={e=>setTitle(e.target.value)} maxLength={120} placeholder="What is this update about?" className="h-11 w-full bg-transparent text-base font-semibold outline-none"/></label>
        <label className="block border-b border-white/[.08] py-2"><span className="mb-1 block text-[9px] font-semibold uppercase tracking-[.1em] text-[#676B7B]">Message</span><textarea value={message} onChange={e=>setMessage(e.target.value)} rows={7} placeholder="Write the announcement…" className="w-full resize-none bg-transparent py-2 text-sm leading-6 outline-none"/></label>

        <div>
          <p className="mb-2 text-[9px] font-semibold uppercase tracking-[.1em] text-[#676B7B]">Recipients</p>
          <div className="grid grid-cols-2 gap-2 sm:w-fit">
            <button onClick={()=>setMode('roles')} className={`min-h-10 rounded-xl px-4 text-xs font-semibold ${mode==='roles'?'bg-violet-500 text-white':'border border-white/[.06] text-[#8A8D9D]'}`}>By account type</button>
            <button onClick={()=>setMode('people')} className={`min-h-10 rounded-xl px-4 text-xs font-semibold ${mode==='people'?'bg-violet-500 text-white':'border border-white/[.06] text-[#8A8D9D]'}`}>Specific people</button>
          </div>
        </div>

        {mode==='roles'?<div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <RoleChoice label="Users" selected={roles.user} onChange={value=>setRoles(current=>({...current,user:value}))}/>
          <RoleChoice label="Workers" selected={roles.worker} onChange={value=>setRoles(current=>({...current,worker:value}))}/>
          <RoleChoice label="Staff" selected={roles.staff} onChange={value=>setRoles(current=>({...current,staff:value}))}/>
          <RoleChoice label="Property Partners" selected={roles.property_partner} onChange={value=>setRoles(current=>({...current,property_partner:value}))}/>
          <div className="sm:col-span-2 lg:col-span-4 rounded-xl border border-violet-500/10 bg-violet-500/[.04] px-3 py-2 text-[10px] text-violet-300">{counting?'Counting recipients…':`${recipientCount} recipient${recipientCount===1?'':'s'} selected`}</div>
        </div>:<div className="space-y-2">
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search name, email, role or location" className="h-11 w-full rounded-xl border border-white/[.08] bg-[#171A23] px-3 text-xs outline-none"/>
          {peopleError&&<p className="text-xs text-red-300">{peopleError}</p>}
          <div className="max-h-64 space-y-1 overflow-y-auto rounded-xl border border-white/[.05] p-1">
            {shownPeople.map((person:any)=>{const checked=selectedPeople.includes(person.user_id);return <button key={person.user_id} onClick={()=>setSelectedPeople(current=>checked?current.filter(id=>id!==person.user_id):[...current,person.user_id])} className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left hover:bg-white/[.03]"><span className={`grid h-5 w-5 shrink-0 place-items-center rounded-md border text-[10px] ${checked?'border-violet-500 bg-violet-500':'border-white/[.14]'}`}>{checked?'✓':''}</span><div className="min-w-0 flex-1"><p className="truncate text-xs font-medium">{person.full_name||person.username||person.email}</p><p className="mt-0.5 truncate text-[9px] capitalize text-[#666A7A]">{String(person.role).replace(/_/g,' ')} · {person.local_government||person.city||person.assigned_lga||'Location not set'}</p></div></button>})}
          </div>
          <p className="text-[10px] text-[#686C7D]">{selectedPeople.length} selected</p>
        </div>}

        <button onClick={()=>void send()} disabled={sending||!title.trim()||!message.trim()} className="min-h-12 w-full rounded-2xl bg-violet-500 px-4 text-sm font-semibold shadow-lg shadow-violet-500/10 disabled:opacity-40">{sending?'Sending…':'Send official announcement'}</button>
      </div>
    </section>}

    {view==='compose'&&!canSend&&<div className="rounded-2xl border border-white/[.06] p-8 text-center text-sm text-[#6D7182]">This role cannot publish announcements.</div>}

    {view==='history'&&<div className="space-y-3">
      {historyError&&<div className="rounded-xl border border-red-500/15 bg-red-500/[.05] p-3 text-xs text-red-300">Could not load announcement history: {historyError}</div>}
      {!historyError&&!history.length&&<div className="rounded-2xl border border-dashed border-white/[.08] p-10 text-center text-sm text-[#6D7182]">No announcements sent yet.</div>}
      {history.map(row=><AnnouncementCard key={row.id} row={row} canDelete={canSend} onDelete={()=>void remove(Number(row.id))}/>) }
    </div>}
  </div>;
}

function RoleChoice({label,selected,onChange}:{label:string;selected:boolean;onChange:(value:boolean)=>void}){return <button onClick={()=>onChange(!selected)} className={`flex min-h-12 items-center gap-3 rounded-2xl border px-3 text-left text-xs ${selected?'border-violet-500/25 bg-violet-500/[.08] text-violet-100':'border-white/[.06] bg-white/[.02] text-[#B5B8C3]'}`}><span className={`grid h-5 w-5 shrink-0 place-items-center rounded-md border text-[10px] ${selected?'border-violet-500 bg-violet-500':'border-white/[.14]'}`}>{selected?'✓':''}</span>{label}</button>}
function AnnouncementCard({row,canDelete,onDelete}:{row:any;canDelete:boolean;onDelete:()=>void}){const[expanded,setExpanded]=useState(false);const body=String(row.content||'');const long=body.length>260;return <article className="rounded-2xl border border-white/[.06] bg-[#11131B] p-4 sm:p-5"><div className="flex items-start gap-3"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-violet-500/10 font-bold text-violet-300">W</div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-sm font-semibold">{row.title||'WeHouse update'}</p><p className="mt-1 text-[9px] text-[#626678]">{new Date(row.created_at).toLocaleString()}</p></div>{canDelete&&<button onClick={onDelete} className="text-[10px] text-red-300">Delete</button>}</div><p className="mt-3 whitespace-pre-wrap text-[11px] leading-6 text-[#D0D2DB]">{expanded||!long?body:body.slice(0,260)+'…'}</p>{long&&<button onClick={()=>setExpanded(value=>!value)} className="mt-2 text-[10px] font-semibold text-violet-300">{expanded?'Show less':'Read more'}</button>}<div className="mt-3 flex flex-wrap gap-2 border-t border-white/[.05] pt-3 text-[9px] text-[#6C7080]"><span>{row.scope||'Platform-wide'}</span><span>·</span><span>{Number(row.recipient_count||0)} recipients</span><span>·</span><span>{Number(row.read_count||0)} read</span></div></div></div></article>}
