import { useEffect, useState } from 'react';
import { Toaster, toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import AccountShell, { AccountRow, AccountSection } from '@/components/AccountShell';
import type { Profile } from '@/types';
import PrivacySecuritySettings from '@/pages/PrivacySecuritySettings';

type Props = {
  profile: Profile;
  onBack?: () => void;
  onGoToPrivacy: () => void;
  onGoToSaved: () => void;
  onGoToSecurity: () => void;
  onGoToProfileEdit: () => void;
  onLogout?: () => void;
  workspaceAccess?: WorkspaceAccess | null;
  activeWorkspace?: WorkspaceChoice;
  onSwitchWorkspace?: (workspace: WorkspaceChoice) => void;
};

export type WorkspaceChoice = 'personal' | 'staff' | 'admin' | 'creator';
export type WorkspaceAccess = {
  identity?: { user_id?: string; account_kind?: string };
  personal_workspace?: boolean;
  privileged_workspaces?: Array<{ role: 'staff' | 'admin' | 'creator'; scope_type?: string; state?: string | null; lga?: string | null }>;
};

type Legal = {
  privacy_accepted: boolean;
  terms_accepted: boolean;
  privacy_accepted_at?: string | null;
  terms_accepted_at?: string | null;
  legal_version?: string | null;
};
type Published = { privacy: boolean; terms: boolean };
type Panel = 'notifications' | 'legal' | 'privacy_security' | 'saved_searches' | null;
type ProfilePreferences = { pref_email_notif?: boolean | null; pref_push_notif?: boolean | null };

export default function AccountCenter({ profile, onBack, onGoToSaved, onGoToPrivacy, onGoToSecurity, onGoToProfileEdit, onLogout, workspaceAccess, activeWorkspace = 'personal', onSwitchWorkspace }: Props) {
  void onGoToPrivacy;
  void onGoToSecurity;
  const p = profile as Profile & ProfilePreferences;
  const [panel, setPanel] = useState<Panel>(null);
  const [emailNotifs, setEmailNotifs] = useState(p.pref_email_notif !== false);
  const [pushNotifs, setPushNotifs] = useState(p.pref_push_notif !== false);
  const [legal, setLegal] = useState<Legal>({ privacy_accepted: false, terms_accepted: false });
  const [published, setPublished] = useState<Published>({ privacy: false, terms: false });
  const [acceptPrivacy, setAcceptPrivacy] = useState(false);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [saving, setSaving] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [savedSearches,setSavedSearches]=useState<any[]>([]);

  const role = profile.role;
  const isUser = role === 'user';
  const isWorker = role === 'worker';
  const isStaff = role === 'staff';
  const canEditGenericProfile = !isStaff && !isWorker;
  const roleLabel = role === 'property_partner' ? 'Property Partner' : role.charAt(0).toUpperCase() + role.slice(1).replace(/_/g, ' ');
  const initials = (profile.full_name || profile.username || profile.email || 'U')[0].toUpperCase();
  const privilegedWorkspaces = workspaceAccess?.privileged_workspaces || [];
  const canSwitchWorkspace = Boolean(onSwitchWorkspace && workspaceAccess?.personal_workspace && privilegedWorkspaces.length);

  useEffect(() => {
    void (async () => {
      const [{ data: status }, { data: docs }] = await Promise.all([
        supabase.rpc('get_my_legal_status'),
        supabase.from('platform_settings').select('key,value').in('key', ['privacy_policy', 'terms_of_service']),
      ]);
      if (status) setLegal(status as Legal);
      const next = { privacy: false, terms: false };
      for (const row of docs || []) {
        if (row.key === 'privacy_policy') next.privacy = Boolean(row.value?.trim());
        if (row.key === 'terms_of_service') next.terms = Boolean(row.value?.trim());
      }
      setPublished(next);
    })();
  }, []);

  async function saveNotifications() {
    setSaving(true);
    const { error } = await supabase
      .from('profiles')
      .update({ pref_email_notif: emailNotifs, pref_push_notif: pushNotifs, updated_at: new Date().toISOString() })
      .eq('auth_id', profile.auth_id);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success('Notifications updated');
    setPanel(null);
  }

  async function acceptLegal() {
    if ((published.privacy && !legal.privacy_accepted && !acceptPrivacy) || (published.terms && !legal.terms_accepted && !acceptTerms)) return toast.error('Read and accept each published document');
    setSaving(true);
    let next = legal;
    if (published.privacy && !legal.privacy_accepted) {
      const { data, error } = await supabase.rpc('accept_current_legal', { p_document: 'privacy' });
      if (error) { setSaving(false); return toast.error(error.message); }
      if (data) next = data as Legal;
    }
    if (published.terms && !legal.terms_accepted) {
      const { data, error } = await supabase.rpc('accept_current_legal', { p_document: 'terms' });
      if (error) { setSaving(false); return toast.error(error.message); }
      if (data) next = data as Legal;
    }
    setSaving(false);
    setLegal(next);
    setAcceptPrivacy(false);
    setAcceptTerms(false);
    toast.success('Legal documents accepted');
  }

  async function logout() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      if (onLogout) await onLogout();
      else await supabase.auth.signOut({ scope: 'local' });
      window.location.replace('/');
    } catch {
      setSigningOut(false);
      toast.error('Could not log out. Check your connection and try again.');
    }
  }

  function openLegal(page: 'privacy_policy' | 'terms_of_service') {
    window.history.pushState({ page }, '', `#${page}`);
    window.dispatchEvent(new PopStateEvent('popstate', { state: { page } }));
  }

  async function openSavedSearches(){const{data,error}=await supabase.from('saved_searches').select('id,name,search_kind,criteria,notifications_enabled,created_at').order('updated_at',{ascending:false});if(error)return toast.error(error.message);setSavedSearches(data||[]);setPanel('saved_searches')}
  async function toggleSavedSearch(id:string,enabled:boolean){const{error}=await supabase.from('saved_searches').update({notifications_enabled:enabled,updated_at:new Date().toISOString()}).eq('id',id);if(error)return toast.error(error.message);setSavedSearches(rows=>rows.map(row=>row.id===id?{...row,notifications_enabled:enabled}:row))}
  async function deleteSavedSearch(id:string){const{error}=await supabase.from('saved_searches').delete().eq('id',id);if(error)return toast.error(error.message);setSavedSearches(rows=>rows.filter(row=>row.id!==id));toast.success('Followed search removed')}

  if (panel === 'privacy_security') return <PrivacySecuritySettings profile={profile} onUpdate={() => window.location.reload()} onBack={() => setPanel(null)} />;

  if(panel==='saved_searches')return <AccountShell profile={profile} title="Followed searches" description="Control which property searches can send relevant new-listing alerts." onBack={()=>setPanel(null)}><Toaster position="top-center" richColors/>{savedSearches.length?<div className="divide-y divide-white/[.06] border-y border-white/[.07]">{savedSearches.map(row=><div key={row.id} className="flex items-center gap-3 py-4"><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold">{row.name}</p><p className="mt-1 truncate text-[9px] text-[#6F7585]">{searchDescription(row.criteria)}</p></div><button onClick={()=>void toggleSavedSearch(row.id,!row.notifications_enabled)} className={`rounded-full px-3 py-2 text-[9px] font-semibold ${row.notifications_enabled?'bg-violet-500/12 text-violet-300':'bg-white/[.04] text-[#777D8D]'}`}>{row.notifications_enabled?'Alerts on':'Paused'}</button><button aria-label="Remove followed search" onClick={()=>void deleteSavedSearch(row.id)} className="grid h-9 w-9 place-items-center rounded-full text-red-300">×</button></div>)}</div>:<Empty title="No followed searches" text="Set useful filters in Explore and choose Follow search. Only matching new properties will alert you."/>}</AccountShell>;

  if (panel === 'notifications') {
    return (
      <AccountShell profile={profile} title="Notifications" description="Choose how WeHouse should alert this account." onBack={() => setPanel(null)}>
        <Toaster position="top-center" richColors />
        <AccountSection>
          <Toggle label="Email notifications" detail="Allow WeHouse to send important account and service emails." value={emailNotifs} onChange={setEmailNotifs} />
          <Toggle label="In-app alerts" detail="Show new-message and announcement popups while WeHouse is open." value={pushNotifs} onChange={setPushNotifs} />
        </AccountSection>
        <button onClick={() => void saveNotifications()} disabled={saving} className="h-12 w-full rounded-2xl bg-violet-500 text-xs font-semibold disabled:opacity-50">{saving ? 'Saving…' : 'Save notification preferences'}</button>
      </AccountShell>
    );
  }

  if (panel === 'legal') {
    const any = published.privacy || published.terms;
    const done = (!published.privacy || legal.privacy_accepted) && (!published.terms || legal.terms_accepted);
    return (
      <AccountShell profile={profile} title="Legal & consent" description="Published WeHouse documents and your current consent status." onBack={() => setPanel(null)}>
        <Toaster position="top-center" richColors />
        <section className="rounded-2xl border border-white/[.06] bg-[#11141C] p-4 sm:p-5">
          <p className="text-sm font-semibold">Published documents</p>
          <p className="mt-1 text-[10px] leading-relaxed text-[#74798B]">Only documents actually published by WeHouse can be accepted.</p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <LegalCard title="Privacy Policy" published={published.privacy} accepted={legal.privacy_accepted} onClick={() => openLegal('privacy_policy')} />
            <LegalCard title="Terms & Conditions" published={published.terms} accepted={legal.terms_accepted} onClick={() => openLegal('terms_of_service')} />
          </div>
        </section>

        {!any ? <Empty title="Nothing to accept yet" text="Privacy Policy and Terms & Conditions have not been published." /> : (
          <>
            {!done && (
              <AccountSection>
                {published.privacy && !legal.privacy_accepted && <Check label="I have read and accept the published Privacy Policy" value={acceptPrivacy} set={setAcceptPrivacy} />}
                {published.terms && !legal.terms_accepted && <Check label="I have read and accept the published Terms & Conditions" value={acceptTerms} set={setAcceptTerms} />}
              </AccountSection>
            )}
            {done ? <div className="rounded-2xl border border-emerald-500/15 bg-emerald-500/[.05] p-4 text-xs text-emerald-300">Current published documents accepted.</div> : <button onClick={() => void acceptLegal()} disabled={saving || (published.privacy && !legal.privacy_accepted && !acceptPrivacy) || (published.terms && !legal.terms_accepted && !acceptTerms)} className="h-12 w-full rounded-2xl bg-violet-500 text-xs font-semibold disabled:opacity-40">{saving ? 'Saving…' : 'Accept published documents'}</button>}
          </>
        )}
      </AccountShell>
    );
  }

  const anyPublished = published.privacy || published.terms;
  const legalDone = anyPublished && (!published.privacy || legal.privacy_accepted) && (!published.terms || legal.terms_accepted);

  return (
    <AccountShell profile={profile} title="Account" description="Your personal details, preferences and account protection." onBack={onBack}>
      <Toaster position="top-center" richColors />

      <section className="rounded-3xl border border-violet-500/15 bg-gradient-to-br from-violet-500/[.08] via-[#12151D] to-[#0F1118] p-4 sm:p-5">
        <div className="flex items-center gap-3">
          <div className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-2xl border border-white/[.06] bg-violet-500/15 text-base font-bold text-violet-200">
            {profile.avatar_url && !isWorker ? <img src={profile.avatar_url} alt="" className="h-full w-full object-cover" /> : initials}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-sm font-semibold">{isWorker ? (profile.username ? `@${profile.username}` : 'Worker account') : (profile.full_name || `@${profile.username || 'account'}`)}</h2>
              <span className="rounded-full border border-white/[.07] bg-white/[.03] px-2 py-1 text-[8px] font-semibold text-[#9CA2B2]">{roleLabel}</span>
              {isWorker && <span className="rounded-full border border-violet-500/15 bg-violet-500/[.06] px-2 py-1 text-[8px] font-semibold text-violet-300">PRIVATE</span>}
            </div>
            <p className="mt-1 truncate text-[10px] text-[#777E8E]">{profile.email || 'No email'}</p>
            {isWorker && <p className="mt-2 text-[9px] leading-relaxed text-[#62697A]">Professional identity, service details and work media are managed only from Professional Profile.</p>}
          </div>
        </div>
      </section>

      {canSwitchWorkspace && (
        <AccountSection title="Workspaces">
          <div className="px-4 py-4 sm:px-5">
            <p className="text-[12px] font-semibold">Choose where you are working</p>
            <p className="mt-1 text-[9px] leading-relaxed text-[#6F7585]">Your personal bookings and conversations remain separate from operational Staff or Admin activity.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <WorkspaceButton label="Personal" active={activeWorkspace === 'personal'} onClick={() => onSwitchWorkspace?.('personal')} />
              {privilegedWorkspaces.map((workspace) => (
                <WorkspaceButton key={workspace.role} label={workspace.role === 'admin' ? 'Admin' : workspace.role === 'creator' ? 'Creator' : 'Staff'} detail={workspace.lga || workspace.state || undefined} active={activeWorkspace === workspace.role} onClick={() => onSwitchWorkspace?.(workspace.role)} />
              ))}
            </div>
          </div>
        </AccountSection>
      )}

      <AccountSection title="Account">
        {isWorker && <AccountRow title="Professional profile" detail="Public identity, services, coverage and pricing" onClick={onGoToProfileEdit} icon={<PersonIcon />} />}
        {canEditGenericProfile && <AccountRow title="Personal details" detail="Photo, name, username and contact details" onClick={onGoToProfileEdit} icon={<PersonIcon />} />}
        {isUser && <AccountRow title="Saved properties" detail="Homes you kept in your private shortlist" onClick={onGoToSaved} icon={<HeartIcon />} />}
        {isUser && <AccountRow title="Followed searches" detail="Property criteria allowed to send matching alerts" onClick={()=>void openSavedSearches()} icon={<SearchIcon />} />}
      </AccountSection>

      <AccountSection title="Preferences & protection">
        <AccountRow title="Notifications" detail="Email and in-app alert preferences" onClick={() => setPanel('notifications')} icon={<BellIcon />} />
        <AccountRow title="Privacy & Security" detail="Visibility, password, devices and account protection" onClick={() => setPanel('privacy_security')} icon={<ShieldIcon />} />
      </AccountSection>

      {(isWorker || isStaff) && (
        <AccountSection title="Legal">
          <AccountRow title="Legal & consent" detail={!anyPublished ? 'No documents published yet' : legalDone ? 'Current documents accepted' : 'Review current published documents'} onClick={() => setPanel('legal')} icon={<DocumentIcon />} />
        </AccountSection>
      )}

      {!isWorker && !isStaff && (
        <AccountSection title="Legal">
          <AccountRow title="Legal & consent" detail={!anyPublished ? 'No documents published yet' : legalDone ? 'Current documents accepted' : 'Review current published documents'} onClick={() => setPanel('legal')} icon={<DocumentIcon />} />
        </AccountSection>
      )}

      <button onClick={() => void logout()} disabled={signingOut} className="w-full rounded-2xl border border-red-500/15 bg-red-500/[.04] p-4 text-left transition hover:bg-red-500/[.06] disabled:opacity-50">
        <p className="text-[12px] font-semibold text-red-300">{signingOut ? 'Logging out…' : 'Log out'}</p>
        <p className="mt-1 text-[9px] text-red-300/60">{signingOut ? 'Closing this session securely' : 'Sign out of this device'}</p>
      </button>
    </AccountShell>
  );
}

function Toggle({ label, detail, value, onChange }: { label: string; detail: string; value: boolean; onChange: (value: boolean) => void }) {
  return <div className="flex min-h-[4.5rem] items-center justify-between gap-4 border-b border-white/[.05] px-4 py-3.5 last:border-b-0 sm:px-5"><div><p className="text-[12px] font-semibold">{label}</p><p className="mt-0.5 text-[9px] leading-relaxed text-[#6F7585]">{detail}</p></div><button type="button" onClick={() => onChange(!value)} className={`relative h-6 w-11 shrink-0 rounded-full transition ${value ? 'bg-violet-500' : 'bg-[#292D38]'}`}><span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${value ? 'translate-x-5' : ''}`} /></button></div>;
}
function Check({ label, value, set }: { label: string; value: boolean; set: (value: boolean) => void }) { return <label className="flex min-h-[4rem] cursor-pointer items-center gap-3 border-b border-white/[.05] px-4 py-3 last:border-b-0 sm:px-5"><input type="checkbox" checked={value} onChange={(event) => set(event.target.checked)} className="h-4 w-4 accent-violet-500" /><span className="text-[10px] leading-relaxed text-[#B3B8C4]">{label}</span></label>; }
function LegalCard({ title, published, accepted, onClick }: { title: string; published: boolean; accepted: boolean; onClick: () => void }) { return <button type="button" onClick={onClick} disabled={!published} className="rounded-2xl border border-white/[.06] bg-black/10 p-4 text-left disabled:opacity-40"><p className="text-[11px] font-semibold">{title}</p><p className={`mt-2 text-[9px] ${accepted ? 'text-emerald-300' : 'text-[#6E7484]'}`}>{!published ? 'Not published' : accepted ? 'Accepted' : 'Review document'}</p></button>; }
function Empty({ title, text }: { title: string; text: string }) { return <div className="rounded-2xl border border-dashed border-white/[.08] px-5 py-8 text-center"><p className="text-xs font-semibold">{title}</p><p className="mt-1 text-[9px] text-[#666D7E]">{text}</p></div>; }
function WorkspaceButton({ label, detail, active, onClick }: { label: string; detail?: string; active: boolean; onClick: () => void }) { return <button type="button" aria-pressed={active} onClick={onClick} className={`rounded-2xl border px-4 py-3 text-left transition ${active ? 'border-violet-500/35 bg-violet-500/[.12] text-violet-200' : 'border-white/[.07] bg-white/[.025] text-[#A1A6B5]'}`}><span className="block text-[11px] font-semibold">{label}</span>{detail ? <span className="mt-0.5 block text-[8px] opacity-65">{detail}</span> : null}</button>; }
function searchDescription(criteria:any){return [criteria?.sub_type==='short_let'?'Short Let':'Long Let',criteria?.city,criteria?.state,criteria?.max_price?`Up to ₦${Number(criteria.max_price).toLocaleString()}`:null].filter(Boolean).join(' · ')}

const iconProps = { width: 17, height: 17, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8 };
function HeartIcon(){return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>}
function SearchIcon(){return <svg {...iconProps}><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>}
function PersonIcon(){return <svg {...iconProps}><circle cx="12" cy="8" r="3.5"/><path d="M5 20c.7-4 3.1-6 7-6s6.3 2 7 6"/></svg>}
function BellIcon(){return <svg {...iconProps}><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 7h18s-3 0-3-7"/><path d="M10 19h4"/></svg>}
function ShieldIcon(){return <svg {...iconProps}><path d="M12 3 5 6v5c0 4.8 2.8 8.1 7 10 4.2-1.9 7-5.2 7-10V6l-7-3Z"/><path d="M9 12.5 11 14l4-4"/></svg>}
function DocumentIcon(){return <svg {...iconProps}><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5M9 12h6M9 16h6"/></svg>}
