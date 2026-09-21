import WorkspaceSectionHeading from '@/components/WorkspaceSectionHeading';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { withTimeout } from '@/lib/withTimeout';
import { supabase } from '@/lib/supabase';
import { NIGERIA_STATES } from '@/data/nigeria-locations';
import type { Profile } from '@/types';
import WeHouseSelect from '@/components/WeHouseSelect';
import { useCreatorAuth } from '@/hooks/useCreatorAuth';

type RoleFilter='all'|'admin'|'staff';
type ScopeType='state'|'branch';
type OperationId='property_operations'|'worker_operations'|'field_operations'|'support'|'finance_operations'|'security_operations';
type TeamMember={
  user_id:string;
  full_name?:string|null;
  username?:string|null;
  email?:string|null;
  avatar_url?:string|null;
  role:'admin'|'staff';
  scope_type?:ScopeType;
  assigned_state?:string|null;
  assigned_lga?:string|null;
  can_manage_staff?:boolean;
  work_areas?:string[];
};
type EligiblePerson={
  user_id:string;
  full_name?:string|null;
  username?:string|null;
  email?:string|null;
  avatar_url?:string|null;
  state?:string|null;
  local_government?:string|null;
  city?:string|null;
};
type Capacity={active:number;max:number};
type AdminAuthority={
  admin_user_id:string;
  scope_type:ScopeType;
  state:string;
  lga?:string|null;
  can_manage_staff:boolean;
  limits:Record<OperationId,Capacity>;
};
type ChangeRow={
  event_id:string;
  actor_name:string;
  action_label:string;
  area_label:string;
  subject_label:string;
  occurred_at:string;
};

const OPERATIONS:Array<{id:OperationId;label:string;note:string}>=[
  {id:'property_operations',label:'Property Operations',note:'Property submissions, visits and publication preparation'},
  {id:'worker_operations',label:'Worker Operations',note:'Worker onboarding, identity and professional evidence'},
  {id:'field_operations',label:'Field Operations',note:'Physical inspections, access and handovers'},
  {id:'support',label:'Support',note:'Ordinary WeHouse help conversations'},
  {id:'finance_operations',label:'Finance Operations',note:'Payment reviews, payouts and financial records'},
  {id:'security_operations',label:'Security Operations',note:'Account security signals and escalations'},
];
const OPERATION_IDS=OPERATIONS.map(item=>item.id);

function canonicalOperation(value:string|null|undefined):OperationId|null{
  const key=String(value||'').trim().toLowerCase();
  const aliases:Record<string,OperationId>={
    operations:'property_operations',
    property_operations:'property_operations',
    worker_review:'worker_operations',
    verification:'worker_operations',
    worker_verification:'worker_operations',
    worker_operations:'worker_operations',
    field_officer:'field_operations',
    field_operation:'field_operations',
    field_operations:'field_operations',
    finance:'finance_operations',
    finance_operations:'finance_operations',
    security:'security_operations',
    security_operations:'security_operations',
    support:'support',
  };
  return aliases[key]||null;
}
function operationLabel(value:string|null|undefined){
  const id=canonicalOperation(value);
  return OPERATIONS.find(item=>item.id===id)?.label||'No Operation assigned';
}
function memberOperation(member:TeamMember){
  const areas=[...new Set((member.work_areas||[]).map(canonicalOperation).filter((v):v is OperationId=>Boolean(v)))];
  return areas.length===1?areas[0]:areas.length>1?'conflict':'';
}
function coverageLabel(scope?:ScopeType,state?:string|null,lga?:string|null){
  if(scope==='state')return state?state+' State':'State not assigned';
  return [lga,state].filter(Boolean).join(', ')||'Coverage not assigned';
}

