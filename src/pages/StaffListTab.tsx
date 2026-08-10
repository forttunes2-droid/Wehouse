import { useEffect, useState } from 'react';
import { getAllUsers } from '@/lib/supabase/admin';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/types';
import { toast } from 'sonner';

const MODULES: Record<string,string> = { operations:'Operations', finance:'Finance', support:'Support', verification:'Verification', field_officer:'Field Officer' };

export default function StaffListTab({ profile }: { profile: Profile }) {
  const [staff,setStaff]=useState<Profile[]>([]); const [assigned,setAssigned]=useState<Record<string,string>>({}); const [loading,setLoading]=useState(true); const [saving,setSaving]=useState<string|null>(null);
  async function load(){
    setLoading(true);
    let list: Profile[] = [];
    if(profile.role==='admin'){
      const {data,error}=await supabase.rpc('admin_get_my_branch_profiles',{p_role:'staff'});
      if(error){toast.error(error.message);setLoading(false);return;}
      list=(Array.isArray(data)?data:[]) as Profile[];
    } else {
      const {users,error}=await getAllUsers();
      if(error){toast.error('Unable to load staff');setLoading(false);return;}
      list=(users||[]).filter((u:any)=>u.role==='staff') as Profile[];
    }
    setStaff(list);
    if(list.length){
      const {data,error}=await supabase.from('staff_permissions').select('staff_id,permission').in('staff_id',list.map(s=>s.user_id)).eq('is_active',true);
      if(error) toast.error(error.message);
      const map:Record<string,string>={}; (data||[]).forEach((p:any)=>{map[p.staff_id]=p.permission}); setAssigned(map);
    } else setAssigned({});
    setLoading(false);
  }
  useEffect(()=>{void load()},[profile.role,profile.assigned_state,profile.assigned_lga]);
  async function change(staffId:string,next:string){setSaving(staffId);const current=assigned[staffId]||'';if(current===next){setSaving(null);return;}if(!next&&current){const {error}=await supabase.rpc('manage_staff_permission',{p_staff_id:staffId,p_permission:current,p_enabled:false});if(error){toast.error(error.message);setSaving(null);return;}setAssigned(v=>({...v,[staffId]:''}));toast.success('Module removed');}else if(next){const {error}=await supabase.rpc('manage_staff_permission',{p_staff_id:staffId,p_permission:next,p_enabled:true});if(error){toast.error(error.message);setSaving(null);return;}setAssigned(v=>({...v,[staffId]:next}));toast.success('Module assigned');}setSaving(null);}
  if(loading)return <div className="grid min-h-40 place-items-center"><div className="h-6 w-6 animate-spin rounded-full border-2 border-violet-500 border-t-transparent"/></div>;
  return <div className="space-y-4"><div><h3 className="text-sm font-bold text-white">Staff assignments</h3><p className="mt-1 text-[10px] text-[#6A6E80]">{profile.role==='admin'?'Only staff assigned to your LGA are shown.':'Creator can manage all staff.'} Each staff member has one operational module at a time.</p></div>{staff.length===0?<div className="rounded-xl border border-dashed border-white/[0.08] p-10 text-center text-xs text-[#66697B]">No staff members found.</div>:<div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{staff.map(s=><div key={s.user_id} className="rounded-2xl border border-white/[0.06] bg-[#10131B] p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-xs font-semibold text-white">{s.full_name||s.username||'Staff member'}</p><p className="mt-1 truncate text-[9px] text-[#66697B]">{s.email}</p><p className="mt-1 text-[9px] text-[#535667]">{[s.assigned_lga,s.assigned_state].filter(Boolean).join(', ')||'No branch assigned'}</p></div>{saving===s.user_id&&<div className="h-4 w-4 animate-spin rounded-full border-2 border-violet-500 border-t-transparent"/>}</div><label className="mt-4 block text-[9px] uppercase tracking-wide text-[#5E6375]">Assigned module</label><select value={assigned[s.user_id]||''} disabled={saving===s.user_id} onChange={e=>void change(s.user_id,e.target.value)} className="mt-2 h-10 w-full rounded-xl border border-white/[0.08] bg-[#171A23] px-3 text-[10px] text-white outline-none"><option value="">No module</option>{Object.entries(MODULES).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></div>)}</div>}</div>;
}
