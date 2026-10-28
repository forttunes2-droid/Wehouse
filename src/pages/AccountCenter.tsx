import { useEffect, useMemo, useRef, useState } from "react";
import { withTimeout } from '@/lib/withTimeout';
import PhoneNotificationSettings from '@/components/PhoneNotificationSettings';
import SettingSwitch from '@/components/SettingSwitch';
import { saveNotificationPreference as persistNotificationPreference } from '@/lib/supabase/notification-preferences';
import { Check, Monitor, Moon, Sun } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { setNotificationSoundEnabled } from "@/lib/notificationSound";
import { resolvedAppearance, setAppearance, useAppearance } from "@/lib/appearance";
import AccountShell, {
  AccountRow,
  AccountSection,
} from "@/components/AccountShell";
import { AccountIcon, WorkspaceIcon } from "@/components/WorkspaceMark";
import AccountHelpCenter from "@/components/AccountHelpCenter";
import type { Profile } from "@/types";
import PrivacySecuritySettings from "@/pages/PrivacySecuritySettings";
import MediaViewer from "@/components/MediaViewer";
import { getCurrentLegalDocuments } from "@/lib/supabase/legal";
import { getCanonicalActivity } from "@/lib/supabase/activity";
import { visibleUnreadActivityCount } from "@/lib/activityFeed";
import {
  workspaceLabel,
  workspaceGroup,
  WORKSPACE_GROUPS,
  type WorkspaceName,
} from "@/lib/workspacePresentation";

type Props = {
  profile: Profile;
  onBack?: () => void;
  onGoToPrivacy: () => void;
  onGoToSaved: () => void;
  onGoToFollowedSearches?: () => void;
  onGoToSecurity: () => void;
  onGoToProfileEdit: () => void;
  onGoToWorkerPaidTools?: () => void;
  onGoToSponsored?: () => void;
  onNavigate?: (page: string) => void;
  onLogout?: () => void;
  workspaceAccess?: WorkspaceAccess | null;
  activeWorkspace?: WorkspaceChoice;
  onSwitchWorkspace?: (workspace: WorkspaceChoice) => void;
  onWorkspaceActivated?: (workspace: "worker" | "property_partner") => void;
};

export type WorkspaceChoice = WorkspaceName;
export type WorkspaceAccess = {
  identity?: {
    user_id?: string;
    account_kind?: string;
    compatibility_role?: string;
  };
  personal_workspace?: boolean;
  privileged_workspaces?: Array<{
    role:
      | "worker"
      | "property_partner"
      | "hosting"
      | "staff"
      | "admin"
      | "creator"
      | "hotel";
    scope_type?: string;
    state?: string | null;
    lga?: string | null;
  }>;
};

type Legal = {
  privacy_accepted: boolean;
  terms_accepted: boolean;
  privacy_accepted_at?: string | null;
  terms_accepted_at?: string | null;
  legal_version?: string | null;
};
type Published = { privacy: boolean; terms: boolean };
type Panel =
  | "appearance"
  | "notifications"
  | "legal"
  | "privacy_security"
  | "workspaces"
  | "help"
  | null;
type ProfilePreferences = {
  pref_email_notif?: boolean | null;
  pref_push_notif?: boolean | null;
};