export default function StaffListTab({profile}:{profile:Profile}){
  const creator=profile.role==='creator';
  const{requestElevation}=useCreatorAuth();
  const[team,setTeam]=useState<TeamMember[]>([]);
  const[loading,setLoading]=useState(true);
  const[loadError,setLoadError]=useState('');
  const[search,setSearch]=useState('');
  const[role,setRole]=useState<RoleFilter>('all');
  const[state,setState]=useState('');
  const[lga,setLga]=useState('');
  const[selected,setSelected]=useState<TeamMember|null>(null);
  const[addOpen,setAddOpen]=useState(false);
  const[ownAuthority,setOwnAuthority]=useState<AdminAuthority|null>(null);
  const generation=useRef(0);

  async function load(){
    const request=++generation.current;
    setLoading(true);setLoadError('');
    try{
      const teamResult=await withTimeout(supabase.rpc('get_my_managed_team'),15000,'Team access could not be loaded.');
      if(teamResult.error)throw teamResult.error;
      let authority:AdminAuthority|null=null;
      if(!creator){
        const authorityResult=await withTimeout(supabase.rpc('get_admin_team_authority'),15000,'Admin authority could not be loaded.');
        if(authorityResult.error)throw authorityResult.error;
        authority=authorityResult.data as AdminAuthority;
      }
      if(request!==generation.current)return;
      setTeam(Array.isArray(teamResult.data)?teamResult.data as TeamMember:[]);
      setOwnAuthority(authority);
    }catch(error){
      if(request===generation.current){
        setTeam([]);setOwnAuthority(null);
        setLoadError((error as {message?:string})?.message||'WeHouse team could not be loaded.');
      }
    }finally{if(request===generation.current)setLoading(false)}
  }
  useEffect(()=>{setSelected(null);void load();return()=>{generation.current++}},[profile.user_id,profile.role]);

  const stateData=NIGERIA_STATES.find(item=>item.state===state);
  const shown=useMemo(()=>{
    const q=search.trim().toLowerCase();
    return team.filter(person=>
      (role==='all'||person.role===role)&&
      (!state||person.assigned_state===state)&&
      (!lga||person.assigned_lga===lga)&&
      (!q||[
        person.full_name,person.username,person.email,person.user_id,
        person.assigned_state,person.assigned_lga,
        coverageLabel(person.scope_type,person.assigned_state,person.assigned_lga),
        ...(person.work_areas||[]),
      ].filter(Boolean).join(' ').toLowerCase().includes(q))
    );
  },[team,role,state,lga,search]);
  const staff=team.filter(person=>person.role==='staff');
  const needsSetup=staff.filter(person=>!memberOperation(person)||memberOperation(person)==='conflict').length;
  const canAdd=creator||Boolean(ownAuthority?.can_manage_staff);

  function elevated(run:(elevationId:string)=>Promise<void>){
    requestElevation('staff_authority',elevationId=>void run(elevationId));
  }

  if(loading)return <Loading/>;
  if(loadError)return <div role="alert" className="py-6 text-sm"><p>{loadError}</p><button onClick={()=>void load()} className="min-h-11 text-violet-300">Try again</button></div>;

  return <div className="space-y-4">
    <WorkspaceSectionHeading
      title="WeHouse Team"
      description={creator?'Admins and Operations members. Authority, coverage and capacity are managed here.':'Team members inside '+coverageLabel(ownAuthority?.scope_type,ownAuthority?.state,ownAuthority?.lga)+'.'}
    />

    {!creator&&ownAuthority&&<section className="rounded-2xl border border-white/[.06] bg-[#10131B] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[9px] font-semibold uppercase tracking-[.12em] text-[#686E80]">Your authority</p>
          <p className="mt-1 text-sm font-semibold">{coverageLabel(ownAuthority.scope_type,ownAuthority.state,ownAuthority.lga)}</p>
          <p className="mt-1 text-[9px] text-[#6D7384]">{ownAuthority.can_manage_staff?'Team management enabled by Creator':'Team management not enabled'}</p>
        </div>
        <span className="rounded-full border border-white/[.07] px-2.5 py-1 text-[9px] text-violet-300">{ownAuthority.scope_type==='state'?'Whole State':'One LGA'}</span>
      </div>
      {ownAuthority.can_manage_staff&&<CapacityStrip authority={ownAuthority}/>}
    </section>}

    <div className="grid grid-cols-3 gap-2">
      <Metric label="Admins" value={team.filter(person=>person.role==='admin').length}/>
      <Metric label="Operations" value={staff.length}/>
      <Metric label="Needs review" value={needsSetup}/>
    </div>

    <section className="rounded-2xl border border-white/[.06] bg-[#0D1017] p-3">
      <div className="flex gap-2">
        <input value={search} onChange={event=>setSearch(event.target.value)} placeholder="Search team" className="h-11 min-w-0 flex-1 rounded-xl border border-white/[.08] bg-[#151821] px-3 text-xs outline-none"/>
        {canAdd&&<button onClick={()=>setAddOpen(true)} className="h-11 shrink-0 rounded-xl bg-violet-500 px-4 text-[10px] font-semibold">Add member</button>}
      </div>
      <div className="mt-2 flex gap-2 overflow-x-auto">
        <Picker label={role==='all'?'All team':role==='admin'?'Admins':'Operations'} value={role} options={[['all','All team'],['admin','Admins'],['staff','Operations']]} onChange={value=>setRole(value as RoleFilter)}/>
        {creator&&<Picker label={state||'All states'} value={state} options={[['','All states'],...NIGERIA_STATES.map(item=>[item.state,item.state] as [string,string])]} onChange={value=>{setState(value);setLga('')}}/>}
        {creator&&<Picker label={lga||'All LGAs'} value={lga} disabled={!state} options={[['','All LGAs'],...(stateData?.cities||[]).map(city=>[city,city] as [string,string])]} onChange={setLga}/>}
      </div>
    </section>

    {shown.length===0?<Empty text={canAdd?'No team members match this view. Add an existing Personal account when you are ready.':'No team members match this view.'}/>:<div className="overflow-hidden rounded-2xl border border-white/[.06] bg-[#10131B] divide-y divide-white/[.05]">
      {shown.map(person=>{
        const op=memberOperation(person);
        return <button key={person.user_id} onClick={()=>setSelected(person)} className="flex w-full items-center gap-3 px-4 py-3.5 text-left hover:bg-white/[.02]">
          <Avatar person={person}/>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold">{person.full_name||person.username||'Team member'}</p>
            <p className="mt-1 truncate text-[9px] text-[#666D7E]">{person.email}</p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-[9px] text-violet-300">{person.role==='admin'?'Admin':'Operations'}</p>
            <p className="mt-1 max-w-40 truncate text-[8px] text-[#666D7E]">{person.role==='admin'?(person.can_manage_staff?'Can manage team':'Creator-managed'):op==='conflict'?'Multiple Operations — review':operationLabel(op)}</p>
            <p className="mt-1 text-[8px] text-[#555C6D]">{coverageLabel(person.scope_type,person.assigned_state,person.assigned_lga)}</p>
          </div>
        </button>;
      })}
    </div>}

    {selected&&<ManageMember
      person={selected}
      creator={creator}
      adminAuthority={ownAuthority}
      elevate={elevated}
      onClose={()=>setSelected(null)}
      onChanged={async()=>{setSelected(null);await load()}}
    />}
    {addOpen&&<AddMember
      creator={creator}
      adminAuthority={ownAuthority}
      elevate={elevated}
      onClose={()=>setAddOpen(false)}
      onAdded={async()=>{setAddOpen(false);await load()}}
    />}
  </div>;
}

