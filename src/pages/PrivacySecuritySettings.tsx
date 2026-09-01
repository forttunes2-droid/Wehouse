import { useState } from 'react';
import { Toaster } from 'sonner';
import AccountShell, { AccountRow, AccountSection } from '@/components/AccountShell';
import PrivacySettings from '@/pages/PrivacySettings';
import SecuritySettings from '@/pages/SecuritySettings';
import type { Profile } from '@/types';
import SecureMessagesPanel from '@/components/SecureMessagesPanel';

type Props={profile:Profile;onUpdate:(profile:Profile)=>void;onBack:()=>void};

export default function PrivacySecuritySettings({profile,onUpdate,onBack}:Props){
  const [section,setSection]=useState<'privacy'|'messages'|'password'|'sessions'|'close'|null>(null);
  const privateMessaging=['user','worker'].includes(profile.role);
  const canClose=['user','worker','property_partner'].includes(profile.role);
  const back=section?()=>setSection(null):onBack;
  const title=section==='privacy'?'Privacy & visibility':section==='messages'?'Secure messaging':section==='password'?'Password':section==='sessions'?'Devices & sessions':section==='close'?'Close account':'Privacy & Security';
  const description=section==='privacy'?'Control discovery and what other people can see.':section==='messages'?'Protect eligible private conversations and recover them on a new device.':section==='password'?'Update the password used for email sign-in.':section==='sessions'?'Review recent access and sign out other devices.':section==='close'?'Permanently close this account after active obligations are cleared.':'Privacy, private communication and account access in one organized place.';
  return <AccountShell profile={profile} title={title} description={description} onBack={back}>
    <Toaster position="top-center" richColors/>
    {section==='privacy'?<PrivacySettings profile={profile} onUpdate={onUpdate} embedded/>:
    section==='messages'?<SecureMessagesPanel/>:
    section==='password'?<SecuritySettings profile={profile} embedded focus="password"/>:
    section==='sessions'?<SecuritySettings profile={profile} embedded focus="sessions"/>:
    section==='close'?<SecuritySettings profile={profile} embedded focus="close"/>:
    <>
      <AccountSection title="Privacy">
        <AccountRow title="Privacy & visibility" detail={profile.role==='user'?'Roommate discovery and profile visibility':'Public information and authorized contact rules'} onClick={()=>setSection('privacy')} icon={<ShieldIcon/>}/>
        {privateMessaging&&<AccountRow title="End-to-end encrypted chats" detail="Recovery PIN, encryption status and new-device access" onClick={()=>setSection('messages')} icon={<LockIcon/>}/>}
      </AccountSection>
      <AccountSection title="Account access">
        <AccountRow title="Password" detail="Change your email sign-in password" onClick={()=>setSection('password')} icon={<KeyIcon/>}/>
        <AccountRow title="Devices & sessions" detail="Current device, recent sign-ins and session controls" onClick={()=>setSection('sessions')} icon={<DeviceIcon/>}/>
      </AccountSection>
      {canClose&&<AccountSection title="Account ownership"><AccountRow title="Close account" detail="Available only when bookings, balances and obligations are cleared" onClick={()=>setSection('close')} icon={<WarningIcon/>}/></AccountSection>}
    </>}
  </AccountShell>;
}

function ShieldIcon(){return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 3 5 6v5c0 5 3 8 7 10 4-2 7-5 7-10V6z"/></svg>}
function LockIcon(){return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>}
function KeyIcon(){return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="8" cy="15" r="4"/><path d="m11 12 8-8m-3 3 3 3"/></svg>}
function DeviceIcon(){return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="5" y="2" width="14" height="20" rx="2"/><path d="M10 18h4"/></svg>}
function WarningIcon(){return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 7h16m-10 4v6m4-6v6M9 7l1-3h4l1 3m-9 0 1 14h10l1-14"/></svg>}
