import { useState } from 'react';
import { updatePrivacySettings } from '@/lib/supabase';
import { Toaster, toast } from 'sonner';
import type { Profile } from '@/types';

type Props={profile:Profile;onUpdate:(p:Profile)=>void;onBack:()=>void};
type Key='privacy_profile_visible'|'privacy_search_visible';

export default function PrivacySettings({profile,onUpdate,onBack}:Props){
  const [settings,setSettings]=useState<Record<Key,boolean>>({
    privacy_profile_visible:profile.privacy_profile_visible!==false,
    privacy_search_visible:profile.privacy_search_visible!==false,
  });
  const [saving,setSaving]=useState<Key|null>(null);

  async function toggle(key:Key,value:boolean){
    const previous=settings;
    setSettings(current=>({...current,[key]:value}));
    setSaving(key);
    const {profile:updated,error}=await updatePrivacySettings(profile.user_id,{[key]:value} as any);
    setSaving(null);
    if(error||!updated){setSettings(previous);toast.error(error?.message||'Could not save privacy setting');return}
    onUpdate(updated);toast.success('Privacy updated');
  }

  const isUser=profile.role==='user';
  return <div className="min-h-[100dvh] bg-[#09090D] pb-24 text-white"><Toaster position="top-center" richColors/><header className="border-b border-white/[0.06] bg-[#0D0E14] px-4 py-4 sm:px-5"><div className="mx-auto flex max-w-3xl items-center gap-3"><button onClick={onBack} aria-label="Back" className="text-[#8A8D9D] hover:text-white">←</button><div><h1 className="text-base font-semibold">Privacy</h1><p className="mt-0.5 text-[10px] text-[#626678]">Control only visibility that is actually used by WeHouse workflows.</p></div></div></header><main className="mx-auto max-w-3xl px-4 py-5 sm:px-5">{isUser?<div className="overflow-hidden rounded-2xl border border-white/[0.06] bg-[#11131B] divide-y divide-white/[0.05]"><Row label="Roommate profile visibility" text="Allow verified, compatible roommate candidates to see your roommate profile." value={settings.privacy_profile_visible} disabled={saving==='privacy_profile_visible'} onChange={v=>void toggle('privacy_profile_visible',v)}/><Row label="Roommate discovery" text="Allow your profile to participate in verified roommate matching while your search is active." value={settings.privacy_search_visible} disabled={saving==='privacy_search_visible'} onChange={v=>void toggle('privacy_search_visible',v)}/></div>:<div className="rounded-2xl border border-white/[0.06] bg-[#11131B] p-6 text-center"><p className="text-sm font-semibold">No personal discovery controls for this role</p><p className="mx-auto mt-2 max-w-md text-[10px] leading-relaxed text-[#6B6F80]">Operational visibility is controlled by the role's verified workflow, availability and authorization rules rather than personal privacy switches.</p></div>}</main></div>
}

function Row({label,text,value,onChange,disabled}:{label:string;text:string;value:boolean;onChange:(v:boolean)=>void;disabled:boolean}){return <div className="flex items-center justify-between gap-4 p-4 sm:p-5"><div><p className="text-sm font-medium">{label}</p><p className="mt-1 max-w-xl text-[10px] leading-relaxed text-[#696D7D]">{text}</p></div><button onClick={()=>onChange(!value)} disabled={disabled} aria-pressed={value} className={`relative h-6 w-11 shrink-0 rounded-full ${value?'bg-blue-500':'bg-[#2A2D38]'} disabled:opacity-50`}><span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${value?'translate-x-5':''}`}/></button></div>}