export default function AccountCenter(props:Props) {
  return <AccountCenterContent key={props.profile.user_id} {...props}/>;
}
function AccountCenterContent({
  profile,
  onBack,
  onGoToSaved,
  onGoToFollowedSearches,
  onGoToPrivacy,
  onGoToSecurity,
  onGoToProfileEdit,
  onGoToWorkerPaidTools,
  onGoToSponsored,
  onNavigate,
  onLogout,
  workspaceAccess,
  activeWorkspace = "personal",
  onSwitchWorkspace,
  onWorkspaceActivated,
}: Props) {
  void onGoToPrivacy;
  void onGoToSecurity;
  const p = profile as Profile & ProfilePreferences;
  const [panel, setPanel] = useState<Panel>(null);
  const appearance = useAppearance();
  const [pushNotifs, setPushNotifs] = useState(
    p.pref_push_notif !== false,
  );
  const [legal, setLegal] = useState<Legal>({
    privacy_accepted: false,
    terms_accepted: false,
  });
  const [published, setPublished] = useState<Published>({
    privacy: false,
    terms: false,
  });
  const [saving, setSaving] = useState(false);
  const preferenceLock=useRef(false),preferenceAlive=useRef(true);
  useEffect(()=>{preferenceAlive.current=true;return()=>{preferenceAlive.current=false;};},[]);
  const [signingOut, setSigningOut] = useState(false);
  const [activatingWorkspace, setActivatingWorkspace] = useState<
    "worker" | "property_partner" | null
  >(null);
  const [photoPreview, setPhotoPreview] = useState(false);
  const [workspaceUnread, setWorkspaceUnread] = useState<Record<string, number>>({});

  const canOpenCustomerHelp = ["personal", "worker", "property_partner", "hosting", "hotel"].includes(activeWorkspace);
  const isUser = activeWorkspace === "personal";
  const isServiceProvider = activeWorkspace === "worker";
  const isStaff = activeWorkspace === "staff";
  const canEditGenericProfile = !isStaff && !isServiceProvider;
  const helpDetail = activeWorkspace === 'worker' ? 'Your jobs, professional profile and earnings'
    : activeWorkspace === 'property_partner' ? 'Your properties, guests and earnings'
    : activeWorkspace === 'hosting' ? 'Your assigned properties and guest operations'
    : activeWorkspace === 'hotel' ? 'Your assigned hotel and account'
    : 'Your account, stays, services and payments';
  const initials = (
    profile.full_name ||
    profile.username ||
    profile.email ||
    "U"
  )[0].toUpperCase();

  // A previous identity's cached response must never supply account links.
  const ownAccess = workspaceAccess?.identity?.user_id === profile.user_id;
  const privilegedWorkspaces = ownAccess ? workspaceAccess?.privileged_workspaces || [] : [];
  const hasServiceProviderWorkspace = privilegedWorkspaces.some(
    (workspace) => workspace.role === "worker",
  );
  const hasPartnerWorkspace = privilegedWorkspaces.some(
    (workspace) => workspace.role === "property_partner",
  );
  const serviceProviderLive = Boolean(
    hasServiceProviderWorkspace &&
      profile.worker_status === "verified" &&
      profile.worker_verified === true,
  );
  const assignedWorkspaces = privilegedWorkspaces.filter((workspace) =>
    ["hosting", "hotel", "staff", "admin", "creator"].includes(workspace.role),
  );
  const canStartProfessionalOnboarding = Boolean(
    ownAccess &&
      workspaceAccess?.identity?.account_kind === "consumer",
  );

  const switchableWorkspaces = useMemo(() => {
    const items: Array<{
      role: WorkspaceChoice;
      label: string;
      detail: string;
    }> = [];
    if (ownAccess)
      items.push({
        role: "personal",
        label: "Personal",
        detail: "Explore, Bookings, Inbox and Account",
      });
    if (hasServiceProviderWorkspace)
      items.push({
        role: "worker",
        label: "Service Worker",
        detail: serviceProviderLive ? "Jobs, Showcase and earnings" : serviceProviderStatusText(profile.worker_status),
      });
    if (hasPartnerWorkspace)
      items.push({
        role: "property_partner",
        label: "Property Partner",
        detail: "Your properties, submissions and guest bookings",
      });
    for (const workspace of assignedWorkspaces) {
      items.push({
        role: workspace.role,
        label: workspace.role === "staff" ? "Staff" : workspace.role === "admin" ? "Admin" : workspaceLabel(workspace.role),
        detail:
          workspace.role === "hosting"
            ? "Properties you help host"
            : workspace.role === "hotel"
              ? "Assigned hotel access"
              : workspace.lga
              ? `${workspace.lga}${workspace.state ? `, ${workspace.state}` : ""}`
              : "Assigned work access",
      });
    }
    return items.filter((item, index) => items.findIndex(other => other.role === item.role) === index);
  }, [
    assignedWorkspaces,
    hasPartnerWorkspace,
    hasServiceProviderWorkspace,
    profile.worker_status,
    serviceProviderLive,
    ownAccess,
  ]);
  const workspaceRolesKey = switchableWorkspaces.map(item => item.role).join(',');
  const otherWorkspaceUnread = switchableWorkspaces.reduce((sum, item) =>
    sum + (item.role === activeWorkspace ? 0 : (workspaceUnread[item.role] || 0)), 0);

  useEffect(() => {
    if (!ownAccess) return;
    let current = true;
    const refresh = async () => {
      const roles = workspaceRolesKey.split(',').filter(role => role && role !== 'hosting');
      const results = await Promise.all(roles.map(async role => {
        const result = await getCanonicalActivity(role, 100);
        return { role, ...result };
      }));
      if (!current) return;
      setWorkspaceUnread(current => Object.fromEntries(results.map(result => [
        result.role,
        result.error ? (current[result.role] || 0) : visibleUnreadActivityCount(result.rows, result.role),
      ])));
    };
    void refresh();
    window.addEventListener('wehouse:workspace-activity', refresh);
    window.addEventListener('wehouse:unread-changed', refresh);
    return () => { current = false; window.removeEventListener('wehouse:workspace-activity', refresh); window.removeEventListener('wehouse:unread-changed', refresh); };
  }, [ownAccess, profile.user_id, workspaceRolesKey]);



  useEffect(() => {
    void (async () => {
      const [{ data: status }, { documents }] = await Promise.all([
        supabase.rpc("get_my_legal_status"),
        getCurrentLegalDocuments(),
      ]);
      if (status) setLegal(status as Legal);
      setPublished({
        privacy: Boolean(documents.privacy?.body?.trim()),
        terms: Boolean(documents.terms?.body?.trim()),
      });
    })();
  }, []);

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("wehouse:nested-screen", {
        detail: { open: panel !== null },
      }),
    );
    return () => {
      window.dispatchEvent(
        new CustomEvent("wehouse:nested-screen", { detail: { open: false } }),
      );
    };
  }, [panel]);

  async function saveNotificationPreference(
    value: boolean,
  ) {
    if(preferenceLock.current)return;
    preferenceLock.current=true;setSaving(true);
    try {
      const {error}=await withTimeout(persistNotificationPreference(profile.user_id,profile.auth_id,'pref_push_notif',value),10000,'The save outcome is unknown. Reload Account before retrying.');
      if(!preferenceAlive.current)return;
      if(error)throw error;
      setPushNotifs(value);
      if(value)setNotificationSoundEnabled(profile.user_id,true);
      window.dispatchEvent(new CustomEvent('wehouse:in-app-alerts',{detail:{userId:profile.user_id,enabled:value}}));
      toast.success('Preference saved');
    } catch(error) {
      if(preferenceAlive.current)toast.error(error instanceof Error?error.message:(error as {message?:string})?.message||'This preference could not be saved');
    } finally {preferenceLock.current=false;if(preferenceAlive.current)setSaving(false);}
  }

  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      if (onLogout) {
        await onLogout();
        return;
      }
      await supabase.auth.signOut({ scope: "local" });
      window.location.replace(`${window.location.origin}/#login`);
    } catch {
      setSigningOut(false);
      toast.error("Could not sign out. Check your connection and try again.");
    }
  }

  function openLegal(page: "privacy_policy" | "terms_of_service") {
    onNavigate?.(page);
  }

  async function startProfessionalOnboarding(
    workspace: "worker" | "property_partner",
  ) {
    if (activatingWorkspace) return;
    setActivatingWorkspace(workspace);
    const rpc =
      workspace === "worker"
        ? "activate_my_worker_workspace"
        : "activate_my_property_partner_workspace";
    const { error } = await supabase.rpc(rpc);
    setActivatingWorkspace(null);
    if (error)
      return toast.error(
        error.message || "This onboarding flow could not be started",
      );
    window.dispatchEvent(new Event("wehouse:workspace-access-changed"));
    toast.success(
      workspace === "worker"
        ? "Service Worker onboarding started"
        : "Property Partner onboarding started",
    );
    onWorkspaceActivated?.(workspace);
  }

  function continueProfessionalOnboarding(
    workspace: "worker" | "property_partner",
  ) {
    onWorkspaceActivated?.(workspace);
  }

  if (panel === "help" && canOpenCustomerHelp)
    return <AccountHelpCenter profile={profile} workspace={activeWorkspace} onBack={() => setPanel(null)} />;

  if (panel === "privacy_security")
    return (
      <PrivacySecuritySettings
        profile={profile}
        onUpdate={() => window.location.reload()}
        onBack={() => setPanel(null)}
        onLogout={onLogout ? async () => onLogout() : undefined}
      />
    );

  if (panel === "workspaces") {
    return (
      <AccountShell
        profile={profile}
        title="WeHouse"
        description="Your personal account, professional profiles and team access."
        workspace={activeWorkspace}
        onBack={() => setPanel(null)}
      >

        {ownAccess && onSwitchWorkspace ? (
          <AccountSection>
            <AccountRow title="Personal" detail="Find places, book services and meet roommates" icon={<WorkspaceIcon workspace="personal" />}
              onClick={activeWorkspace === 'personal' ? undefined : () => onSwitchWorkspace('personal')}
              trailing={activeWorkspace === 'personal' ? <span className="text-xs text-violet-300">Current</span> : workspaceUnread.personal ? <span className="rounded-full bg-violet-500/15 px-2 py-1 text-xs text-violet-200">{workspaceUnread.personal} new</span> : undefined} />
          </AccountSection>
        ) : null}

        {onSwitchWorkspace && WORKSPACE_GROUPS.map(group => {
          const workspaces = switchableWorkspaces.filter(item => workspaceGroup(item.role) === group);
          if (!workspaces.length) return null;
          return (
            <AccountSection key={group} title={group}>
              {workspaces.map(workspace => (
                <AccountRow
                  key={workspace.role}
                  title={workspace.label}
                  detail={workspace.detail}
                  onClick={activeWorkspace === workspace.role ? undefined : () => workspace.role === 'worker' && !serviceProviderLive && onWorkspaceActivated ? continueProfessionalOnboarding('worker') : onSwitchWorkspace(workspace.role)}
                  trailing={activeWorkspace === workspace.role ? <span className="text-xs text-violet-300">Current</span> : workspaceUnread[workspace.role] ? <span className="rounded-full bg-violet-500/15 px-2 py-1 text-xs text-violet-200">{workspaceUnread[workspace.role]} new</span> : undefined}
                  icon={<WorkspaceIcon workspace={workspace.role} />}
                />
              ))}
            </AccountSection>
          );
        })}

        {canStartProfessionalOnboarding && (!hasServiceProviderWorkspace || !hasPartnerWorkspace) ? (
          <AccountSection title="Get started">
            {!hasServiceProviderWorkspace ? (
              <AccountRow
                title="Offer services"
                detail="Create your Service Worker profile"
                onClick={() => void startProfessionalOnboarding("worker")}
                disabled={activatingWorkspace !== null}
                icon={<AccountIcon name="offerServices" />}
              />
            ) : null}

            {!hasPartnerWorkspace ? (
              <AccountRow
                title="List a property"
                detail="Create your Property Partner profile"
                onClick={() => void startProfessionalOnboarding("property_partner")}
                disabled={activatingWorkspace !== null}
                icon={<AccountIcon name="listProperty" />}
              />
            ) : null}
          </AccountSection>
        ) : null}
      </AccountShell>
    );
  }

  if (panel === "notifications") {
    return (
      <AccountShell
        profile={profile}
        title="Notifications"
        description="Choose how WeHouse should alert this account."
        onBack={() => setPanel(null)}
      >

        <AccountSection>
          <div className="border-b border-[var(--wh-border-subtle)] px-4 py-4 sm:px-5">
            <p className="text-sm font-semibold">Email updates</p>
            <p className="mt-1 text-[13px] leading-5 text-[var(--wh-text-secondary)]">Delivery is not active yet. Account verification and recovery emails are separate from optional updates.</p>
          </div>
          <Toggle
            label="In-app alerts"
            detail="Messages and activity from all your workspaces while WeHouse is open."
            value={pushNotifs}
            disabled={saving}
            onChange={(value) => {
              void saveNotificationPreference(value);
            }}
          />
          <PhoneNotificationSettings key={profile.user_id} userId={profile.user_id}/>
        </AccountSection>
        <p className="px-1 text-xs leading-5 text-[var(--wh-text-secondary)]">In-app alerts control ordinary pop-ups and sounds while WeHouse is open. Turning them off keeps messages, Activity and unread badges available. Security notices stay available. This does not enable phone notifications when the app is closed.</p>
        <p className="px-1 text-xs text-[var(--wh-text-secondary)]">
          Changes save automatically.
        </p>
      </AccountShell>
    );
  }

  if (panel === "appearance") {
    const systemResolvedAppearance = resolvedAppearance("system");
    const choices = [
      { value: "system" as const, label: "System", detail: "Follows this device", icon: Monitor },
      { value: "light" as const, label: "Light", detail: "Bright and clean", icon: Sun },
      { value: "dark" as const, label: "Dark", detail: "Low-light friendly", icon: Moon },
    ];
    return <AccountShell profile={profile} title="Appearance" workspace={activeWorkspace}
      description="Choose how WeHouse looks on this device." onBack={() => setPanel(null)}>
      <section className="mx-auto max-w-2xl">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" role="radiogroup" aria-label="Appearance">
          {choices.map(({ value, label, detail, icon: Icon }) => {
            const selected = appearance === value;
            const sampleDark = value === "dark" || (value === "system" && systemResolvedAppearance === "dark");
            return (
              <button key={value} type="button" role="radio" aria-checked={selected}
                onClick={() => setAppearance(value)}
                className={`relative overflow-hidden rounded-2xl border p-3 text-left transition-all active:scale-[.99] ${selected ? "border-violet-400/60 ring-1 ring-violet-400/25" : "border-[var(--wh-border-subtle)]"} bg-[var(--wh-surface)]`}>
                <div className={`h-20 rounded-xl border p-2 ${sampleDark ? "border-white/10 bg-[#090B10]" : "border-black/10 bg-[#F7F8FB]"}`}>
                  <div className={`h-2.5 w-1/2 rounded-full ${sampleDark ? "bg-white/15" : "bg-black/10"}`} />
                  <div className="mt-2 grid grid-cols-3 gap-1.5">
                    <span className={`h-10 rounded-lg ${sampleDark ? "bg-white/10" : "bg-black/5"}`} />
                    <span className={`h-10 rounded-lg ${sampleDark ? "bg-violet-500/30" : "bg-violet-500/15"}`} />
                    <span className={`h-10 rounded-lg ${sampleDark ? "bg-white/10" : "bg-black/5"}`} />
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <span className={`grid h-8 w-8 place-items-center rounded-full ${selected ? "bg-violet-500/15 text-violet-300" : "bg-[var(--wh-interactive)] text-[var(--wh-text-secondary)]"}`}><Icon size={16} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold">{label}</span>
                    <span className="mt-0.5 block text-[11px] text-[var(--wh-text-muted)]">{detail}</span>
                  </span>
                  {selected ? <Check size={17} className="shrink-0 text-violet-300" aria-hidden="true" /> : null}
                </div>
              </button>
            );
          })}
        </div>
        <p className="mt-4 px-1 text-xs leading-5 text-[var(--wh-text-secondary)]">
          Your choice applies across WeHouse on this device.
        </p>
      </section>
    </AccountShell>;
  }

  if (panel === "legal") {
    return (
      <AccountShell profile={profile} title="Legal documents" onBack={() => setPanel(null)}>
        <div className="divide-y divide-[var(--wh-border-subtle)]">
          <LegalCard title="Privacy Policy" published={published.privacy} accepted={legal.privacy_accepted}
            onClick={() => openLegal("privacy_policy")} />
          <LegalCard title="Terms of Service" published={published.terms} accepted={legal.terms_accepted}
            onClick={() => openLegal("terms_of_service")} />
        </div>
      </AccountShell>
    );
  }

  const anyPublished = published.privacy || published.terms;
  const legalDone =
    anyPublished &&
    (!published.privacy || legal.privacy_accepted) &&
    (!published.terms || legal.terms_accepted);

  return (
    <AccountShell
      profile={profile}
      title="Account"
      workspace={activeWorkspace}
      description="Your details and settings."
      onBack={onBack}
    >


      <section className="rounded-3xl border border-[var(--wh-border)] bg-[var(--wh-surface)] p-4 sm:p-5">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => profile.avatar_url && setPhotoPreview(true)}
            disabled={!profile.avatar_url}
            aria-label={
              profile.avatar_url ? "Preview profile photo" : "No profile photo"
            }
            className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-2xl border border-[var(--wh-border)] bg-[var(--wh-accent-surface)] text-base font-bold wh-accent-text disabled:cursor-default"
          >
            {profile.avatar_url ? (
              <img
                src={profile.avatar_url}
                alt="Your profile"
                className="h-full w-full object-cover"
              />
            ) : (
              initials
            )}
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-sm font-semibold">
                {profile.full_name || `@${profile.username || "account"}`}
              </h2>
              <span className="rounded-full border border-[var(--wh-border)] bg-[var(--wh-elevated)] px-2 py-1 text-[11px] font-semibold text-[var(--wh-text-secondary)]">
                {workspaceLabel(activeWorkspace)}
              </span>
            </div>
            <p className="mt-1 truncate text-[13px] text-[var(--wh-text-secondary)]">
              {profile.email || "No email"}
            </p>

          </div>
        </div>
      </section>

      {photoPreview && profile.avatar_url ? (
        <MediaViewer
          src={profile.avatar_url}
          kind="image"
          title={
            profile.full_name || profile.username || "Your profile photo"
          }
          subtitle="Profile photo"
          onClose={() => setPhotoPreview(false)}
        />
      ) : null}

      {ownAccess ? (
        <AccountSection>
          <AccountRow
            title="Switch workspace"
            detail={`${switchableWorkspaces.length} available · Current: ${workspaceLabel(activeWorkspace)}${otherWorkspaceUnread ? ` · ${otherWorkspaceUnread} unread elsewhere` : ''}`}
            onClick={() => setPanel("workspaces")}
            icon={<AccountIcon name="switch" />}
          />
        </AccountSection>
      ) : null}

      <AccountSection title="Account">
        {isServiceProvider ? (
          <AccountRow
            title="Service Worker profile"
            detail="Services, coverage, pricing and the public details customers see"
            onClick={onGoToProfileEdit}
            icon={<WorkspaceIcon workspace="worker" />}
          />
        ) : null}
        {onGoToWorkerPaidTools ? (
          <AccountRow
            title="WeHouse Pro · Work tools"
            detail="Subscription, work insights, quotes and invoices"
            onClick={onGoToWorkerPaidTools}
            icon={<AccountIcon name="pro" />}
          />
        ) : null}
        {onGoToSponsored ? (
          <AccountRow
            title="Sponsored"
            detail="Manage paid placements separately from Pro tools"
            onClick={onGoToSponsored}
            icon={<AccountIcon name="sponsored" />}
          />
        ) : null}
        {canEditGenericProfile ? (
          <AccountRow
            title="Personal details"
            detail="Photo, name, username and contact details"
            onClick={onGoToProfileEdit}
            icon={<AccountIcon name="details" />}
          />
        ) : null}
        {isUser ? (
          <AccountRow
            title="Saved"
            detail="Homes and hotels you marked with a heart"
            onClick={onGoToSaved}
            icon={<AccountIcon name="saved" />}
          />
        ) : null}
        {isUser && onGoToFollowedSearches ? (
          <AccountRow
            title="Followed searches"
            detail="Search alerts you can pause or remove"
            onClick={onGoToFollowedSearches}
            icon={<AccountIcon name="followed" />}
          />
        ) : null}
      </AccountSection>

      <AccountSection title="Preferences & protection">
        <AccountRow title="Appearance" detail={`${appearance === 'light' ? 'Light' : 'Dark'} · Applies across WeHouse`}
          onClick={() => setPanel("appearance")} icon={<AccountIcon name="appearance" />} />
        <AccountRow
          title="Notifications"
          detail="Email and in-app alert preferences"
          onClick={() => setPanel("notifications")}
          icon={<AccountIcon name="notifications" />}
        />
        <AccountRow
          title="Privacy & Security"
          detail={
            isUser
              ? "Roommate visibility, password, devices and account ownership"
              : "Password, trusted devices and account ownership"
          }
          onClick={() => setPanel("privacy_security")}
          icon={<AccountIcon name="security" />}
        />
      </AccountSection>

      {canOpenCustomerHelp ? (
        <AccountSection>
          <AccountRow
            title="Help"
            detail={helpDetail}
            onClick={() => setPanel("help")}
            icon={<AccountIcon name="help" />}
          />
        </AccountSection>
      ) : null}

      <AccountSection title="Legal">
        <AccountRow
          title="Legal & consent"
          detail={
            !anyPublished
              ? "No documents published yet"
              : legalDone
                ? "Current documents accepted"
                : "Review current published documents"
          }
          onClick={() => setPanel("legal")}
          icon={<AccountIcon name="legal" />}
        />
      </AccountSection>

      <AccountSection>
        <AccountRow
          title={signingOut ? "Signing out…" : "Sign out"}
          detail="End this session on this device"
          onClick={() => void signOut()}
          disabled={signingOut}
          icon={<AccountIcon name="signout" />}
        />
      </AccountSection>
    </AccountShell>
  );
}

