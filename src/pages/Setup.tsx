import { useState, useMemo } from 'react';
import { updateProfile, isUsernameTaken } from '@/lib/supabase';
import { Input } from '@/components/ui/input';
import { NIGERIA_STATES } from '@/data/nigeria-locations';
import type { Profile } from '@/types';

interface SetupProps { profile: Profile; onSetupComplete: (profile: Profile) => void; }

export default function Setup({ profile, onSetupComplete }: SetupProps) {
  const [username, setUsername] = useState('');
  const [state, setState] = useState('');
  const [city, setCity] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const role = profile.role;
  const roleContent = {
    user:{title:'Complete Your Profile',subtitle:'Just a few details to get started',info:'Your state and LGA help us show relevant WeHouse results.'},
    worker:{title:'Worker Profile Setup',subtitle:'Set up your account profile',info:'Your personal location is separate from your professional service coverage.'},
    property_partner:{title:'Property Partner Setup',subtitle:'Set up your partner profile',info:'Complete your personal account profile before managing properties.'},
    staff:{title:'Staff Profile Setup',subtitle:'Complete your personal profile',info:'Your personal location is separate from your operational assignment.'},
    admin:{title:'Admin Profile Setup',subtitle:'Complete your personal profile',info:'Your personal location is separate from your operational assignment.'},
    creator:{title:'Creator Profile Setup',subtitle:'Complete your personal profile',info:'Complete your account profile to continue.'},
  };
  const content=roleContent[role as keyof typeof roleContent]||roleContent.user;
  const availableCities=useMemo(()=>NIGERIA_STATES.find(s=>s.state===state)?.cities||[],[state]);
  async function handleSubmit(e:React.FormEvent){e.preventDefault();setError('');const trimmed=username.trim().toLowerCase();if(trimmed.length<3){setError('Username must be at least 3 characters');return;}if(!/^[a-z0-9_]+$/.test(trimmed)){setError('Only letters, numbers, and underscores');return;}if(!state){setError('Select your current state');return;}if(!city){setError('Select your local government');return;}setWorking(true);try{const taken=await isUsernameTaken(trimmed);if(taken){setError('Username taken. Try another.');setWorking(false);return;}const {profile:updated,error:err}=await updateProfile(profile.user_id,{username:trimmed,state,city,local_government:city,profile_complete:true});if(err||!updated){setError(err?.message||'Failed to save profile');setWorking(false);return;}onSetupComplete(updated);}catch{setError('Something went wrong. Please try again.');setWorking(false);}}
  return <div className="min-h-screen bg-transparent flex items-start justify-center px-5 pt-10 pb-10 overflow-y-auto"><div className="w-full max-w-[360px]"><div className="text-center mb-6"><h1 className="text-xl font-bold text-white">{content.title}</h1><p className="text-xs text-[#5C5E72] mt-1">{content.subtitle}</p></div>{error&&<div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20"><p className="text-xs text-red-400">{error}</p></div>}<form onSubmit={handleSubmit} className="space-y-4"><div><label className="text-xs text-[#8A8B9C] font-medium mb-1.5 block">Username *</label><Input value={username} onChange={e=>setUsername(e.target.value.toLowerCase())} className="h-11 rounded-xl text-sm bg-[#1A1A24] border-[#2A2A3A] text-white" placeholder="e.g. johnsmith" autoFocus/></div><div><label className="text-xs text-[#8A8B9C] font-medium mb-1.5 block">State *</label><select value={state} onChange={e=>{setState(e.target.value);setCity('');}} className="w-full h-11 rounded-xl border border-[#2A2A3A] bg-[#1A1A24] text-white text-sm px-3"><option value="">Select your state</option>{NIGERIA_STATES.map(s=><option key={s.state} value={s.state}>{s.state}</option>)}</select></div><div><label className="text-xs text-[#8A8B9C] font-medium mb-1.5 block">Local Government *</label><select value={city} onChange={e=>setCity(e.target.value)} className="w-full h-11 rounded-xl border border-[#2A2A3A] bg-[#1A1A24] text-white text-sm px-3"><option value="">{state?'Select your LGA':'Select state first'}</option>{availableCities.map(c=><option key={c} value={c}>{c}</option>)}</select></div><div className="glass rounded-2xl p-4"><p className="text-[11px] text-[#8A8B9C] leading-relaxed">{content.info}</p></div><button type="submit" disabled={working} className="w-full h-12 rounded-xl bg-[#3B82F6] text-white font-medium text-sm disabled:opacity-50">{working?'Saving...':'Get Started'}</button></form></div></div>;
}
