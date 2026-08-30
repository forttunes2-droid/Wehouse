import { useCallback,useEffect,useMemo,useState } from 'react';
import { changePassword,getSessionHistory,logPasswordChange,parseDeviceInfo,supabase } from '@/lib/supabase';
import { Toaster,toast } from 'sonner';
import AccountShell, { AccountInfo } from '@/components/AccountShell';
import type { Profile } from '@/types';

type Props={profile:Profile;onBack?:()=>void;embedded?:boolean};
export default function SecuritySettings({profile,onBack,embedded=false}:Props){
  const [emailVerified,setEmailVerified]=useState<boolean|null>(null);
  const [history,setHistory]=useState<any[]>([]);
  const [loading,setLoading]=useState(true);
  const [showPassword,setShowPassword]=useState(false);
  const [currentPassword,setCurrentPassword]=useState('');
  const [newPassword,setNewPassword]=useState('');
  const [confirmPassword,setConfirmPassword]=useState('');
  const [changing,setChanging]=useState(false);
  const [deleteText,setDeleteText]=useState('');
  const [deleting,setDeleting]=useState(false);
  const canDelete=['user','worker','property_partner'].includes(profile.role);
  const device=useMemo(()=>parseDeviceInfo(),[]);

  const load=useCallback(async()=>{setLoading(true);const [{data:{user}},{sessions}]=await Promise.all([supabase.auth.getUser(),getSessionHistory(profile.user_id,30)]);setEmailVerified(Boolean(user?.email_confirmed_at));setHistory((sessions||[]).filter((x:any)=>x.action_type==='session_start').slice(0,10));setLoading(false)},[profile.user_id]);
  useEffect(()=>{void load()},[load]);

  async function savePassword(){if(!currentPassword||!newPassword||!confirmPassword)return toast.error('Complete all password fields');if(newPassword!==confirmPassword)return toast.error('New passwords do not match');if(newPassword.length<8)return toast.error('Password must be at least 8 characters');setChanging(true);const {error}=await changePassword(currentPassword,newPassword,profile.email);setChanging(false);if(error)return toast.error(error.message);await logPasswordChange(profile.user_id,profile.auth_id);setCurrentPassword('');setNewPassword('');setConfirmPassword('');setShowPassword(false);toast.success('Password changed')}
  async function logoutAll(){await supabase.auth.signOut({scope:'global'});window.location.reload()}
  async function closeAccount(){if(deleteText!=='DELETE')return;setDeleting(true);const {error}=await supabase.rpc('delete_user_account',{p_user_id:profile.user_id});setDeleting(false);if(error)return toast.error(error.message||'Account could not be closed');await supabase.auth.signOut({scope:'global'});window.location.reload()}

  const content=<>
    {!embedded&&<Toaster position="top-center" richColors/>}
    <section className="grid gap-3 sm:grid-cols-3"><AccountInfo label="Email" value={emailVerified===null?'Checking…':emailVerified?'Verified':'Not verified'}/><AccountInfo label="Current device" value={`${device.device} · ${device.browser}`}/><AccountInfo label="Account created" value={new Date(profile.created_at).toLocaleDateString()}/></section>

    <section className="rounded-2xl border border-white/[.06] bg-[#11141C] p-4 sm:p-5"><div className="flex items-center justify-between gap-3"><div><h2 className="text-sm font-semibold">Password</h2><p className="mt-1 text-[10px] text-[#6F7585]">Change the password used for email sign-in.</p></div><button onClick={()=>setShowPassword(v=>!v)} className="rounded-xl border border-white/[.08] bg-white/[.02] px-3 py-2 text-[10px] font-semibold text-[#AEB3C1]">{showPassword?'Cancel':'Change password'}</button></div>{showPassword&&<div className="mt-4 space-y-3"><Field label="Current password" value={currentPassword} onChange={setCurrentPassword}/><Field label="New password" value={newPassword} onChange={setNewPassword}/><Field label="Confirm new password" value={confirmPassword} onChange={setConfirmPassword}/><button onClick={()=>void savePassword()} disabled={changing} className="w-full rounded-xl bg-violet-500 px-4 py-3 text-xs font-semibold disabled:opacity-50">{changing?'Changing…':'Save new password'}</button></div>}</section>

    <section className="rounded-2xl border border-white/[.06] bg-[#11141C] p-4 sm:p-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-sm font-semibold">Sessions</h2><p className="mt-1 text-[10px] text-[#6F7585]">Recent sign-ins for this WeHouse account.</p></div><button onClick={()=>void logoutAll()} className="rounded-xl border border-red-500/15 bg-red-500/[.05] px-3 py-2 text-[10px] font-semibold text-red-300">Log out all devices</button></div><div className="mt-4 space-y-2"><div className="rounded-xl border border-emerald-500/15 bg-emerald-500/[.05] p-3"><p className="text-xs font-medium text-emerald-300">This device</p><p className="mt-1 text-[10px] text-[#777E8E]">{device.device} · {device.os} · {device.browser}</p></div>{loading?<p className="py-4 text-center text-[10px] text-[#696F7F]">Loading recent sign-ins…</p>:history.length===0?<p className="py-4 text-center text-[10px] text-[#696F7F]">No additional sign-in history.</p>:history.map((entry:any)=><div key={entry.id} className="rounded-xl border border-white/[.05] bg-black/10 p-3"><p className="text-xs text-[#D2D5DE]">{entry.details?.device||'Device'} · {entry.details?.browser||'Browser'}</p><p className="mt-1 text-[9px] text-[#62697A]">{new Date(entry.created_at).toLocaleString()}</p></div>)}</div></section>

    {canDelete&&<section className="rounded-2xl border border-red-500/15 bg-red-500/[.04] p-4 sm:p-5"><h2 className="text-sm font-semibold text-red-300">Close account</h2><p className="mt-1 text-[10px] leading-relaxed text-[#8C7077]">The server checks active bookings, balances and other obligations before allowing account closure.</p><div className="mt-4 space-y-3"><input value={deleteText} onChange={e=>setDeleteText(e.target.value)} placeholder="Type DELETE" className="h-11 w-full rounded-xl border border-red-500/15 bg-[#181319] px-3 text-xs outline-none"/><button onClick={()=>void closeAccount()} disabled={deleteText!=='DELETE'||deleting} className="w-full rounded-xl bg-red-500 px-4 py-3 text-xs font-semibold disabled:opacity-40">{deleting?'Closing…':'Close account'}</button></div></section>}
  </>;
  if(embedded)return content;
  return <AccountShell profile={profile} title="Privacy & Security" description="Visibility, sign-ins and account protection in one place." onBack={onBack}>{content}</AccountShell>
}
function Field({label,value,onChange}:{label:string;value:string;onChange:(v:string)=>void}){return <label className="block"><span className="mb-1 block text-[10px] text-[#777E8E]">{label}</span><input type="password" value={value} onChange={e=>onChange(e.target.value)} className="h-11 w-full rounded-xl border border-white/[.08] bg-[#181A23] px-3 text-xs outline-none focus:border-violet-500/40"/></label>}
