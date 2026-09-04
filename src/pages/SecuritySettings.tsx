import { useCallback,useEffect,useMemo,useState } from 'react';
import { changePassword,getStoredSessionId,logPasswordChange,parseDeviceInfo,supabase } from '@/lib/supabase';
import { Toaster,toast } from 'sonner';
import AccountShell, { AccountInfo } from '@/components/AccountShell';
import type { Profile } from '@/types';

type Props={profile:Profile;onBack?:()=>void;embedded?:boolean;focus?:'all'|'password'|'sessions'|'close'};
type DeviceSession={id:string;device:string|null;browser:string|null;os:string|null;ip_address:string|null;is_current:boolean;login_time:string;last_seen:string|null;trust_status:'trusted'};
export default function SecuritySettings({profile,onBack,embedded=false,focus='all'}:Props){
  const [emailVerified,setEmailVerified]=useState<boolean|null>(null);
  const [sessions,setSessions]=useState<DeviceSession[]>([]);
  const [loading,setLoading]=useState(true);
  const [sessionBusy,setSessionBusy]=useState<string|null>(null);
  const [showPassword,setShowPassword]=useState(false);
  const [currentPassword,setCurrentPassword]=useState('');
  const [newPassword,setNewPassword]=useState('');
  const [confirmPassword,setConfirmPassword]=useState('');
  const [changing,setChanging]=useState(false);
  const [deleteText,setDeleteText]=useState('');
  const [deleting,setDeleting]=useState(false);
  const canDelete=['user','worker','property_partner'].includes(profile.role);
  const device=useMemo(()=>parseDeviceInfo(),[]);

  const currentSessionId=getStoredSessionId();
  const load=useCallback(async()=>{setLoading(true);const [{data:{user}},{data,error}]=await Promise.all([supabase.auth.getUser(),supabase.rpc('get_my_active_device_sessions')]);setEmailVerified(Boolean(user?.email_confirmed_at));if(error)toast.error('Active sessions could not be loaded');setSessions((data||[]) as DeviceSession[]);setLoading(false)},[]);
  useEffect(()=>{if(focus==='all'||focus==='sessions')void load();else setLoading(false)},[focus,load]);

  async function savePassword(){if(!currentPassword||!newPassword||!confirmPassword)return toast.error('Complete all password fields');if(newPassword!==confirmPassword)return toast.error('New passwords do not match');if(newPassword.length<8)return toast.error('Password must be at least 8 characters');setChanging(true);const {error}=await changePassword(currentPassword,newPassword,profile.email);setChanging(false);if(error)return toast.error(error.message);await logPasswordChange(profile.user_id,profile.auth_id);setCurrentPassword('');setNewPassword('');setConfirmPassword('');setShowPassword(false);toast.success('Password changed')}
  async function logoutAll(){await supabase.auth.signOut({scope:'global'})}
  async function signOutDevice(sessionId:string):Promise<void>{setSessionBusy(sessionId);const{error}=await supabase.rpc('terminate_my_device_session',{p_session_id:sessionId});setSessionBusy(null);if(error){toast.error(error.message||'Device could not be signed out');return}toast.success('Device signed out');await load()}
  async function closeAccount(){if(deleteText!=='DELETE')return;setDeleting(true);const {error}=await supabase.rpc('delete_user_account',{p_user_id:profile.user_id});setDeleting(false);if(error)return toast.error(error.message||'Account could not be closed');await supabase.auth.signOut({scope:'global'})}

  const content=<>
    {!embedded&&<Toaster position="top-center" richColors/>}
    {(focus==='all'||focus==='sessions')&&<section className="grid gap-3 sm:grid-cols-3"><AccountInfo label="Email" value={emailVerified===null?'Checking…':emailVerified?'Verified':'Verification required'}/><AccountInfo label="Current device" value={`${device.device} · ${device.browser}`}/><AccountInfo label="Active sessions" value={loading?'Checking…':String(sessions.length)}/></section>}

    {(focus==='all'||focus==='password')&&<section className="rounded-2xl border border-white/[.06] bg-[#11141C] p-4 sm:p-5"><div className="flex items-center justify-between gap-3"><div><h2 className="text-sm font-semibold">Password</h2><p className="mt-1 text-[10px] text-[#6F7585]">Change the password used for email sign-in.</p></div><button onClick={()=>setShowPassword(v=>!v)} className="rounded-xl border border-white/[.08] bg-white/[.02] px-3 py-2 text-[10px] font-semibold text-[#AEB3C1]">{showPassword?'Cancel':'Change password'}</button></div>{showPassword&&<div className="mt-4 space-y-3"><Field label="Current password" value={currentPassword} onChange={setCurrentPassword}/><Field label="New password" value={newPassword} onChange={setNewPassword}/><Field label="Confirm new password" value={confirmPassword} onChange={setConfirmPassword}/><button onClick={()=>void savePassword()} disabled={changing} className="w-full rounded-xl bg-violet-500 px-4 py-3 text-xs font-semibold disabled:opacity-50">{changing?'Changing…':'Save new password'}</button></div>}</section>}

    {(focus==='all'||focus==='sessions')&&<section className="rounded-2xl border border-white/[.06] bg-[#11141C] p-4 sm:p-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-sm font-semibold">Active sessions</h2><p className="mt-1 text-[10px] text-[#6F7585]">Only devices currently signed in to your account appear here.</p></div><button onClick={()=>void logoutAll()} className="rounded-xl border border-red-500/15 bg-red-500/[.05] px-3 py-2 text-[10px] font-semibold text-red-300">Log out everywhere</button></div><div className="mt-4 divide-y divide-white/[.05]">{loading?<p className="py-5 text-center text-[10px] text-[#696F7F]">Loading active sessions…</p>:sessions.length===0?<p className="py-5 text-center text-[10px] text-[#696F7F]">No active sessions found.</p>:sessions.map(session=>{const current=session.is_current||session.id===currentSessionId;return <DeviceRow key={session.id} session={session} current={current} busy={sessionBusy===session.id} onSignOut={signOutDevice}/>})}</div></section>}

    {canDelete&&(focus==='all'||focus==='close')&&<section className="rounded-2xl border border-red-500/15 bg-red-500/[.04] p-4 sm:p-5"><h2 className="text-sm font-semibold text-red-300">Close account</h2><p className="mt-1 text-[10px] leading-relaxed text-[#8C7077]">The server checks active bookings, balances and other obligations before allowing account closure.</p><div className="mt-4 space-y-3"><input value={deleteText} onChange={e=>setDeleteText(e.target.value)} placeholder="Type DELETE" className="h-11 w-full rounded-xl border border-red-500/15 bg-[#181319] px-3 text-xs outline-none"/><button onClick={()=>void closeAccount()} disabled={deleteText!=='DELETE'||deleting} className="w-full rounded-xl bg-red-500 px-4 py-3 text-xs font-semibold disabled:opacity-40">{deleting?'Closing…':'Close account'}</button></div></section>}
  </>;
  if(embedded)return content;
  return <AccountShell profile={profile} title="Access & security" description="Password, trusted devices and active sessions." onBack={onBack}>{content}</AccountShell>
}
function Field({label,value,onChange}:{label:string;value:string;onChange:(v:string)=>void}){return <label className="block"><span className="mb-1 block text-[10px] text-[#777E8E]">{label}</span><input type="password" value={value} onChange={e=>onChange(e.target.value)} className="h-11 w-full rounded-xl border border-white/[.08] bg-[#181A23] px-3 text-xs outline-none focus:border-violet-500/40"/></label>}
function DeviceRow({session,current,busy,onSignOut}:{session:DeviceSession;current:boolean;busy:boolean;onSignOut:(id:string)=>Promise<void>}){return <div className="py-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-xs font-semibold text-[#E4E6EC]">{session.device||'Device'} · {session.browser||'Browser'}</p><p className="mt-1 text-[9px] text-[#6E7586]">{session.os||'System unavailable'} · signed in {new Date(session.login_time).toLocaleString()}</p></div><span className="shrink-0 rounded-full bg-emerald-500/[.08] px-2 py-1 text-[8px] font-semibold text-emerald-300">{current?'This device':'Active'}</span></div>{!current&&<button type="button" disabled={busy} onClick={()=>void onSignOut(session.id)} className="mt-3 h-9 rounded-xl border border-white/[.08] px-3 text-[9px] font-semibold text-[#A8ADBA] disabled:opacity-40">{busy?'Signing out…':'Sign out this device'}</button>}</div>}
