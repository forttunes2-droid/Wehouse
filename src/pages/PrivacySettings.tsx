import { useState } from 'react';
import { updatePrivacySettings } from '@/lib/supabase';
import { Toaster, toast } from 'sonner';
import AccountShell from '@/components/AccountShell';
import type { Profile } from '@/types';

type Props={profile:Profile;onUpdate:(p:Profile)=>void;onBack?:()=>void;embedded?:boolean};
type Key='privacy_profile_visible'|'privacy_search_visible';

export default function PrivacySettings({profile,onUpdate,onBack,embedded=false}:Props){
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
  const content=<>
    {!embedded&&<Toaster position="top-center" richColors/>}
    {isUser?<section className="overflow-hidden rounded-2xl border border-white/[.06] bg-[#11141C]">
      <Row label="Roommate profile visibility" text="Allow compatible roommate candidates to see your roommate profile while matching is active." value={settings.privacy_profile_visible} disabled={saving==='privacy_profile_visible'} onChange={v=>void toggle('privacy_profile_visible',v)}/>
      <Row label="Roommate discovery" text="Allow your profile to participate in roommate matching when you turn matching on." value={settings.privacy_search_visible} disabled={saving==='privacy_search_visible'} onChange={v=>void toggle('privacy_search_visible',v)}/>
    </section>:<div className="rounded-2xl border border-white/[.06] bg-[#11141C] p-6 text-center"><p className="text-sm font-semibold">Role visibility</p><p className="mx-auto mt-2 max-w-md text-[10px] leading-relaxed text-[#6F7585]">Operational visibility follows approval, availability and role authorization rather than personal discovery switches.</p></div>}
  </>;
  if(embedded)return content;
  return <AccountShell profile={profile} title="Privacy & Security" description="Visibility, sign-ins and account protection in one place." onBack={onBack}>{content}</AccountShell>
}

function Row({label,text,value,onChange,disabled}:{label:string;text:string;value:boolean;onChange:(v:boolean)=>void;disabled:boolean}){return <div className="flex min-h-[5rem] items-center justify-between gap-4 border-b border-white/[.05] p-4 last:border-b-0 sm:p-5"><div><p className="text-[12px] font-semibold">{label}</p><p className="mt-1 max-w-xl text-[9px] leading-relaxed text-[#6F7585]">{text}</p></div><button onClick={()=>onChange(!value)} disabled={disabled} aria-pressed={value} className={`relative h-6 w-11 shrink-0 rounded-full ${value?'bg-violet-500':'bg-[#2A2D38]'} disabled:opacity-50`}><span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${value?'translate-x-5':''}`}/></button></div>}
