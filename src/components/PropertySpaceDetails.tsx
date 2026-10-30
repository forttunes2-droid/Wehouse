import {useCallback,useEffect,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase';
import {withTimeout} from '@/lib/withTimeout';
import WeHouseSelect from '@/components/WeHouseSelect';
import {newPhysicalHomeDraft,type PhysicalHomeDraft} from '@/lib/propertySpaces';

type SpaceOption={id:string;parent_id:string|null;kind:'site'|'unit'|'private_room';label:string;layout_name:string|null;address:string|null;city:string|null;state:string|null;shared_areas?:string[]};
function useSpaceOptions(userId:string,enabled:boolean,parentId:string|null,kind:SpaceOption['kind']='site'){
 const [rows,setRows]=useState<SpaceOption[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(false),[more,setMore]=useState(false);
 const generation=useRef(0);
 const load=useCallback(async(after:string|null=null)=>{
  const request=++generation.current;setLoading(true);setError('');
  try{
   const {data,error}=await withTimeout(supabase.rpc('get_my_property_space_options',{p_parent_id:parentId,p_after_id:after}),15000,'Saved properties could not be loaded.');
   if(error)throw error;
   if(!Array.isArray(data)||data.length>100||data.some(row=>!row||typeof row.id!=='string'||typeof row.label!=='string'||!row.label.trim()||row.kind!==kind||row.parent_id!==parentId||(kind==='private_room'&&(!Array.isArray(row.shared_areas)||!row.shared_areas.length||row.shared_areas.some((area:unknown)=>typeof area!=='string')))))throw Error('Saved properties could not be confirmed.');
   if(request!==generation.current)return;
   setRows(previous=>after?[...new Map([...previous,...data].map(row=>[row.id,row])).values()]:data);
   setMore(data.length===100);
  }catch(reason){if(request===generation.current)setError(reason instanceof Error?reason.message:'Saved properties could not be loaded.');}
  finally{if(request===generation.current)setLoading(false);}
 },[kind,parentId,userId]);
 useEffect(()=>{
  generation.current++;setRows([]);setError('');setMore(false);setLoading(false);
  if(enabled)void load();
  return()=>{generation.current++;};
 },[enabled,load]);
 return{rows,error,loading,more,retry:()=>void load(),loadMore:()=>void load(rows.at(-1)?.id||null)};
}
export default function PropertySpaceDetails({userId,value,onChange,onLocationChange}:{
 userId:string;value:PhysicalHomeDraft|null;onChange:(value:PhysicalHomeDraft|null)=>void;
 onLocationChange:(location:{propertyAddress:string;propertyCity:string;propertyState:string})=>void;
}){
 const sites=useSpaceOptions(userId,Boolean(value),null);
 const savedSite=sites.rows.find(row=>row.id===value?.siteId);
 const units=useSpaceOptions(userId,Boolean(value&&savedSite),savedSite?.id||null,'unit');
 const savedUnit=units.rows.find(row=>row.id===value?.unitId);
 const rooms=useSpaceOptions(userId,Boolean(value?.scope==='private_room'&&savedUnit),savedUnit?.id||null,'private_room');
 const savedRoom=rooms.rows.find(row=>row.id===value?.spaceId);
 function patch(next:Partial<PhysicalHomeDraft>){if(value)onChange({...value,...next});}
 function chooseSite(id:string){
  if(!value)return;
  const selected=sites.rows.find(row=>row.id===id);
  const unitId=crypto.randomUUID();
  if(selected){
   onChange({...value,siteId:selected.id,siteLabel:selected.label,unitId,unitLabel:'',layoutName:'',spaceId:value.scope==='private_room'?crypto.randomUUID():unitId,spaceLabel:''});
   onLocationChange({propertyAddress:selected.address||'',propertyCity:selected.city||'',propertyState:selected.state||''});
  }else{
   onChange({...value,siteId:crypto.randomUUID(),siteLabel:'',unitId,unitLabel:'',layoutName:'',spaceId:value.scope==='private_room'?crypto.randomUUID():unitId,spaceLabel:''});
  }
 }
 function chooseUnit(id:string){
  if(!value)return;const selected=units.rows.find(row=>row.id===id);const unitId=selected?.id||crypto.randomUUID();
  onChange({...value,unitId,unitLabel:selected?.label||'',layoutName:selected?.layout_name||'',spaceId:value.scope==='private_room'?crypto.randomUUID():unitId,spaceLabel:''});
 }
 return <section className="space-y-3 rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-4 text-[var(--wh-text)] md:col-span-2">
  <div>
   <h3 className="text-sm font-semibold">How is this home arranged?</h3>
   <p className="mt-1 text-sm leading-6 text-[var(--wh-text-secondary)]">Add one home or organise several units in the same compound or apartment building.</p>
  </div>
  <div className="grid gap-2 sm:grid-cols-2" role="group" aria-label="Home arrangement">
   <button type="button" aria-pressed={!value} onClick={()=>onChange(null)} className={`min-h-24 rounded-xl border p-3 text-left ${!value?'border-violet-500/50 bg-violet-500/10':'border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)]'}`}>
    <span className="block text-sm font-semibold">One home</span><span className="mt-1 block text-xs leading-5 text-[var(--wh-text-secondary)]">List a whole flat, studio or house on its own.</span>
   </button>
   <button type="button" aria-pressed={Boolean(value)} onClick={()=>{if(!value)onChange(newPhysicalHomeDraft());}} className={`min-h-24 rounded-xl border p-3 text-left ${value?'border-violet-500/50 bg-violet-500/10':'border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)]'}`}>
    <span className="block text-sm font-semibold">Compound or building</span><span className="mt-1 block text-xs leading-5 text-[var(--wh-text-secondary)]">Keep homes or rooms at the same address together.</span>
   </button>
  </div>
  {value&&<>
   <p className="text-sm leading-6 text-[var(--wh-text-secondary)]">Start with one unit, such as Flat A. After its details and price, you can add another unit at this address. Each unit can be Short Let or Long Let.</p>
   <Recovery state={sites}/>
   {sites.rows.length>0&&<label className="block space-y-1 text-xs"><span>Compound or building</span><WeHouseSelect ariaLabel="Choose compound or building" value={savedSite?.id||'new'} onChange={chooseSite} options={[{value:'new',label:'Add a new compound or building'},...sites.rows.map(row=>({value:row.id,label:row.label}))]}/></label>}
   <div className="grid gap-3 md:grid-cols-2">
    <SpaceField label="Compound or building name" value={value.siteLabel} disabled={Boolean(savedSite)} onChange={siteLabel=>patch({siteLabel})}/>
    <div className="space-y-2 text-xs"><span>What will the customer rent?</span><WeHouseSelect ariaLabel="What will the customer rent?" title="Space included in this listing" value={value.scope} options={[{value:'entire_unit',label:'Whole home or flat',description:'The customer has this unit to themselves. Other homes in the compound are separate.'},{value:'private_room',label:'Private bedroom',description:'Only this bedroom is private. Tell customers which indoor areas they share.'}]} onChange={scope=>patch({scope:scope as PhysicalHomeDraft['scope'],spaceId:scope==='entire_unit'?value.unitId:crypto.randomUUID(),spaceLabel:''})}/><p className="leading-5 text-[var(--wh-text-secondary)]">{value.scope==='entire_unit'?'This means the named unit, not the whole compound. A shared gate, driveway or parking area does not turn a self-contained flat into a private bedroom.':'Use this for a separately rented bedroom inside a home. Identify the bedroom and disclose any shared kitchen, bathroom or living area.'}</p></div>
    {savedSite&&<div className="space-y-2 md:col-span-2"><Recovery state={units}/>{units.rows.length>0&&<label className="block space-y-1 text-xs"><span>Home or unit</span><WeHouseSelect ariaLabel="Choose home or unit" value={savedUnit?.id||'new'} onChange={chooseUnit} options={[{value:'new',label:'Add a different home or unit'},...units.rows.map(row=>({value:row.id,label:row.label}))]}/></label>}</div>}
    <SpaceField label="Unit label (for example Flat A or House 1)" value={value.unitLabel} disabled={Boolean(savedUnit)} onChange={unitLabel=>patch({unitLabel})}/>
    <SpaceField label="Layout description (optional)" required={false} value={value.layoutName} disabled={Boolean(savedUnit)} onChange={layoutName=>patch({layoutName})}/>
    {value.scope==='private_room'&&<>
     {savedUnit&&<div className="space-y-2 md:col-span-2"><Recovery state={rooms}/>{rooms.rows.length>0&&<WeHouseSelect ariaLabel="Choose private room" value={savedRoom?.id||'new'} options={[{value:'new',label:'Add a different private room'},...rooms.rows.map(row=>({value:row.id,label:row.label}))]} onChange={id=>{const selected=rooms.rows.find(row=>row.id===id);patch({spaceId:selected?.id||crypto.randomUUID(),spaceLabel:selected?.label||'',sharedAreas:selected?.shared_areas?.join(', ')||''});}}/>}</div>}
     <SpaceField label="Room label" value={value.spaceLabel} disabled={Boolean(savedRoom)} onChange={spaceLabel=>patch({spaceLabel})}/>
     <SpaceField label="Shared areas (separate with commas)" maxLength={970} value={value.sharedAreas} disabled={Boolean(savedRoom)} onChange={sharedAreas=>patch({sharedAreas})}/>
    </>}
   </div>
  </>}
 </section>;
}
function SpaceField({label,value,onChange,disabled=false,required=true,maxLength=120}:{label:string;value:string;onChange:(value:string)=>void;disabled?:boolean;required?:boolean;maxLength?:number}){
 return <label className="block space-y-1 text-xs"><span>{label}{required?' *':''}</span><input required={required} disabled={disabled} maxLength={maxLength} value={value} onChange={event=>onChange(event.target.value)} className="min-h-11 w-full rounded-xl border border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)] px-3 text-sm disabled:opacity-70"/></label>;
}
function Recovery({state}:{state:ReturnType<typeof useSpaceOptions>}){
 return <>{state.error&&<p role="alert" className="text-xs leading-5">{state.error} <button type="button" className="min-h-11 underline" onClick={state.retry}>Retry saved properties</button></p>}{state.loading&&<p role="status" className="text-xs">Loading saved properties…</p>}{state.more&&<button type="button" disabled={state.loading} onClick={state.loadMore} className="min-h-11 text-xs underline">Load more saved properties</button>}</>;
}
