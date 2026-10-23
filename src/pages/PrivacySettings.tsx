import { useEffect, useRef, useState } from 'react';
import { withTimeout } from '@/lib/withTimeout';
import SettingSwitch from '@/components/SettingSwitch';
import PrivateCallSettings from '@/components/PrivateCallSettings';
import { updatePrivacySettings } from '@/lib/supabase';
import { toast } from 'sonner';
import AccountShell from '@/components/AccountShell';
import type { Profile } from '@/types';
import { useWorkspaceAccess } from '@/hooks/useWorkspaceAccess';
import type { WorkspaceAccess } from '@/pages/AccountCenter';

type Props={profile:Profile;onUpdate:(p:Profile)=>void;onBack?:()=>void;embedded?:boolean;workspaceAccess?:WorkspaceAccess|null;workspaceError?:string;reloadWorkspace?:()=>Promise<void>};
type Key='privacy_profile_visible'|'privacy_search_visible';

export default function PrivacySettings(props:Props){return <PrivacySettingsContent key={props.profile.user_id} {...props}/>;}
function PrivacySettingsContent({profile,onUpdate,onBack,embedded=false,workspaceAccess,workspaceError,reloadWorkspace}:Props){
  const ownWorkspace=useWorkspaceAccess(workspaceAccess===undefined?profile.user_id:undefined);
  const access=workspaceAccess===undefined?ownWorkspace.access:workspaceAccess;
  const accessError=workspaceAccess===undefined?ownWorkspace.error:workspaceError;
  const canCall=Boolean(access?.personal_workspace||access?.privileged_workspaces?.some(item=>item.role==='worker'));
  const [settings,setSettings]=useState<Record<Key,boolean>>({
    privacy_profile_visible:profile.privacy_profile_visible!==false,
    privacy_search_visible:profile.privacy_search_visible!==false,
  });
  const [saving,setSaving]=useState<Key|null>(null);
  const locked=useRef(false),alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);

  async function toggle(key:Key,value:boolean){
    if(locked.current)return;locked.current=true;setSaving(key);
    try{
      const {profile:updated,error}=await withTimeout(updatePrivacySettings(profile.user_id,{[key]:value}),10000,'Privacy could not be confirmed. Refresh Account before retrying.');
      if(!alive.current)return;
      if(error)throw error;
      if(updated?.user_id!==profile.user_id||updated[key]!==value)throw new Error('Privacy could not be confirmed. Refresh Account before retrying.');
      setSettings(current=>({...current,[key]:value}));onUpdate(updated);toast.success('Privacy updated');
    }catch(failure){if(alive.current)toast.error((failure as {message?:string})?.message||'Could not save privacy setting');}
    finally{locked.current=false;if(alive.current)setSaving(null);}
  }

  const content=<>
    {accessError?<p role="alert">Privacy access could not be loaded. <button className="min-h-11 underline" onClick={()=>void (reloadWorkspace||ownWorkspace.reload)()}>Try again</button></p>:!access?<p role="status">Loading privacy controls…</p>:null}
    {canCall&&<PrivateCallSettings/>}

    {access?.personal_workspace&&<section className="overflow-hidden rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)]">
      <Row label="Roommate profile visibility" text="Allow compatible roommate candidates to see your roommate profile while matching is active." value={settings.privacy_profile_visible} disabled={saving!==null} onChange={v=>void toggle('privacy_profile_visible',v)}/>
      <Row label="Roommate discovery" text="Allow your profile to participate in roommate matching when you turn matching on." value={settings.privacy_search_visible} disabled={saving!==null} onChange={v=>void toggle('privacy_search_visible',v)}/>
    </section>}
  </>;
  if(embedded)return content;
  return <AccountShell profile={profile} title="Privacy & Security" description="Visibility, sign-ins and account protection in one place." onBack={onBack}>{content}</AccountShell>
}

function Row({label,text,value,onChange,disabled}:{label:string;text:string;value:boolean;onChange:(v:boolean)=>void;disabled:boolean}){return <div className="flex min-h-[5rem] items-center justify-between gap-4 border-b border-[var(--wh-border-subtle)] p-4 last:border-b-0 sm:p-5"><div><p className="text-sm font-semibold">{label}</p><p className="mt-1 max-w-xl text-[13px] leading-relaxed text-[var(--wh-text-secondary)]">{text}</p></div><SettingSwitch label={label} checked={value} disabled={disabled} onChange={onChange}/></div>}
