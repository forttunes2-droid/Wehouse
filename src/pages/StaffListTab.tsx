import { useEffect,useMemo,useState } from 'react';
import { toast } from 'sonner';
import { getAllUsers } from '@/lib/supabase/admin';
import { supabase } from '@/lib/supabase';
import { NIGERIA_STATES } from '@/data/nigeria-locations';
import type { Profile } from '@/types';
import WeHouseSelect from '@/components/WeHouseSelect';

const MODULES:Record<string,string>={operations:'Property Operations',finance:'Finance',support:'Human Support',security:'Security Operations',verification:'Worker Verification',field_officer:'Field Operations'};
type RoleFilter='all'|'admin'|'staff';

export default function StaffListTab({profile}:{profile:Profile}){
 const creator=profile.role==='creator';
 const[team,setTeam]=useState<Profile[]>([]),[assigned,setAssigned]=useState<Record<string,string>>({}),[loading,setLoading]=useState(true),[saving,setSaving]=useState<string|null>(null),[selected,setSelected]=useState<Profile|null>(null);
 const[role,setRole]=useState<RoleFilter>('all'),[state,setState]=useState(''),[lga,setLga]=useState(''),[search,setSearch]=useState('');
 async function load(){setLoading(true);let list:Profile[]=[];if(creator){const{users,error}=await getAllUsers();if(error)toast.error('Unable to load WeHouse team');list=(users||[]).filter((item:any)=>item.role==='admin'||item.role==='staff') as Profile[]}else{const{data,error}=await supabase.rpc('admin_get_my_branch_profiles',{p_role:'staff'});if(error)toast.error(error.message);list=(Array.isArray(data)?data:[]) as Profile[]}setTeam(list);const ids=list.filter(x=>x.role==='staff').map(x=>x.user_id);if(ids.length){const{data,error}=await supabase.from('staff_permissions').select('staff_id,permission').in('staff_id',ids).eq('is_active',true);if(error)toast.error(error.message);const map:Record<string,string>={};(data||[]).forEach((row:any)=>map[row.staff_id]=row.permission);setAssigned(map)}else setAssigned({});setLoading(false)}
 useEffect(()=>{void load()},[profile.role,profile.assigned_state,profile.assigned_lga]);
 const stateData=NIGERIA_STATES.find(x=>x.state===state);
 const shown=useMemo(()=>{const q=search.trim().toLowerCase();return team.filter(x=>(!creator||role==='all'||x.role===role)&&(!state||x.assigned_state===state)&&(!lga||x.assigned_lga===lga)&&(!q||[x.full_name,x.username,x.email,x.user_id,x.assigned_state,x.assigned_lga].filter(Boolean).join(' ').toLowerCase().includes(q)))},[team,creator,role,state,lga,search]);
 async function moduleFor(person:Profile,next:string):Promise<void>{setSaving(person.user_id);const current=assigned[person.user_id]||'';if(current&&current!==next){const off=await supabase.rpc('manage_staff_permission',{p_staff_id:person.user_id,p_permission:current,p_enabled:false});if(off.error){setSaving(null);toast.error(off.error.message);return}}if(next){const on=await supabase.rpc('manage_staff_permission',{p_staff_id:person.user_id,p_permission:next,p_enabled:true});if(on.error){setSaving(null);toast.error(on.error.message);return}}setAssigned(v=>({...v,[person.user_id]:next}));setSaving(null);toast.success(next?'Staff responsibility updated':'Staff responsibility removed')}
 async function reassign(person:Profile,nextState:string,nextLga:string):Promise<void>{if(!creator||!nextState||!nextLga)return;setSaving(person.user_id);const{error}=await supabase.rpc('creator_reassign_branch',{p_target_user_id:person.user_id,p_new_state:nextState,p_new_lga:nextLga});setSaving(null);if(error){toast.error(error.message);return}toast.success('Branch assignment updated');setSelected(null);void load()}
 if(loading)return <div className="grid min-h-52 place-items-center">
<div className="h-6 w-6 animate-spin rounded-full border-2 border-violet-500 border-t-transparent"/>
</div>;
 return <div className="space-y-4">
  <div>
<h2 className="text-lg font-bold">{creator?'WeHouse team':'Branch Staff'}</h2>
<p className="mt-1 text-[10px] text-[#707687]">Role, branch and one operational responsibility per Staff account. Worker Verification remains separate from Security Operations.</p>
</div>
  <div className="grid grid-cols-3 gap-2">
<Metric label="Admins" value={team.filter(x=>x.role==='admin').length}/>
<Metric label="Staff" value={team.filter(x=>x.role==='staff').length}/>
<Metric label="Unassigned" value={team.filter(x=>x.role==='staff'&&!assigned[x.user_id]).length}/>
</div>
  <section className="rounded-2xl border border-white/[.06] bg-[#0D1017] p-3">
<input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search team" className="h-11 w-full rounded-xl border border-white/[.08] bg-[#151821] px-3 text-xs outline-none"/>
<div className="mt-2 flex gap-2 overflow-x-auto">{creator&&<Picker label={role==='all'?'All roles':role==='admin'?'Admins':'Staff'} value={role} options={[['all','All roles'],['admin','Admins'],['staff','Staff']]} onChange={value=>setRole(value as RoleFilter)}/>} {creator&&<Picker label={state||'All states'} value={state} options={[['','All states'],...NIGERIA_STATES.map(x=>[x.state,x.state] as [string,string])]} onChange={value=>{setState(value);setLga('')}}/>} {creator&&<Picker label={lga||'All LGAs'} value={lga} disabled={!state} options={[['','All LGAs'],...(stateData?.cities||[]).map(x=>[x,x] as [string,string])]} onChange={setLga}/>}</div>
</section>
  {shown.length===0?<Empty/>:<div className="overflow-hidden rounded-2xl border border-white/[.06] bg-[#10131B] divide-y divide-white/[.05]">{shown.map(person=>
<button key={person.user_id} onClick={()=>setSelected(person)} className="flex w-full items-center gap-3 px-4 py-3.5 text-left hover:bg-white/[.02]">
<Avatar person={person}/>
<div className="min-w-0 flex-1">
<p className="truncate text-xs font-semibold">{person.full_name||person.username||'Team member'}</p>
<p className="mt-1 truncate text-[9px] text-[#666D7E]">{person.email}</p>
</div>
<div className="shrink-0 text-right">
<p className="text-[9px] capitalize text-violet-300">{person.role}</p>
<p className="mt-1 text-[8px] text-[#666D7E]">{person.role==='staff'?(MODULES[assigned[person.user_id]]||'No responsibility'):'Branch administration'}</p>
</div>
</button>)}</div>}
  {selected&&<Manage person={selected} creator={creator} module={assigned[selected.user_id]||''} saving={saving===selected.user_id} close={()=>setSelected(null)} saveModule={moduleFor} reassign={reassign}/>}
 </div>
}

function Manage({person,creator,module,saving,close,saveModule,reassign}:{person:Profile;creator:boolean;module:string;saving:boolean;close:()=>void;saveModule:(p:Profile,v:string)=>Promise<void>;reassign:(p:Profile,s:string,l:string)=>Promise<void>}){const[s,setS]=useState(person.assigned_state||''),[l,setL]=useState(person.assigned_lga||'');const data=NIGERIA_STATES.find(x=>x.state===s);return <div className="fixed inset-0 z-[100020] bg-black/75" onClick={close}>
<aside onClick={e=>e.stopPropagation()} className="absolute inset-x-0 bottom-0 max-h-[90dvh] overflow-y-auto rounded-t-3xl border-t border-white/[.08] bg-[#0D1017] p-5 sm:inset-y-0 sm:left-auto sm:right-0 sm:w-[440px] sm:rounded-none sm:border-l">
<div className="flex items-center gap-3">
<Avatar person={person}/>
<div className="min-w-0 flex-1">
<p className="truncate text-sm font-bold">{person.full_name||person.username}</p>
<p className="truncate text-[9px] text-[#666D7E]">{person.email}</p>
</div>
<button onClick={close} className="h-10 w-10 rounded-full border border-white/[.08]">×</button>
</div>
<div className="mt-5 space-y-4">{creator&&<section className="rounded-2xl border border-white/[.06] bg-[#11151D] p-4">
<p className="text-xs font-semibold">Branch assignment</p>
<p className="mt-1 text-[9px] text-[#666D7E]">Controls the geographical records this account can access.</p>
<div className="mt-3 grid grid-cols-2 gap-2">
<WeHouseSelect value={s} onChange={value=>{setS(value);setL('')}} options={[{value:'',label:'Choose state'},...NIGERIA_STATES.map(x=>({value:x.state,label:x.state}))]} title="Choose staff state" ariaLabel="Choose staff state" className="h-11 w-full"/>
<WeHouseSelect value={l} disabled={!s} onChange={setL} options={[{value:'',label:'Choose LGA'},...(data?.cities||[]).map(x=>({value:x,label:x}))]} title="Choose staff LGA" ariaLabel="Choose staff LGA" className="h-11 w-full"/>
</div>
<button disabled={saving||!s||!l} onClick={()=>void reassign(person,s,l)} className="mt-2 h-10 w-full rounded-xl bg-violet-500 text-[10px] font-semibold disabled:opacity-40">Save branch</button>
</section>}{person.role==='staff'&&<section className="rounded-2xl border border-white/[.06] bg-[#11151D] p-4">
<p className="text-xs font-semibold">Operational responsibility</p>
<p className="mt-1 text-[9px] text-[#666D7E]">Assign exactly one module. Security observes and escalates; account sanctions stay with Admin and Creator.</p>
<div className="mt-3"><WeHouseSelect value={module} disabled={saving} onChange={value=>void saveModule(person,value)} options={[{value:'',label:'No responsibility'},...Object.entries(MODULES).map(([value,label])=>({value,label}))]} title="Choose staff responsibility" ariaLabel="Choose staff responsibility" className="h-11 w-full"/></div>
</section>}</div>
</aside>
</div>}
function Picker({label,value,options,onChange,disabled=false}:{label:string;value:string;options:[string,string][];onChange:(value:string)=>void;disabled?:boolean}){const[open,setOpen]=useState(false);return <><button disabled={disabled} onClick={()=>setOpen(true)} className="flex h-10 shrink-0 items-center gap-2 rounded-full border border-white/[.08] bg-[#151821] px-3 text-[10px] disabled:opacity-35"><span className="max-w-28 truncate">{label}</span><span className="text-[#747B8B]">⌄</span></button>{open&&<div className="fixed inset-0 z-[100030] flex items-end bg-black/70 backdrop-blur-sm" onClick={()=>setOpen(false)}><section className="max-h-[76dvh] w-full overflow-hidden rounded-t-[30px] bg-[#11151D] pb-[max(1rem,env(safe-area-inset-bottom))]" onClick={e=>e.stopPropagation()}><div className="mx-auto my-3 h-1 w-10 rounded-full bg-white/15"/><div className="flex items-center justify-between px-5 pb-3"><h3 className="text-base font-bold">Filter team</h3><button onClick={()=>setOpen(false)} className="grid h-9 w-9 place-items-center rounded-full bg-white/[.05]">×</button></div><div className="max-h-[60dvh] overflow-y-auto px-3">{options.map(([id,text])=><button key={id||'all'} onClick={()=>{onChange(id);setOpen(false)}} className="flex min-h-12 w-full items-center justify-between border-b border-white/[.05] px-3 text-left text-xs"><span>{text}</span>{value===id&&<span className="text-violet-300">✓</span>}</button>)}</div></section></div>}</>}
function Avatar({person}:{person:Profile}){const text=person.full_name||person.username||person.email||'W';return <div className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-xl bg-violet-500/15 text-xs font-bold">{person.avatar_url?<img src={person.avatar_url} alt="" className="h-full w-full object-cover"/>:text[0].toUpperCase()}</div>}
function Metric({label,value}:{label:string;value:number}){return <div className="rounded-xl border border-white/[.05] bg-[#10131B] p-3">
<p className="text-lg font-bold">{value}</p>
<p className="text-[8px] text-[#62697A]">{label}</p>
</div>}
function Empty(){return <div className="rounded-2xl border border-dashed border-white/[.08] p-10 text-center text-xs text-[#66697B]">No team members match this view.</div>}