function serviceProviderStatusText(status?: string | null) {
  if (status === "profile_under_review")
    return "Your Service Worker profile is under WeHouse review.";
  if (status === "pending")
    return "Finish your services, coverage and required onboarding steps.";
  return "Continue your Service Worker onboarding.";
}

function Toggle({
  label,
  detail,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  detail: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex min-h-[4.5rem] items-center justify-between gap-4 border-b border-[var(--wh-border-subtle)] px-4 py-3.5 last:border-b-0 sm:px-5">
      <div>
        <p className="text-sm font-semibold">{label}</p>
        <p className="mt-1 text-[13px] leading-5 text-[var(--wh-text-secondary)]">
          {detail}
        </p>
      </div>
      <SettingSwitch label={label} checked={value} disabled={disabled} onChange={onChange}/>
    </div>
  );
}

function LegalCard({
  title,
  published,
  accepted,
  onClick,
}: {
  title: string;
  published: boolean;
  accepted: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!published}
      className="min-h-16 w-full py-4 text-left disabled:opacity-50"
    >
      <p className="text-sm font-semibold">{title}</p>
      <p
        className={`mt-1 text-xs ${
          accepted ? "text-emerald-300" : "text-[var(--wh-text-muted)]"
        }`}
      >
        {!published ? "Not published" : accepted ? "Accepted" : "Review document"}
      </p>
    </button>
  );
}