function CapacityStrip({authority}:{authority:AdminAuthority}){
  return <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-white/[.05] pt-3 sm:grid-cols-3">
    {OPERATIONS.map(operation=>{
      const capacity=authority.limits?.[operation.id]||{active:0,max:0};
      return <div key={operation.id} className="min-w-0"><p className="truncate text-[8px] text-[#666D7E]">{operation.label.replace(' Operations','')}</p><p className="mt-0.5 text-[10px] font-semibold">{capacity.active} / {capacity.max}</p></div>;
    })}
  </div>;
}

function ManageMember({person,creator,adminAuthority,elevate,onClose,onChanged}:{person:TeamMember;creator:boolean;adminAuthority:AdminAuthority|null;elevate:(run:(id:string)=>Promise<void>)=>void;onClose:()=>void;onChanged:()=>Promise<void>}){
  const currentOperation=memberOperation(person);
  const[operation,setOperation]=useState<OperationId|string>(currentOperation);
  const[scopeType,setScopeType]=useState<ScopeType>(person.scope_type||'branch');
  const[state,setState]=useState(person.assigned_state||'');
  const[lga,setLga]=useState(person.assigned_lga||'');
  const[saving,setSaving]=useState(false);
  const[authority,setAuthority]=useState<AdminAuthority|null>(null);
  const[canManage,setCanManage]=useState(false);
  const[limits,setLimits]=useState<Record<OperationId,number>>(Object.fromEntries(OPERATION_IDS.map(id=>[id,0])) as Record<OperationId,number>);
  const stateData=NIGERIA_STATES.find(item=>item.state===state);

  useEffect(()=>{
    if(!creator||person.role!=='admin')return;
    void(async()=>{
      const{data,error}=await supabase.rpc('get_admin_team_authority',{p_admin_user_id:person.user_id});
      if(error)return toast.error(error.message);
      const next=data as AdminAuthority;
      setAuthority(next);setScopeType(next.scope_type);setState(next.state||'');setLga(next.lga||'');setCanManage(Boolean(next.can_manage_staff));
      setLimits(Object.fromEntries(OPERATION_IDS.map(id=>[id,Number(next.limits?.[id]?.max||0)])) as Record<OperationId,number>);
    })();
  },[creator,person.user_id,person.role]);

  async function saveOperation(elevationId?:string){
    if(person.role!=='staff'||!operation||operation==='conflict'||operation===currentOperation)return;
    setSaving(true);
    const args:any={p_staff_id:person.user_id,p_permission:operation,p_enabled:true};
    if(creator)args.p_creator_elevation_id=elevationId;
    const{error}=await supabase.rpc('manage_staff_permission',args);
    setSaving(false);
    if(error)return toast.error(error.message);
    toast.success('Operation updated');
    await onChanged();
  }
  function submitOperation(){
    if(creator){elevate(id=>saveOperation(id));return}
    if(!adminAuthority?.can_manage_staff)return toast.error('Creator has not enabled Team management for this Admin');
    void saveOperation();
  }
  async function saveCoverage(elevationId:string){
    setSaving(true);
    const{error}=await supabase.rpc('creator_reassign_branch',{
      p_target_user_id:person.user_id,
      p_new_state:state,
      p_new_lga:scopeType==='branch'?lga:null,
      p_creator_elevation_id:elevationId,
    });
    setSaving(false);
    if(error)return toast.error(error.message);
    toast.success(scopeType==='state'?'State coverage saved':'LGA coverage saved');
    await onChanged();
  }
  async function saveAuthority(elevationId:string){
    if(person.role!=='admin')return;
    setSaving(true);
    const{error}=await supabase.rpc('creator_set_admin_authority',{
      p_admin_user_id:person.user_id,
      p_scope_type:scopeType,
      p_state:state,
      p_lga:scopeType==='branch'?lga:null,
      p_can_manage_staff:canManage,
      p_limits:Object.fromEntries(OPERATION_IDS.map(id=>[id,Math.max(0,Number(limits[id]||0))])),
      p_creator_elevation_id:elevationId,
    });
    setSaving(false);
    if(error)return toast.error(error.message);
    toast.success('Admin authority updated');
    await onChanged();
  }
  async function removeAccess(elevationId:string){
    setSaving(true);
    const{error}=await supabase.rpc('creator_set_team_role',{
      p_target_user_id:person.user_id,p_new_role:'user',p_state:null,p_lga:null,p_module:null,p_creator_elevation_id:elevationId,
    });
    setSaving(false);
    if(error)return toast.error(error.message);
    toast.success('WeHouse Team access removed');
    await onChanged();
  }

  return <Sheet onClose={onClose}>
    <div className="flex items-center gap-3">
      <Avatar person={person}/>
      <div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{person.full_name||person.username||'Team member'}</p><p className="truncate text-[9px] text-[#666D7E]">{person.email}</p></div>
      <button onClick={onClose} className="h-10 w-10 rounded-full border border-white/[.08]">×</button>
    </div>

    <section className="mt-5 rounded-2xl border border-white/[.06] bg-[#11151D] p-4">
      <p className="text-[9px] font-semibold uppercase tracking-[.12em] text-[#666D7E]">Access</p>
      <div className="mt-2 flex items-center justify-between gap-3"><div><p className="text-xs font-semibold">{person.role==='admin'?'Admin':'Operations member'}</p><p className="mt-1 text-[9px] text-[#666D7E]">{coverageLabel(person.scope_type,person.assigned_state,person.assigned_lga)}</p></div><span className="text-[9px] text-violet-300">{person.scope_type==='state'?'Whole State':'One LGA'}</span></div>
    </section>

    {person.role==='staff'&&<section className="mt-4 rounded-2xl border border-white/[.06] bg-[#11151D] p-4">
      <p className="text-xs font-semibold">Operation</p>
      <p className="mt-1 text-[9px] text-[#666D7E]">One person gets one WeHouse Operation. Changing it replaces the previous Operation.</p>
      <div className="mt-3"><WeHouseSelect value={operation} disabled={saving||(!creator&&!adminAuthority?.can_manage_staff)} onChange={setOperation} options={[
        ...(currentOperation==='conflict'?[{value:'conflict',label:'Multiple Operations — choose one'}]:[]),
        ...OPERATIONS.map(item=>({value:item.id,label:item.label,description:item.note})),
      ]} title="Choose Operation" ariaLabel="Choose one Operation" className="h-11 w-full"/></div>
      <button disabled={saving||!operation||operation==='conflict'||operation===currentOperation||(!creator&&!adminAuthority?.can_manage_staff)} onClick={submitOperation} className="mt-3 min-h-11 w-full rounded-xl bg-violet-500 text-xs font-semibold disabled:opacity-40">{saving?'Saving…':'Save Operation'}</button>
    </section>}

    {creator&&person.role==='staff'&&<CoverageEditor scopeType={scopeType} setScopeType={setScopeType} state={state} setState={value=>{setState(value);setLga('')}} lga={lga} setLga={setLga} stateData={stateData} saving={saving} onSave={()=>elevate(saveCoverage)}/>}

    {creator&&person.role==='admin'&&<section className="mt-4 rounded-2xl border border-white/[.06] bg-[#11151D] p-4">
      <p className="text-xs font-semibold">Authority</p>
      <p className="mt-1 text-[9px] leading-4 text-[#666D7E]">Creator controls this Admin's coverage, whether they can add Operations members, and the maximum team size for each Operation.</p>
      <div className="mt-4">
        <CoverageFields scopeType={scopeType} setScopeType={setScopeType} state={state} setState={value=>{setState(value);setLga('')}} lga={lga} setLga={setLga} stateData={stateData}/>
      </div>
      <label className="mt-4 flex min-h-12 items-center justify-between gap-3 border-y border-white/[.06] py-3"><span><strong className="block text-[11px]">Allow team management</strong><span className="mt-1 block text-[9px] text-[#666D7E]">Can add Operations members inside this coverage only.</span></span><input type="checkbox" checked={canManage} onChange={event=>setCanManage(event.target.checked)} className="h-5 w-5 accent-violet-500"/></label>
      <div className="mt-4 space-y-3">
        <div><p className="text-[10px] font-semibold">Operation limits</p><p className="mt-1 text-[8px] text-[#666D7E]">Current / maximum. The server refuses another assignment at the limit.</p></div>
        {OPERATIONS.map(item=>{
          const active=authority?.limits?.[item.id]?.active||0;
          return <label key={item.id} className="flex items-center justify-between gap-3"><span className="min-w-0"><strong className="block truncate text-[10px]">{item.label}</strong><span className="text-[8px] text-[#62697A]">{active} active</span></span><input type="number" min={0} max={1000} value={limits[item.id]} onChange={event=>setLimits(current=>({...current,[item.id]:Math.max(0,Number(event.target.value||0))}))} className="h-10 w-20 rounded-xl border border-white/[.08] bg-[#151821] px-2 text-center text-xs outline-none"/></label>;
        })}
      </div>
      <button disabled={saving||!state||(scopeType==='branch'&&!lga)} onClick={()=>elevate(saveAuthority)} className="mt-4 min-h-11 w-full rounded-xl bg-violet-500 text-xs font-semibold disabled:opacity-40">{saving?'Saving…':'Save Admin authority'}</button>
    </section>}

    {creator&&<ActivityMini person={person}/>}

    {creator&&<button disabled={saving} onClick={()=>elevate(removeAccess)} className="mt-5 min-h-11 w-full rounded-xl border border-red-500/20 bg-red-500/[.06] text-xs font-semibold text-red-300 disabled:opacity-40">Remove WeHouse Team access</button>}
  </Sheet>;
}

