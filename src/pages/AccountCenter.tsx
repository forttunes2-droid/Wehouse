import { useEffect, useState } from 'react';
import { Toaster, toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import CommunicationInbox from '@/components/CommunicationInbox';
import OfficialChannel from '@/components/OfficialChannel';
import AccountShell, { AccountInfo, AccountRow, AccountSection } from '@/components/AccountShell';
import type { Profile } from '@/types';

type Props = {
  profile: Profile;
  onBack?: () => void;
  onGoToPrivacy: () => void;
  onGoToReservations: () => void;
  onGoToSecurity: () => void;
  onGoToProfileEdit: () => void;
  onLogout?: () => void;
};

type Legal = {
  privacy_accepted: boolean;
  terms_accepted: boolean;
  privacy_accepted_at?: string | null;
  terms_accepted_at?: string | null;
  legal_version?: string | null;
};
type Published = { privacy: boolean; terms: boolean };
type Panel = 'notifications' | 'legal' | 'communication' | 'official' | null;

export default function AccountCenter({ profile, onGoToReservations, onGoToPrivacy, onGoToSecurity, onGoToProfileEdit, onLogout }: Props) {
  const p = profile as any;
  const [panel, setPanel] = useState<Panel>(null);
  const [emailNotifs, setEmailNotifs] = useState(p.pref_email_notif !== false);
  const [pushNotifs, setPushNotifs] = useState(p.pref_push_notif !== false);
  const [legal, setLegal] = useState<Legal>({ privacy_accepted: false, terms_accepted: false });
  const [published, setPublished] = useState<Published>({ privacy: false, terms: false });
  const [acceptPrivacy, setAcceptPrivacy] = useState(false);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [saving, setSaving] = useState(false);

  const role = profile.role;
  const isUser = role === 'user';
  const isWorker = role === 'worker';
  const isStaff = role === 'staff';
  const canEditGenericProfile = !isStaff && !isWorker;
  const roleLabel = role === 'property_partner' ? 'Property Partner' : role.charAt(0).toUpperCase() + role.slice(1).replace(/_/g, ' ');
  const initials = (profile.full_name || profile.username || profile.email || 'U')[0].toUpperCase();

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
    if (onLogout) return onLogout();
    await supabase.auth.signOut({ scope: 'local' });
    window.location.reload();
  }

  function openLegal(page: 'privacy_policy' | 'terms_of_service') {
    window.history.pushState({ page }, '', `#${page}`);
    window.dispatchEvent(new PopStateEvent('popstate', { state: { page } }));
  }

  if (panel === 'official') {
    return (
      <AccountShell profile={profile} title="Official updates" description="Platform and branch announcements from WeHouse." onBack={() => setPanel(null)}>
        <OfficialChannel profile={profile} embedded />
      </AccountShell>
    );
  }

  if (panel === 'communication') {
    return (
      <AccountShell profile={profile} title="Support & updates" description="Private communication with WeHouse." onBack={() => setPanel(null)}>
        <CommunicationInbox profile={profile} title="Messages" description="WeHouse Official updates and your human-support conversation." />
      </AccountShell>
    );
  }

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
    <AccountShell profile={profile} title="Account" description="Private account controls. Work and operational settings stay inside your role workspace.">
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

      <AccountSection title="Account">
        {canEditGenericProfile && <AccountRow title="Personal details" detail="Photo, name, username and contact details" onClick={onGoToProfileEdit} icon={<PersonIcon />} />}
        {isUser && <AccountRow title="My reservations" detail="Homes, Short Stays and hotels you reserved" onClick={onGoToReservations} icon={<HomeIcon />} />}
        {isUser && <AccountRow title="Privacy" detail="Roommate discovery and personal visibility" onClick={onGoToPrivacy} icon={<PrivacyIcon />} />}
      </AccountSection>

      <AccountSection title="Preferences & protection">
        <AccountRow title="Notifications" detail="Email and in-app alert preferences" onClick={() => setPanel('notifications')} icon={<BellIcon />} />
        <AccountRow title="Security" detail="Password, devices and account protection" onClick={onGoToSecurity} icon={<ShieldIcon />} />
      </AccountSection>

      {(isWorker || isStaff) && (
        <AccountSection title="Support & information">
          {isWorker && <AccountRow title="Support & updates" detail="WeHouse Official updates and human support" onClick={() => setPanel('communication')} icon={<MessageIcon />} />}
          {isStaff && <AccountRow title="Official updates" detail="Platform and branch announcements" onClick={() => setPanel('official')} icon={<MessageIcon />} />}
          <AccountRow title="Legal & consent" detail={!anyPublished ? 'No documents published yet' : legalDone ? 'Current documents accepted' : 'Review current published documents'} onClick={() => setPanel('legal')} icon={<DocumentIcon />} />
        </AccountSection>
      )}

      {!isWorker && !isStaff && (
        <AccountSection title="Legal">
          <AccountRow title="Legal & consent" detail={!anyPublished ? 'No documents published yet' : legalDone ? 'Current documents accepted' : 'Review current published documents'} onClick={() => setPanel('legal')} icon={<DocumentIcon />} />
        </AccountSection>
      )}

      <section className="grid gap-3 sm:grid-cols-3">
        <AccountInfo label="Email" value={profile.email_verified ? 'Verified' : 'Not verified'} />
        <AccountInfo label="Account ID" value={profile.user_id || 'Not set'} />
        <AccountInfo label={isStaff || role === 'admin' ? 'Assigned branch' : role === 'creator' ? 'Access scope' : 'Member since'} value={isStaff || role === 'admin' ? [profile.assigned_lga,profile.assigned_state].filter(Boolean).join(', ') || 'Not assigned' : role === 'creator' ? 'Worldwide platform' : new Date(profile.created_at).toLocaleDateString()} />
      </section>

      {isStaff && <div className="rounded-2xl border border-amber-500/15 bg-amber-500/[.05] p-4 text-[10px] leading-relaxed text-amber-200/80">Staff role, branch and operational permissions are managed through authorized Admin/Creator workflows.</div>}

      <button onClick={() => void logout()} className="w-full rounded-2xl border border-red-500/15 bg-red-500/[.04] p-4 text-left transition hover:bg-red-500/[.06]">
        <p className="text-[12px] font-semibold text-red-300">Log out</p>
        <p className="mt-1 text-[9px] text-red-300/60">Sign out of this device</p>
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

const iconProps = { width: 17, height: 17, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8 };
function HomeIcon(){return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10.5V20h13v-9.5"/><path d="M9.5 20v-6h5v6"/></svg>}
function PersonIcon(){return <svg {...iconProps}><circle cx="12" cy="8" r="3.5"/><path d="M5 20c.7-4 3.1-6 7-6s6.3 2 7 6"/></svg>}
function PrivacyIcon(){return <svg {...iconProps}><path d="M12 3 4.5 6v5c0 4.8 3 8.2 7.5 10 4.5-1.8 7.5-5.2 7.5-10V6L12 3Z"/><path d="M9.5 12 11 13.5 14.5 10"/></svg>}
function BellIcon(){return <svg {...iconProps}><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 7h18s-3 0-3-7"/><path d="M10 19h4"/></svg>}
function ShieldIcon(){return <svg {...iconProps}><path d="M12 3 5 6v5c0 4.8 2.8 8.1 7 10 4.2-1.9 7-5.2 7-10V6l-7-3Z"/><path d="M9 12.5 11 14l4-4"/></svg>}
function MessageIcon(){return <svg {...iconProps}><path d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9l-5 3V7a2 2 0 0 1 2-2Z"/></svg>}
function DocumentIcon(){return <svg {...iconProps}><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5M9 12h6M9 16h6"/></svg>}
