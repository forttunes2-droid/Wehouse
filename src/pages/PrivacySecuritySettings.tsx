import AccountRecoveryCenter from '@/components/AccountRecoveryCenter';
import { useState } from 'react';
import AccountShell, { AccountRow, AccountSection } from '@/components/AccountShell';
import PrivacySettings from '@/pages/PrivacySettings';
import SecuritySettings from '@/pages/SecuritySettings';
import MyReports from '@/components/MyReports';
import type { Profile } from '@/types';
import { useWorkspaceAccess } from '@/hooks/useWorkspaceAccess';

type Section='privacy'|'access'|'devices'|'close'|'reports'|'reviews';
type Props={profile:Profile;onUpdate:(profile:Profile)=>void;onBack:()=>void;onLogout?:()=>Promise<unknown>;initialSection?:Section};

export default function PrivacySecuritySettings({profile,onUpdate,onBack,onLogout,initialSection}:Props){
  const [section,setSection]=useState<Section|null>(initialSection||null);
  const workspace=useWorkspaceAccess(profile.user_id);
  const hasPrivacyControls=Boolean(workspace.access?.personal_workspace||workspace.access?.privileged_workspaces?.some(item=>item.role==='worker'));
  const canClose=['user','worker','property_partner'].includes(profile.role);
  const back=section?()=>setSection(null):onBack;
  const title=section==='reviews'?'Account reviews':section==='privacy'?'Privacy':section==='access'?'Access & security':section==='devices'?'Devices':section==='close'?'Close account':section==='reports'?'Reports you sent':'Privacy & Security';
  const description=section==='privacy'?'Manage online status, incoming calls and profile visibility.':section==='access'?'Manage your password, devices and account access.':section==='devices'?'Review every device that requested access to this account.':section==='close'?'Close this account after active obligations are cleared.':section==='reports'?'Check the review status of reports you sent.':'Only settings that directly change or protect this account.';
  return <AccountShell profile={profile} title={title} description={description} onBack={back}>

    {section==='privacy'?<PrivacySettings profile={profile} onUpdate={onUpdate} embedded workspaceAccess={workspace.access} workspaceError={workspace.error} reloadWorkspace={workspace.reload}/>:
    section==='access'?<><SecuritySettings profile={profile} onLogout={onLogout} embedded focus="password"/><SecuritySettings profile={profile} onLogout={onLogout} embedded focus="sessions"/></>:
    section==='devices'?<SecuritySettings profile={profile} onLogout={onLogout} embedded focus="sessions"/>:
    section==='close'?<SecuritySettings profile={profile} onLogout={onLogout} embedded focus="close"/>:
    section==='reviews'?<AccountRecoveryCenter key={profile.user_id} signedIn/>:
    section==='reports'?<MyReports/>:
    <>
      {workspace.error&&<p role="alert" className="rounded-2xl border border-[var(--wh-border)] bg-[var(--wh-surface)] p-4 text-sm">Privacy access could not be loaded. <button className="min-h-11 underline" onClick={()=>void workspace.reload()}>Try again</button></p>}
      {hasPrivacyControls&&<AccountSection title="Privacy">
        <AccountRow title="Privacy & calls" detail="Incoming call controls and available profile visibility settings" onClick={()=>setSection('privacy')} icon={<ShieldIcon/>}/>
      </AccountSection>}
      <AccountSection title="Account access">
        <AccountRow title="Account and workspace reviews" detail="Review restrictions, request a decision and follow case updates" onClick={()=>setSection('reviews')} icon={<ShieldIcon/>}/>
        <AccountRow title="Access & security" detail="Password, trusted devices and active sessions" onClick={()=>setSection('access')} icon={<LockIcon/>}/>
      </AccountSection>
      <AccountSection title="Safety">
        <AccountRow title="Reports you sent" detail="Check whether WeHouse has received or reviewed your reports" onClick={()=>setSection('reports')} icon={<ShieldIcon/>}/>
      </AccountSection>
      {canClose&&<AccountSection title="Account ownership">
        {canClose&&(
          <AccountRow title="Close account" detail="Close this account after bookings, balances and obligations are cleared" onClick={()=>setSection('close')} icon={<WarningIcon/>}/>
        )}
      </AccountSection>}
      <AccountSection title="Your personal data">
        <AccountRow title="Request access, correction or deletion" detail="Send a personal-data request to WeHouse and follow its reply in Messages" onClick={()=>window.dispatchEvent(new CustomEvent('openSupportChat',{detail:{subject:'Personal data request: access, correction or deletion',category:'account_access',contextType:'general',contextSnapshot:{source_type:'privacy_request',source_id:profile.user_id}}}))} icon={<ShieldIcon/>}/>
        <p className="px-4 pb-4 text-xs leading-5 text-[var(--wh-text-secondary)]">Choose what you need in the message and send it to submit your request. WeHouse may need to confirm your identity. Payment, booking and dispute records may require separate review before deletion.</p>
      </AccountSection>
    </>}
  </AccountShell>;
}

function ShieldIcon(){return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 3 5 6v5c0 5 3 8 7 10 4-2 7-5 7-10V6z"/></svg>}
function LockIcon(){return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>}
function WarningIcon(){return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 7h16m-10 4v6m4-6v6M9 7l1-3h4l1 3m-9 0 1 14h10l1-14"/></svg>}