function CoverageEditor({scopeType,setScopeType,state,setState,lga,setLga,stateData,saving,onSave}:{scopeType:ScopeType;setScopeType:(v:ScopeType)=>void;state:string;setState:(v:string)=>void;lga:string;setLga:(v:string)=>void;stateData:{state:string;cities:string[]} | undefined;saving:boolean;onSave:()=>void}){
  return <section className="mt-4 rounded-2xl border border-white/[.06] bg-[#11151D] p-4">
    <p className="text-xs font-semibold">Coverage</p><p className="mt-1 text-[9px] text-[#666D7E]">Use State for shared Operations across the state, or One LGA when physical/local responsibility should be narrower.</p>
    <div className="mt-3"><CoverageFields scopeType={scopeType} setScopeType={setScopeType} state={state} setState={setState} lga={lga} setLga={setLga} stateData={stateData}/></div>
    <button disabled={saving||!state||(scopeType==='branch'&&!lga)} onClick={onSave} className="mt-3 min-h-11 w-full rounded-xl bg-violet-500 text-xs font-semibold disabled:opacity-40">{saving?'Saving…':'Save coverage'}</button>
  </section>;
}

function CoverageFields({scopeType,setScopeType,state,setState,lga,setLga,stateData,lockedState=false,lockedScope=false}:{scopeType:ScopeType;setScopeType:(v:ScopeType)=>void;state:string;setState:(v:string)=>void;lga:string;setLga:(v:string)=>void;stateData:{state:string;cities:string[]} | undefined;lockedState?:boolean;lockedScope?:boolean}){
  return <div className="space-y-2">
    <WeHouseSelect value={scopeType} disabled={lockedScope} onChange={value=>{setScopeType(value as ScopeType);if(value==='state')setLga('')}} options={[{value:'state',label:'Whole State',description:'Work across every LGA in the selected state'},{value:'branch',label:'One LGA',description:'Work only inside one local government area'}]} title="Coverage" ariaLabel="Choose coverage" className="h-11 w-full"/>
    <div className="grid grid-cols-2 gap-2">
      <WeHouseSelect value={state} disabled={lockedState} onChange={setState} options={[{value:'',label:'Choose state'},...NIGERIA_STATES.map(item=>({value:item.state,label:item.state}))]} title="State" ariaLabel="Choose state" className="h-11 w-full"/>
      <WeHouseSelect value={scopeType==='state'?'':lga} disabled={!state||scopeType==='state'||lockedScope} onChange={setLga} options={[{value:'',label:scopeType==='state'?'All LGAs':'Choose LGA'},...(stateData?.cities||[]).map(city=>({value:city,label:city}))]} title="LGA" ariaLabel="Choose LGA" className="h-11 w-full"/>
    </div>
  </div>;
}

