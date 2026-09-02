import { useState } from 'react';
import { Toaster } from 'sonner';
import AccountShell, { AccountRow, AccountSection } from '@/components/AccountShell';
import PrivacySettings from '@/pages/PrivacySettings';
import SecuritySettings from '@/pages/SecuritySettings';
import type { Profile } from '@/types';
import SecureMessagesPanel from '@/components/SecureMessagesPanel';

type Props={profile:Profile;onUpdate:(profile:Profile)=>void;onBack:()=>void};

export default function PrivacySecuritySettings({profile,onUpdate,onBack}:Props){
  const [section,setSection]=useState<'privacy'|'access'|'close'|null>(null);
  const privateMessaging=['user','worker'].includes(profile.role);
  const canClose=['user','worker','property_partner'].includes(profile.role);
  const back=section?()=>setSection(null):onBack;
  const title=section==='privacy'?'Privacy':section==='access'?'Access & security':section==='close'?'Account ownership':'Privacy & Security';
  const description=section==='privacy'?'Control discovery and what other people can see.':section==='access'?'Password, devices and private-message protection in one place.':section==='close'?'Control closure of this account after active obligations are cleared.':'Three clear areas for privacy, access and account ownership.';
  return <AccountShell profile={profile} title={title} description={description} onBack={back}>
    <Toaster position="top-center" richColors/>
    {section==='privacy'?<PrivacySettings profile={profile} onUpdate={onUpdate} embedded/>:
    section==='access'?<><SecuritySettings profile={profile} embedded focus="password"/><SecuritySettings profile={profile} embedded focus="sessions"/>{privateMessaging&&<SecureMessagesPanel/>}</>:
    section==='close'?<SecuritySettings profile={profile} embedded focus="close"/>:
    <>
      <AccountSection title="Privacy">
        <AccountRow title="Privacy" detail={profile.role==='user'?'Roommate discovery and profile visibility':'Public information and authorized contact rules'} onClick={()=>setSection('privacy')} icon={<ShieldIcon/>}/>
      </AccountSection>
      <AccountSection title="Account access">
        <AccountRow title="Access & security" detail="Password, devices, sessions and encrypted-message recovery" onClick={()=>setSection('access')} icon={<LockIcon/>}/>
      </AccountSection>
      {canClose&&<AccountSection title="Account ownership"><AccountRow title="Account ownership" detail="Close this account after bookings, balances and obligations are cleared" onClick={()=>setSection('close')} icon={<WarningIcon/>}/></AccountSection>}
    </>}
  </AccountShell>;
}

function ShieldIcon(){return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 3 5 6v5c0 5 3 8 7 10 4-2 7-5 7-10V6z"/></svg>}
function LockIcon(){return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>}
function WarningIcon(){return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 7h16m-10 4v6m4-6v6M9 7l1-3h4l1 3m-9 0 1 14h10l1-14"/></svg>}
