import { useEffect, useMemo, useState } from 'react';
import { getAllUsers } from '@/lib/supabase/admin';
import { supabase } from '@/lib/supabase';
import { NIGERIA_STATES } from '@/data/nigeria-locations';
import type { Profile } from '@/types';
import { toast } from 'sonner';

const MODULES: Record<string,string> = { operations:'Operations', finance:'Finance', support:'Support', verification:'Verification', field_officer:'Field Officer' };
type TeamRole='all'|'admin'|'staff';

export default function StaffListTab({ profile }: { profile: Profile }) {
  const creator=profile.role==='creator';
  const [team,setTeam]=useState<Profile[]>([]); const [assigned,setAssigned]=useState<Record<string,string>>({}); const [loading,setLoading]=useState(true); const [saving,setSaving]=useState<string|null>(null); const [filter,setFilter]=useState<TeamRole>('all'); const [search,setSearch]=useState('');
  async function load(){
    setLoading(true); let list:Profile[]=[];
    if(!creator){const {data,error}=await supabase.rpc('admin_get_my_branch_profiles',{p_role:'staff'});if(error){toast.error(error.message);setLoading(false);return;}list=(Array.isArray(data)?data:[]) as Profile[];}
    else {const {users,error}=await getAllUsers();if(error){toast.error('Unable to load WeHouse team');setLoading(false);return;}list=(users||[]).filter((u:any)=>u.role==='admin'||u.role==='staff') as Profile[];}
    setTeam(list);
    const staff=list.filter(s=>s.role==='staff');
    if(staff.length){const {data,error}=await supabase.from('staff_permissions').select('staff_id,permission').in('staff_id',staff.map(s=>s.user_id)).eq('is_active',true);if(error)toast.error(error.message);const map:Record<string,string>={};(data||[]).forEach((p:any)=>{map[p.staff_id]=p.permission});setAssigned(map);}else setAssigned({});
    setLoading(false);
  }
  useEffect(()=>{void load()},[profile.role,profile.assigned_state,profile.assigned_lga]);
  const shown=useMemo(()=>team.filter(p=>(!creator||filter==='all'||p.role===filter)&&(!search.trim()||[p.full_name,p.username,p.email,p.assigned_state,p.assigned_lga].filter(Boolean).join(' ').toLowerCase().includes(search.toLowerCase()))),[team,filter,search,creator]);
  async function changeModule(staffId:string,next:string){setSaving(staffId);const current=assigned[staffId]||'';if(current===next){setSaving(null);return;}if(!next&&current){const {error}=await supabase.rpc('manage_staff_permission',{p_staff_id:staffId,p_permission:current,p_enabled:false});if(error){toast.error(error.message);setSaving(null);return;}setAssigned(v=>({...v,[staffId]:''}));toast.success('Module removed');}else if(next){const {error}=await supabase.rpc('manage_staff_permission',{p_staff_id:staffId,p_permission:next,p_enabled:true});if(error){toast.error(error.message);setSaving(null);return;}setAssigned(v=>({...v,[staffId]:next}));toast.success('Module assigned');}setSaving(null);}
  async function reassign(person:Profile,state:string,lga:string){if(!creator||!state||!lga)return;setSaving(person.user_id);const {error}=await supabase.rpc('creator_reassign_branch',{p_target_user_id:person.user_id,p_new_state:state,p_new_lga:lga});if(error)toast.error(error.message);else{toast.success('Branch assignment updated');await load();}setSaving(null);}
  if(loading)return <div className="grid min-h-40 place-items-center"><div className="h-6 w-6 animate-spin rounded-full border-2 border-violet-500 border-t-transparent"/></div>;
  return <div className="space-y-4">
    <div><h3 className="text-sm font-bold text-white">{creator?'WeHouse team':'Branch staff'}</h3><p className="mt-1 text-[10px] text-[#6A6E80]">{creator?'Admins and Staff have one home here. Creator controls branch placement; Staff also receive one operational module.':'Only Staff assigned to your LGA are shown. Each Staff member has one operational module.'}</p></div>
    {creator&&<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><div className="flex gap-1">{(['all','admin','staff'] as TeamRole[]).map(v=><button key={v} onClick={()=>setFilter(v)} className={`rounded-xl px-3 py-2 text-[10px] font-semibold capitalize ${filter===v?'bg-violet-500 text-white':'border border-white/[0.06] text-[#777B8D]'}`}>{v==='all'?'All team':v+'s'}</button>)}</div><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search team or branch" className="h-10 w-full rounded-xl border border-white/[0.08] bg-[#141720] px-3 text-[10px] outline-none sm:max-w-xs"/></div>}
    {shown.length===0?<div className="rounded-xl border border-dashed border-white/[0.08] p-10 text-center text-xs text-[#66697B]">No team members match this view.</div>:<div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{shown.map(person=><TeamCard key={person.user_id} person={person} creator={creator} module={assigned[person.user_id]||''} saving={saving===person.user_id} onModule={changeModule} onReassign={reassign}/>)}</div>}
  </div>;
}

function TeamCard({person,creator,module,saving,onModule,onReassign}:{person:Profile;creator:boolean;module:string;saving:boolean;onModule:(id:string,v:string)=>Promise<void>;onReassign:(p:Profile,s:string,l:string)=>Promise<void>}){
  const [state,setState]=useState(person.assigned_state||''); const [lga,setLga]=useState(person.assigned_lga||'');
  const stateData=NIGERIA_STATES.find(x=>x.state===state); const changed=state!==String(person.assigned_state||'')||lga!==String(person.assigned_lga||'');
  return <div className="rounded-2xl border border-white/[0.06] bg-[#10131B] p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-xs font-semibold text-white">{person.full_name||person.username||'Team member'}</p><p className="mt-1 truncate text-[9px] text-[#66697B]">{person.email}</p><p className="mt-2 text-[9px] uppercase tracking-wide text-violet-300">{person.role}</p><p className="mt-1 text-[9px] text-[#535667]">{[person.assigned_lga,person.assigned_state].filter(Boolean).join(', ')||'No branch assigned'}</p></div>{saving&&<div className="h-4 w-4 animate-spin rounded-full border-2 border-violet-500 border-t-transparent"/>}</div>
    {creator&&<div className="mt-4 grid gap-2 sm:grid-cols-2"><select value={state} disabled={saving} onChange={e=>{setState(e.target.value);setLga('')}} className="h-10 rounded-xl border border-white/[0.08] bg-[#171A23] px-2 text-[10px] text-white"><option value="">State</option>{NIGERIA_STATES.map(x=><option key={x.state} value={x.state}>{x.state}</option>)}</select><select value={lga} disabled={saving||!state} onChange={e=>setLga(e.target.value)} className="h-10 rounded-xl border border-white/[0.08] bg-[#171A23] px-2 text-[10px] text-white"><option value="">LGA</option>{(stateData?.cities||[]).map(x=><option key={x} value={x}>{x}</option>)}</select>{changed&&state&&lga&&<button disabled={saving} onClick={()=>void onReassign(person,state,lga)} className="sm:col-span-2 rounded-xl bg-violet-500 px-3 py-2 text-[10px] font-semibold text-white">Save branch assignment</button>}</div>}
    {person.role==='staff'&&<><label className="mt-4 block text-[9px] uppercase tracking-wide text-[#5E6375]">Operational module</label><select value={module} disabled={saving} onChange={e=>void onModule(person.user_id,e.target.value)} className="mt-2 h-10 w-full rounded-xl border border-white/[0.08] bg-[#171A23] px-3 text-[10px] text-white"><option value="">No module</option>{Object.entries(MODULES).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></>}
  </div>;
}
