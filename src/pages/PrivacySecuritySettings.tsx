import { useState } from 'react';
import { Toaster } from 'sonner';
import AccountShell, { AccountRow, AccountSection } from '@/components/AccountShell';
import PrivacySettings from '@/pages/PrivacySettings';
import SecuritySettings from '@/pages/SecuritySettings';
import type { Profile } from '@/types';
import SecureMessagesPanel from '@/components/SecureMessagesPanel';

type Section='privacy'|'access'|'devices'|'encryption'|'close';
type Props={profile:Profile;onUpdate:(profile:Profile)=>void;onBack:()=>void;initialSection?:Section};

export default function PrivacySecuritySettings({profile,onUpdate,onBack,initialSection}:Props){
  const [section,setSection]=useState<Section|null>(initialSection||null);
  const privateMessaging=['user','worker'].includes(profile.role);
  const hasPrivacyControls=profile.role==='user';
  const canClose=['user','worker','property_partner'].includes(profile.role);
  const back=section?()=>setSection(null):onBack;
  const title=section==='privacy'?'Privacy':section==='access'?'Access & security':section==='devices'?'Devices':section==='encryption'?'Encrypted chats':section==='close'?'Close account':'Privacy & Security';
  const description=section==='privacy'?'Control roommate discovery and profile visibility.':section==='access'?'Manage your password, devices and account access.':section==='devices'?'Review every device that requested access to this account.':section==='encryption'?'Own, unlock and recover your private-chat encryption key.':section==='close'?'Close this account after active obligations are cleared.':'Only settings that directly change or protect this account.';
  return <AccountShell profile={profile} title={title} description={description} onBack={back}>
    <Toaster position="top-center" richColors/>
    {section==='privacy'?<PrivacySettings profile={profile} onUpdate={onUpdate} embedded/>:
    section==='access'?<><SecuritySettings profile={profile} embedded focus="password"/><SecuritySettings profile={profile} embedded focus="sessions"/></>:
    section==='devices'?<SecuritySettings profile={profile} embedded focus="sessions"/>:
    section==='encryption'?<SecureMessagesPanel/>:
    section==='close'?<SecuritySettings profile={profile} embedded focus="close"/>:
    <>
      {hasPrivacyControls&&<AccountSection title="Privacy">
        <AccountRow title="Roommate visibility" detail="Control profile visibility and participation in roommate discovery" onClick={()=>setSection('privacy')} icon={<ShieldIcon/>}/>
      </AccountSection>}
      <AccountSection title="Account access">
        <AccountRow title="Access & security" detail="Password, trusted devices and active sessions" onClick={()=>setSection('access')} icon={<LockIcon/>}/>
      </AccountSection>
      {(privateMessaging||canClose)&&<AccountSection title="Account ownership">
        {privateMessaging&&(
          <AccountRow title="Encrypted chats" detail="Your private messaging key and six-digit Recovery PIN" onClick={()=>setSection('encryption')} icon={<KeyIcon/>}/>
        )}
        {canClose&&(
          <AccountRow title="Close account" detail="Close this account after bookings, balances and obligations are cleared" onClick={()=>setSection('close')} icon={<WarningIcon/>}/>
        )}
      </AccountSection>}
    </>}
  </AccountShell>;
}

function ShieldIcon(){return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 3 5 6v5c0 5 3 8 7 10 4-2 7-5 7-10V6z"/></svg>}
function LockIcon(){return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>}
function KeyIcon(){return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="8" cy="15" r="4"/><path d="m11 12 8-8m-3 3 2 2m-5 1 2 2"/></svg>}
function WarningIcon(){return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 7h16m-10 4v6m4-6v6M9 7l1-3h4l1 3m-9 0 1 14h10l1-14"/></svg>}