function AddMember({creator,adminAuthority,elevate,onClose,onAdded}:{creator:boolean;adminAuthority:AdminAuthority|null;elevate:(run:(id:string)=>Promise<void>)=>void;onClose:()=>void;onAdded:()=>Promise<void>}){
  const[query,setQuery]=useState('');
  const[people,setPeople]=useState<EligiblePerson[]>([]);
  const[loading,setLoading]=useState(true);
  const[selected,setSelected]=useState<EligiblePerson|null>(null);
  const[teamRole,setTeamRole]=useState<'admin'|'staff'>('staff');
  const[operation,setOperation]=useState<OperationId>('property_operations');
  const initialScope:ScopeType=!creator&&adminAuthority?.scope_type==='branch'?'branch':'state';
  const[scopeType,setScopeType]=useState<ScopeType>(initialScope);
  const[state,setState]=useState(!creator?adminAuthority?.state||'':'');
  const[lga,setLga]=useState(!creator&&adminAuthority?.scope_type==='branch'?adminAuthority.lga||'':'');
  const[saving,setSaving]=useState(false);
  const stateData=NIGERIA_STATES.find(item=>item.state===state);
  const adminBranchLocked=!creator&&adminAuthority?.scope_type==='branch';
  const adminStateLocked=!creator;
  const adminScopeLocked=adminBranchLocked;

  async function loadPeople(value=query){
    setLoading(true);
    const{data,error}=await supabase.rpc('get_team_eligible_people',{p_search:value.trim()||null});
    setLoading(false);
    if(error){setPeople([]);return toast.error(error.message)}
    setPeople(Array.isArray(data)?data as EligiblePerson:[]);
  }
  useEffect(()=>{void loadPeople('')},[]);
  useEffect(()=>{const timer=window.setTimeout(()=>void loadPeople(query),260);return()=>window.clearTimeout(timer)},[query]);

  function choose(person:EligiblePerson){
    setSelected(person);
    if(creator&&person.state){setState(person.state);setLga(person.local_government||person.city||'');setScopeType('branch')}
  }

  async function create(elevationId?:string){
    if(!selected||!state||(scopeType==='branch'&&!lga))return;
    setSaving(true);
    if(creator){
      const{error}=await supabase.rpc('creator_set_team_role',{
        p_target_user_id:selected.user_id,p_new_role:teamRole,p_state:state,p_lga:scopeType==='branch'?lga:null,p_module:teamRole==='staff'?operation:null,p_creator_elevation_id:elevationId,
      });
      setSaving(false);
      if(error)return toast.error(error.message);
      toast.success(teamRole==='admin'?'Admin workspace granted. Configure authority next.':'Operations access granted');
      await onAdded();
      return;
    }
    const{error}=await supabase.rpc('admin_appoint_staff',{
      p_target_user_id:selected.user_id,p_module:operation,p_scope_type:scopeType,p_state:state,p_lga:scopeType==='branch'?lga:null,
    });
    setSaving(false);
    if(error)return toast.error(error.message);
    toast.success('Operations access granted');
    await onAdded();
  }
  function submit(){
    if(creator){elevate(id=>create(id));return}
    void create();
  }

  return <Sheet onClose={onClose}>
    <div className="flex items-center justify-between gap-3"><div><p className="text-sm font-bold">Add WeHouse Team member</p><p className="mt-1 text-[9px] text-[#666D7E]">Grant work access to an existing Personal account. Their Personal workspace stays intact.</p></div><button onClick={onClose} className="h-10 w-10 rounded-full border border-white/[.08]">×</button></div>
    {!selected?<div className="mt-5 space-y-3">
      <input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Search name, username or email" className="h-11 w-full rounded-xl border border-white/[.08] bg-[#151821] px-3 text-xs outline-none"/>
      {loading?<Loading compact/>:people.length===0?<Empty text="No eligible Personal accounts match this search."/>:<div className="max-h-[60dvh] divide-y divide-white/[.05] overflow-y-auto border-y border-white/[.06]">{people.map(person=><button key={person.user_id} onClick={()=>choose(person)} className="flex min-h-16 w-full items-center gap-3 py-3 text-left"><Avatar person={person}/><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold">{person.full_name||person.username||'Personal account'}</p><p className="truncate text-[9px] text-[#666D7E]">{person.email}</p><p className="mt-1 text-[8px] text-[#555C6D]">{[person.local_government||person.city,person.state].filter(Boolean).join(', ')||'Location not set'}</p></div><span className="text-[#666D7E]">›</span></button>)}</div>}
    </div>:<div className="mt-5 space-y-4">
      <button onClick={()=>setSelected(null)} className="text-[10px] font-semibold text-violet-300">← Choose another person</button>
      <div className="flex items-center gap-3 rounded-2xl border border-white/[.06] p-3"><Avatar person={selected}/><div className="min-w-0"><p className="truncate text-xs font-semibold">{selected.full_name||selected.username}</p><p className="truncate text-[9px] text-[#666D7E]">{selected.email}</p></div></div>
      {creator&&<WeHouseSelect value={teamRole} onChange={value=>setTeamRole(value as 'admin'|'staff')} options={[{value:'staff',label:'Operations member',description:'One internal Operation with explicit coverage'},{value:'admin',label:'Admin',description:'Administrative workspace. Team management starts off until Creator enables it.'}]} title="Team access" ariaLabel="Choose team access" className="h-11 w-full"/>}
      {(teamRole==='staff'||!creator)&&<WeHouseSelect value={operation} onChange={value=>setOperation(value as OperationId)} options={OPERATIONS.map(item=>({value:item.id,label:item.label,description:item.note}))} title="Operation" ariaLabel="Choose Operation" className="h-11 w-full"/>}
      <CoverageFields scopeType={scopeType} setScopeType={setScopeType} state={state} setState={value=>{setState(value);setLga('')}} lga={lga} setLga={setLga} stateData={stateData} lockedState={adminStateLocked} lockedScope={adminScopeLocked}/>
      {!creator&&adminAuthority&&<p className="rounded-xl border border-violet-500/10 bg-violet-500/[.04] p-3 text-[9px] leading-4 text-violet-200">Your Creator-set limit is enforced by the server. You cannot add outside {coverageLabel(adminAuthority.scope_type,adminAuthority.state,adminAuthority.lga)} or exceed an Operation capacity.</p>}
      <button disabled={saving||!state||(scopeType==='branch'&&!lga)} onClick={submit} className="min-h-12 w-full rounded-2xl bg-violet-500 text-xs font-semibold disabled:opacity-40">{saving?'Granting access…':'Grant team access'}</button>
    </div>}
  </Sheet>;
}

function ActivityMini({person}:{person:TeamMember}){
  const[rows,setRows]=useState<ChangeRow[]>([]);
  useEffect(()=>{void(async()=>{
    const{data}=await supabase.rpc('creator_get_change_history',{p_search:person.email||person.user_id,p_limit:8});
    setRows(Array.isArray(data)?data as ChangeRow:[]);
  })()},[person.user_id,person.email]);
  if(!rows.length)return null;
  return <section className="mt-4 rounded-2xl border border-white/[.06] bg-[#11151D] p-4">
    <p className="text-xs font-semibold">Recent activity</p>
    <div className="mt-2 divide-y divide-white/[.05]">{rows.slice(0,5).map(row=><div key={row.event_id} className="py-2.5"><div className="flex items-start justify-between gap-3"><p className="text-[10px] font-medium">{row.action_label} <span className="text-[#9A9EAB]">{row.subject_label}</span></p><span className="shrink-0 text-[8px] text-[#555C6D]">{new Date(row.occurred_at).toLocaleDateString()}</span></div><p className="mt-1 text-[8px] text-[#62697A]">{row.area_label} · {row.actor_name}</p></div>)}</div>
  </section>;
}

function Sheet({children,onClose}:{children:React.ReactNode;onClose:()=>void}){
  return <div className="fixed inset-0 z-[100020] bg-black/75" onClick={onClose}><aside onClick={event=>event.stopPropagation()} className="absolute inset-x-0 bottom-0 max-h-[92dvh] overflow-y-auto rounded-t-3xl border-t border-white/[.08] bg-[#0D1017] p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:inset-y-0 sm:left-auto sm:right-0 sm:w-[460px] sm:rounded-none sm:border-l">{children}</aside></div>;
}
function Picker({label,value,options,onChange,disabled=false}:{label:string;value:string;options:[string,string][];onChange:(value:string)=>void;disabled?:boolean}){
  const[open,setOpen]=useState(false);
  return <><button disabled={disabled} onClick={()=>setOpen(true)} className="flex h-10 shrink-0 items-center gap-2 rounded-full border border-white/[.08] bg-[#151821] px-3 text-[10px] disabled:opacity-35"><span className="max-w-28 truncate">{label}</span><span className="text-[#747B8B]">⌄</span></button>{open&&<div className="fixed inset-0 z-[100030] flex items-end bg-black/70 backdrop-blur-sm" onClick={()=>setOpen(false)}><section className="max-h-[76dvh] w-full overflow-hidden rounded-t-[30px] bg-[#11151D] pb-[max(1rem,env(safe-area-inset-bottom))]" onClick={event=>event.stopPropagation()}><div className="mx-auto my-3 h-1 w-10 rounded-full bg-white/15"/><div className="flex items-center justify-between px-5 pb-3"><h3 className="text-base font-bold">Filter team</h3><button onClick={()=>setOpen(false)} className="grid h-9 w-9 place-items-center rounded-full bg-white/[.05]">×</button></div><div className="max-h-[60dvh] overflow-y-auto px-3">{options.map(([id,text])=><button key={id||'all'} onClick={()=>{onChange(id);setOpen(false)}} className="flex min-h-12 w-full items-center justify-between border-b border-white/[.05] px-3 text-left text-xs"><span>{text}</span>{value===id&&<span className="text-violet-300">✓</span>}</button>)}</div></section></div>}</>;
}
function Avatar({person}:{person:{full_name?:string|null;username?:string|null;email?:string|null;avatar_url?:string|null}}){
  const value=person.full_name||person.username||person.email||'W';
  return <div className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-xl bg-violet-500/15 text-xs font-bold">{person.avatar_url?<img src={person.avatar_url} alt="" className="h-full w-full object-cover"/>:value[0].toUpperCase()}</div>;
}
function Metric({label,value}:{label:string;value:number}){return <div className="rounded-xl border border-white/[.05] bg-[#10131B] p-3"><p className="text-lg font-bold">{value}</p><p className="text-[8px] text-[#62697A]">{label}</p></div>}
function Empty({text}:{text:string}){return <div className="rounded-2xl border border-dashed border-white/[.08] p-8 text-center text-xs text-[#66697B]">{text}</div>}
function Loading({compact=false}:{compact?:boolean}){return <div className={'grid '+(compact?'min-h-24':'min-h-52')+' place-items-center'}><div className="h-6 w-6 animate-spin rounded-full border-2 border-violet-500 border-t-transparent"/></div>}
