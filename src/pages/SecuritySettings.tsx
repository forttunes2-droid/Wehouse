import { useCallback,useEffect,useMemo,useState } from 'react';
import { changePassword,getStoredSessionId,logPasswordChange,parseDeviceInfo,supabase } from '@/lib/supabase';
import { toast } from 'sonner';
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
  const [mfaFactorId,setMfaFactorId]=useState('');
  const [mfaEnrollment,setMfaEnrollment]=useState<{id:string;qr:string;secret:string}|null>(null);
  const [mfaCode,setMfaCode]=useState('');
  const [mfaBusy,setMfaBusy]=useState(false);
  const [creatorStatus,setCreatorStatus]=useState<{enrolled:boolean;totp_enrolled:boolean;locked_until?:string|null}|null>(null);
  const [creatorSetupOpen,setCreatorSetupOpen]=useState(false);
  const [creatorAccountPassword,setCreatorAccountPassword]=useState('');
  const [creatorSecret,setCreatorSecret]=useState('');
  const [creatorSecretConfirm,setCreatorSecretConfirm]=useState('');
  const [creatorOtp,setCreatorOtp]=useState('');
  const [creatorBusy,setCreatorBusy]=useState(false);
  const canDelete=['user','worker','property_partner'].includes(profile.role);
  const isCreator=profile.role==='creator';
  const device=useMemo(()=>parseDeviceInfo(),[]);

  const currentSessionId=getStoredSessionId();
  const load=useCallback(async()=>{setLoading(true);const [{data:{user}},{data,error}]=await Promise.all([supabase.auth.getUser(),supabase.rpc('get_my_active_device_sessions')]);setEmailVerified(Boolean(user?.email_confirmed_at));if(error)toast.error('Active sessions could not be loaded');setSessions((data||[]) as DeviceSession[]);setLoading(false)},[]);
  useEffect(()=>{if(focus==='all'||focus==='sessions')void load();else setLoading(false)},[focus,load]);
  const loadStrongAuth=useCallback(async()=>{
    const factors=await supabase.auth.mfa.listFactors();
    if(!factors.error){
      const verified=factors.data.totp.find(factor=>factor.status==='verified');
      setMfaFactorId(verified?.id||'');
    }
    if(isCreator){
      const {data}=await supabase.rpc('creator_security_status');
      if(data) setCreatorStatus(data as any);
    }
  },[isCreator]);
  useEffect(()=>{void loadStrongAuth()},[loadStrongAuth]);

  async function beginMfa(){
    if(mfaFactorId)return toast.info('Authenticator is already enabled');
    setMfaBusy(true);
    const {data,error}=await supabase.auth.mfa.enroll({factorType:'totp',friendlyName:'WeHouse authenticator'});
    setMfaBusy(false);
    if(error||!data?.id)return toast.error(error?.message||'Authenticator setup could not start');
    setMfaEnrollment({id:data.id,qr:(data as any).totp?.qr_code||'',secret:(data as any).totp?.secret||''});
    setMfaCode('');
  }
  async function confirmMfa(){
    if(!mfaEnrollment||!/^[0-9]{6}$/.test(mfaCode))return;
    setMfaBusy(true);
    const challenge=await supabase.auth.mfa.challenge({factorId:mfaEnrollment.id});
    if(challenge.error){setMfaBusy(false);return toast.error(challenge.error.message)}
    const verified=await supabase.auth.mfa.verify({factorId:mfaEnrollment.id,challengeId:challenge.data.id,code:mfaCode});
    setMfaBusy(false);
    if(verified.error)return toast.error('Authenticator code is incorrect');
    setMfaFactorId(mfaEnrollment.id);setMfaEnrollment(null);setMfaCode('');
    toast.success('Authenticator enabled');
    await loadStrongAuth();
  }
  async function removeMfa(){
    if(!mfaFactorId)return;
    if(isCreator&&creatorStatus?.enrolled)return toast.error('Keep an authenticator enrolled while Creator security is active. Use Creator recovery for a factor replacement.');
    setMfaBusy(true);
    const {error}=await supabase.auth.mfa.unenroll({factorId:mfaFactorId});
    setMfaBusy(false);
    if(error)return toast.error(error.message);
    setMfaFactorId('');toast.success('Authenticator removed');
  }
  async function saveCreatorSecurity(){
    if(!isCreator)return;
    if(!creatorAccountPassword)return toast.error('Enter your current account password');
    if(creatorSecret.length<12)return toast.error('Creator security password must be at least 12 characters');
    if(creatorSecret!==creatorSecretConfirm)return toast.error('Creator security passwords do not match');
    setCreatorBusy(true);
    const {data,error}=await supabase.functions.invoke('creator-security-setup',{body:{
      account_password:creatorAccountPassword,new_creator_secret:creatorSecret,otp_code:creatorOtp
    }});
    setCreatorBusy(false);
    if(error||!data?.success){
      if(data?.needs_mfa)return toast.error('Enter your current authenticator code');
      if(data?.needs_mfa_enrollment)return toast.error('Enroll an authenticator before resetting Creator security');
      return toast.error(data?.error||error?.message||'Creator security could not be saved');
    }
    setCreatorAccountPassword('');setCreatorSecret('');setCreatorSecretConfirm('');setCreatorOtp('');setCreatorSetupOpen(false);
    toast.success(creatorStatus?.enrolled?'Creator security password changed':'Creator security password created');
    await loadStrongAuth();
  }

  async function savePassword(){if(!currentPassword||!newPassword||!confirmPassword)return toast.error('Complete all password fields');if(newPassword!==confirmPassword)return toast.error('New passwords do not match');if(newPassword.length<8)return toast.error('Password must be at least 8 characters');setChanging(true);const {error}=await changePassword(currentPassword,newPassword,profile.email);setChanging(false);if(error)return toast.error(error.message);await logPasswordChange(profile.user_id,profile.auth_id);setCurrentPassword('');setNewPassword('');setConfirmPassword('');setShowPassword(false);toast.success('Password changed')}
  async function startPasswordRecovery(){setChanging(true);await supabase.auth.signOut({scope:'local'}).catch(()=>{});window.location.assign('/?auth=recovery')}
  async function logoutAll(){await supabase.auth.signOut({scope:'global'})}
  async function signOutDevice(sessionId:string):Promise<void>{setSessionBusy(sessionId);const{error}=await supabase.rpc('terminate_my_device_session',{p_session_id:sessionId});setSessionBusy(null);if(error){toast.error(error.message||'Device could not be signed out');return}toast.success('Device signed out');await load()}
  async function closeAccount(){if(deleteText!=='DELETE')return;setDeleting(true);const {error}=await supabase.rpc('delete_user_account',{p_user_id:profile.user_id});setDeleting(false);if(error)return toast.error(error.message||'Account could not be closed');await supabase.auth.signOut({scope:'global'})}

  const content=<>

    {(focus==='all'||focus==='sessions')&&<section className="grid gap-3 sm:grid-cols-3"><AccountInfo label="Email" value={emailVerified===null?'Checking…':emailVerified?'Verified':'Verification required'}/><AccountInfo label="Current device" value={`${device.device} · ${device.browser}`}/><AccountInfo label="Active sessions" value={loading?'Checking…':String(sessions.length)}/></section>}

    {(focus==='all'||focus==='password')&&<section className="rounded-2xl border border-white/[.06] bg-[#11141C] p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <div><h2 className="text-sm font-semibold">Change password</h2><p className="mt-1 text-[10px] leading-5 text-[#6F7585]">Use this when you know your current password.</p></div>
        <button onClick={()=>setShowPassword(v=>!v)} className="rounded-xl border border-white/[.08] bg-white/[.02] px-3 py-2 text-[10px] font-semibold text-[#AEB3C1]">{showPassword?'Cancel':'Change'}</button>
      </div>
      {showPassword&&<div className="mt-4 space-y-3"><Field label="Current password" value={currentPassword} onChange={setCurrentPassword}/><Field label="New password" value={newPassword} onChange={setNewPassword}/><Field label="Confirm new password" value={confirmPassword} onChange={setConfirmPassword}/><button onClick={()=>void savePassword()} disabled={changing} className="w-full rounded-xl bg-violet-500 px-4 py-3 text-xs font-semibold disabled:opacity-50">{changing?'Changing…':'Save new password'}</button></div>}
      <div className="mt-4 border-t border-white/[.06] pt-4">
        <p className="text-xs font-semibold">Forgot your password?</p>
        <p className="mt-1 text-[9px] leading-4 text-[#626879]">Recover with the Google identity already linked to this WeHouse account. The one-use check expires after ten minutes; no reset email is sent.</p>
        <button type="button" onClick={()=>void startPasswordRecovery()} disabled={changing} className="mt-3 w-full rounded-xl border border-white/[.09] px-4 py-3 text-xs font-semibold text-[#D1D4DC] disabled:opacity-50">Recover with linked Google</button>
      </div>
    </section>}

    {(focus==='all'||focus==='password')&&<section className="border-y border-white/[.07] py-5">
      <div className="flex items-start justify-between gap-4">
        <div><h2 className="text-sm font-semibold">Two-step verification</h2><p className="mt-1 text-[11px] leading-5 text-[#7E8595]">Use an authenticator app as an independent factor. No code is sent by email or SMS.</p></div>
        <span className={`rounded-full px-2.5 py-1 text-[9px] font-semibold ${mfaFactorId?'bg-emerald-500/10 text-emerald-300':'bg-white/[.05] text-[#8A91A1]'}`}>{mfaFactorId?'Enabled':'Not set'}</span>
      </div>
      {!mfaFactorId&&!mfaEnrollment?<button type="button" disabled={mfaBusy} onClick={()=>void beginMfa()} className="mt-4 min-h-11 rounded-xl border border-white/[.09] px-4 text-xs font-semibold disabled:opacity-50">{mfaBusy?'Starting…':'Set up authenticator'}</button>:null}
      {mfaEnrollment?<div className="mt-4 border-t border-white/[.06] pt-4">
        <p className="text-xs font-semibold">Scan with your authenticator app</p>
        {mfaEnrollment.qr?<img src={mfaEnrollment.qr} alt="Authenticator QR code" className="mt-3 h-44 w-44 rounded-xl bg-white p-2"/>:null}
        {mfaEnrollment.secret?<p className="mt-3 break-all text-[10px] text-[#8A91A1]">Manual key: <span className="font-mono text-[#D8DAE3]">{mfaEnrollment.secret}</span></p>:null}
        <label className="mt-3 block"><span className="text-[10px] text-[#777E8E]">6-digit code</span><input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={mfaCode} onChange={e=>setMfaCode(e.target.value.replace(/\D/g,'').slice(0,6))} className="mt-1 h-11 w-full max-w-xs rounded-xl border border-white/[.08] bg-[#181A23] px-3 text-base tracking-[.2em] outline-none"/></label>
        <div className="mt-3 flex gap-2"><button type="button" disabled={mfaBusy||mfaCode.length!==6} onClick={()=>void confirmMfa()} className="min-h-11 rounded-xl bg-violet-500 px-4 text-xs font-semibold disabled:opacity-40">{mfaBusy?'Verifying…':'Enable authenticator'}</button><button type="button" disabled={mfaBusy} onClick={()=>{setMfaEnrollment(null);setMfaCode('')}} className="min-h-11 px-3 text-xs text-[#9AA0AF]">Cancel</button></div>
      </div>:null}
      {mfaFactorId?<button type="button" disabled={mfaBusy} onClick={()=>void removeMfa()} className="mt-4 min-h-11 text-xs font-semibold text-[#A8ADBA] disabled:opacity-40">{mfaBusy?'Updating…':'Remove authenticator'}</button>:null}
    </section>}

    {isCreator&&(focus==='all'||focus==='password')&&<section className="border-y border-violet-500/15 py-5">
      <div className="flex items-start justify-between gap-4"><div><p className="text-[9px] font-bold uppercase tracking-[.16em] text-violet-300">Creator protection</p><h2 className="mt-1 text-sm font-semibold">Creator security password</h2><p className="mt-1 max-w-xl text-[11px] leading-5 text-[#7E8595]">Separate from the password used to sign in to WeHouse. Sensitive Creator actions use this password and your authenticator when enrolled.</p></div><span className={`rounded-full px-2.5 py-1 text-[9px] font-semibold ${creatorStatus?.enrolled?'bg-emerald-500/10 text-emerald-300':'bg-amber-500/10 text-amber-200'}`}>{creatorStatus?.enrolled?'Set':'Setup required'}</span></div>
      {!creatorSetupOpen?<button type="button" onClick={()=>setCreatorSetupOpen(true)} className="mt-4 min-h-11 rounded-xl bg-violet-500 px-4 text-xs font-semibold">{creatorStatus?.enrolled?'Change Creator security password':'Create Creator security password'}</button>:<div className="mt-4 max-w-lg space-y-3 border-t border-white/[.06] pt-4">
        <Field label="Current WeHouse account password" value={creatorAccountPassword} onChange={setCreatorAccountPassword}/>
        <Field label="New Creator security password" value={creatorSecret} onChange={setCreatorSecret}/>
        <Field label="Confirm Creator security password" value={creatorSecretConfirm} onChange={setCreatorSecretConfirm}/>
        {mfaFactorId?<label className="block"><span className="mb-1 block text-[10px] text-[#777E8E]">Authenticator code</span><input inputMode="numeric" maxLength={6} value={creatorOtp} onChange={e=>setCreatorOtp(e.target.value.replace(/\D/g,'').slice(0,6))} className="h-11 w-full rounded-xl border border-white/[.08] bg-[#181A23] px-3 text-sm outline-none"/></label>:null}
        <div className="flex gap-2"><button type="button" disabled={creatorBusy} onClick={()=>void saveCreatorSecurity()} className="min-h-11 flex-1 rounded-xl bg-violet-500 text-xs font-semibold disabled:opacity-50">{creatorBusy?'Saving…':'Save Creator security'}</button><button type="button" disabled={creatorBusy} onClick={()=>setCreatorSetupOpen(false)} className="min-h-11 px-3 text-xs text-[#9AA0AF]">Cancel</button></div>
      </div>}
    </section>}

    {(focus==='all'||focus==='sessions')&&<section className="rounded-2xl border border-white/[.06] bg-[#11141C] p-4 sm:p-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-sm font-semibold">Active sessions</h2><p className="mt-1 text-[10px] text-[#6F7585]">Only devices currently signed in to your account appear here.</p></div><button onClick={()=>void logoutAll()} className="rounded-xl border border-red-500/15 bg-red-500/[.05] px-3 py-2 text-[10px] font-semibold text-red-300">Log out everywhere</button></div><div className="mt-4 divide-y divide-white/[.05]">{loading?<p className="py-5 text-center text-[10px] text-[#696F7F]">Loading active sessions…</p>:sessions.length===0?<p className="py-5 text-center text-[10px] text-[#696F7F]">No active sessions found.</p>:sessions.map(session=>{const current=session.is_current||session.id===currentSessionId;return <DeviceRow key={session.id} session={session} current={current} busy={sessionBusy===session.id} onSignOut={signOutDevice}/>})}</div></section>}

    {canDelete&&(focus==='all'||focus==='close')&&<section className="rounded-2xl border border-red-500/15 bg-red-500/[.04] p-4 sm:p-5"><h2 className="text-sm font-semibold text-red-300">Close account</h2><p className="mt-1 text-[10px] leading-relaxed text-[#8C7077]">The server checks active bookings, balances and other obligations before allowing account closure.</p><div className="mt-4 space-y-3"><input value={deleteText} onChange={e=>setDeleteText(e.target.value)} placeholder="Type DELETE" className="h-11 w-full rounded-xl border border-red-500/15 bg-[#181319] px-3 text-xs outline-none"/><button onClick={()=>void closeAccount()} disabled={deleteText!=='DELETE'||deleting} className="w-full rounded-xl bg-red-500 px-4 py-3 text-xs font-semibold disabled:opacity-40">{deleting?'Closing…':'Close account'}</button></div></section>}
  </>;
  if(embedded)return content;
  return <AccountShell profile={profile} title="Access & security" description="Password, two-step verification, trusted devices and active sessions." onBack={onBack}>{content}</AccountShell>
}
function Field({label,value,onChange}:{label:string;value:string;onChange:(v:string)=>void}){return <label className="block"><span className="mb-1 block text-[10px] text-[#777E8E]">{label}</span><input type="password" value={value} onChange={e=>onChange(e.target.value)} className="h-11 w-full rounded-xl border border-white/[.08] bg-[#181A23] px-3 text-xs outline-none focus:border-violet-500/40"/></label>}
function DeviceRow({session,current,busy,onSignOut}:{session:DeviceSession;current:boolean;busy:boolean;onSignOut:(id:string)=>Promise<void>}){return <div className="py-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-xs font-semibold text-[#E4E6EC]">{session.device||'Device'} · {session.browser||'Browser'}</p><p className="mt-1 text-[9px] text-[#6E7586]">{session.os||'System unavailable'} · signed in {new Date(session.login_time).toLocaleString()}</p></div><span className="shrink-0 rounded-full bg-emerald-500/[.08] px-2 py-1 text-[8px] font-semibold text-emerald-300">{current?'This device':'Active'}</span></div>{!current&&<button type="button" disabled={busy} onClick={()=>void onSignOut(session.id)} className="mt-3 h-9 rounded-xl border border-white/[.08] px-3 text-[9px] font-semibold text-[#A8ADBA] disabled:opacity-40">{busy?'Signing out…':'Sign out this device'}</button>}</div>}
