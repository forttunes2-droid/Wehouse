import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { setNotificationSoundEnabled } from "@/lib/notificationSound";
import AccountShell, {
  AccountRow,
  AccountSection,
} from "@/components/AccountShell";
import AccountHelpCenter from "@/components/AccountHelpCenter";
import type { Profile } from "@/types";
import PrivacySecuritySettings from "@/pages/PrivacySecuritySettings";
import MediaViewer from "@/components/MediaViewer";
import { getCurrentLegalDocuments } from "@/lib/supabase/legal";
import { getCanonicalActivitySummary } from "@/lib/supabase/activity";
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

export default function AccountCenter({
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
  const [emailNotifs, setEmailNotifs] = useState(
    p.pref_email_notif !== false,
  );
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
  const ownAccess = workspaceAccess?.identity?.user_id === profile.user_id && workspaceAccess.personal_workspace;
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
        const result = await getCanonicalActivitySummary(role);
        return { role, ...result };
      }));
      if (!current) return;
      setWorkspaceUnread(Object.fromEntries(results.filter(result => !result.error)
        .map(result => [result.role, result.summary.unread])));
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
    key: "pref_email_notif" | "pref_push_notif",
    value: boolean,
  ) {
    setSaving(true);
    const { error } = await supabase
      .from("profiles")
      .update({ [key]: value, updated_at: new Date().toISOString() })
      .eq("auth_id", profile.auth_id);
    setSaving(false);
    if (error) {
      if (key === "pref_push_notif") setPushNotifs(!value);
      else setEmailNotifs(!value);
      return toast.error("This preference could not be saved");
    }
    if (key === "pref_push_notif") window.dispatchEvent(new CustomEvent("wehouse:in-app-alerts", {
      detail: { userId: profile.user_id, enabled: value },
    }));
    toast.success("Preference saved");
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
          <AccountSection title="Personal">
            <AccountRow title="Personal" detail="Find places, book services and meet roommates" icon={<PersonIcon />}
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
                  icon={<ToolsIcon />}
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
                icon={<PersonIcon />}
              />
            ) : null}

            {!hasPartnerWorkspace ? (
              <AccountRow
                title="List a property"
                detail="Create your Property Partner profile"
                onClick={() => void startProfessionalOnboarding("property_partner")}
                disabled={activatingWorkspace !== null}
                icon={<HomeIcon />}
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
          <Toggle
            label="Email notifications"
            detail="Allow WeHouse to send important account and service emails."
            value={emailNotifs}
            disabled={saving}
            onChange={(value) => {
              setEmailNotifs(value);
              void saveNotificationPreference("pref_email_notif", value);
            }}
          />
          <Toggle
            label="In-app alerts"
            detail="Show message and update alerts while WeHouse is open. Alerts from another workspace can take you there. This does not send phone notifications when the app is closed."
            value={pushNotifs}
            disabled={saving}
            onChange={(value) => {
              setPushNotifs(value);
              if (value) setNotificationSoundEnabled(profile.user_id, true);
              void saveNotificationPreference("pref_push_notif", value);
            }}
          />
        </AccountSection>
        <p className="px-1 text-xs leading-5 text-[#8B92A3]">In-app alerts include a short, soft chime while WeHouse is open. Your device sound settings apply. Activity and unread badges remain available when you switch workspaces.</p>
        <p className="px-1 text-xs text-[#9AA2B3]">
          Changes save automatically.
        </p>
      </AccountShell>
    );
  }

  if (panel === "legal") {
    return (
      <AccountShell profile={profile} title="Legal documents" onBack={() => setPanel(null)}>
        <div className="divide-y divide-white/10">
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

  const workspaceDetail = switchableWorkspaces.map(item => item.label).join(' · ');

  return (
    <AccountShell
      profile={profile}
      title="Account"
      workspace={activeWorkspace}
      description="Your details and settings."
      onBack={onBack}
    >


      <section className="rounded-3xl border border-violet-500/15 bg-gradient-to-br from-violet-500/[.08] via-[#12151D] to-[#0F1118] p-4 sm:p-5">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => profile.avatar_url && setPhotoPreview(true)}
            disabled={!profile.avatar_url}
            aria-label={
              profile.avatar_url ? "Preview profile photo" : "No profile photo"
            }
            className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-2xl border border-white/[.06] bg-violet-500/15 text-base font-bold text-violet-200 disabled:cursor-default"
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
              <span className="rounded-full border border-white/[.07] bg-white/[.03] px-2 py-1 text-[11px] font-semibold text-[#B6BAC8]">
                {workspaceLabel(activeWorkspace)}
              </span>
            </div>
            <p className="mt-1 truncate text-xs text-[#A0A7B6]">
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
            detail={`Current: ${workspaceLabel(activeWorkspace)} · ${workspaceDetail}${otherWorkspaceUnread ? ` · ${otherWorkspaceUnread} unread in other workspaces` : ''}`}
            onClick={() => setPanel("workspaces")}
            icon={<ToolsIcon />}
          />
        </AccountSection>
      ) : null}

      <AccountSection title="Account">
        {isServiceProvider ? (
          <AccountRow
            title="Service Worker profile"
            detail="Services, coverage, pricing and the public details customers see"
            onClick={onGoToProfileEdit}
            icon={<PersonIcon />}
          />
        ) : null}
        {onGoToWorkerPaidTools ? (
          <AccountRow
            title="WeHouse Pro · Work tools"
            detail="Subscription, work insights, quotes and invoices"
            onClick={onGoToWorkerPaidTools}
            icon={<ToolsIcon />}
          />
        ) : null}
        {onGoToSponsored ? (
          <AccountRow
            title="Sponsored"
            detail="Manage paid placements separately from Pro tools"
            onClick={onGoToSponsored}
            icon={<ToolsIcon />}
          />
        ) : null}
        {canEditGenericProfile ? (
          <AccountRow
            title="Personal details"
            detail="Photo, name, username and contact details"
            onClick={onGoToProfileEdit}
            icon={<PersonIcon />}
          />
        ) : null}
        {isUser ? (
          <AccountRow
            title="Saved"
            detail="Homes and hotels you marked with a heart"
            onClick={onGoToSaved}
            icon={<HeartIcon />}
          />
        ) : null}
        {isUser && onGoToFollowedSearches ? (
          <AccountRow
            title="Followed searches"
            detail="Search alerts you can pause or remove"
            onClick={onGoToFollowedSearches}
            icon={<BellIcon />}
          />
        ) : null}
      </AccountSection>

      <AccountSection title="Preferences & protection">
        <AccountRow
          title="Notifications"
          detail="Email and in-app alert preferences"
          onClick={() => setPanel("notifications")}
          icon={<BellIcon />}
        />
        <AccountRow
          title="Privacy & Security"
          detail={
            isUser
              ? "Roommate visibility, password, devices and account ownership"
              : "Password, trusted devices and account ownership"
          }
          onClick={() => setPanel("privacy_security")}
          icon={<ShieldIcon />}
        />
      </AccountSection>

      {canOpenCustomerHelp ? (
        <AccountSection>
          <AccountRow
            title="Help"
            detail={helpDetail}
            onClick={() => setPanel("help")}
            icon={<ToolsIcon />}
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
          icon={<DocumentIcon />}
        />
      </AccountSection>

      <AccountSection>
        <AccountRow
          title={signingOut ? "Signing out…" : "Sign out"}
          detail="End this session on this device"
          onClick={() => void signOut()}
          disabled={signingOut}
          icon={<ExitIcon />}
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
    <div className="flex min-h-[4.5rem] items-center justify-between gap-4 border-b border-white/[.05] px-4 py-3.5 last:border-b-0 sm:px-5">
      <div>
        <p className="text-sm font-semibold">{label}</p>
        <p className="mt-1 text-[13px] leading-5 text-[#A0A7B6]">
          {detail}
        </p>
      </div>
      <button
        type="button"
        disabled={disabled}
        role="switch"
        aria-label={label}
        aria-checked={value}
        onClick={() => onChange(!value)}
        className="grid min-h-11 min-w-11 shrink-0 place-items-center rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-400 disabled:opacity-50"
      >
        <span className={`relative h-6 w-11 rounded-full transition-colors duration-150 ${value ? "bg-violet-500" : "bg-[#343A48]"}`}>
          <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-150 ${value ? "translate-x-5" : ""}`} />
        </span>
      </button>
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
          accepted ? "text-emerald-300" : "text-[#6E7484]"
        }`}
      >
        {!published ? "Not published" : accepted ? "Accepted" : "Review document"}
      </p>
    </button>
  );
}

const iconProps = {
  width: 17,
  height: 17,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
};
function HeartIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  );
}
function PersonIcon() {
  return (
    <svg {...iconProps}>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c.7-4 3.1-6 7-6s6.3 2 7 6" />
    </svg>
  );
}
function HomeIcon() {
  return (
    <svg {...iconProps}>
      <path d="m3 11 9-7 9 7" />
      <path d="M5 10v10h14V10M9 20v-6h6v6" />
    </svg>
  );
}
function BellIcon() {
  return (
    <svg {...iconProps}>
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 7h18s-3 0-3-7" />
      <path d="M10 19h4" />
    </svg>
  );
}
function ShieldIcon() {
  return (
    <svg {...iconProps}>
      <path d="M12 3 5 6v5c0 4.8 2.8 8.1 7 10 4.2-1.9 7-5.2 7-10V6l-7-3Z" />
      <path d="M9 12.5 11 14l4-4" />
    </svg>
  );
}
function DocumentIcon() {
  return (
    <svg {...iconProps}>
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v5h5M9 12h6M9 16h6" />
    </svg>
  );
}
function ToolsIcon() {
  return (
    <svg {...iconProps}>
      <path d="M4 7h16M7 12h10M9 17h6" />
      <circle cx="8" cy="7" r="1.5" />
      <circle cx="15" cy="12" r="1.5" />
      <circle cx="12" cy="17" r="1.5" />
    </svg>
  );
}
function ExitIcon() {
  return (
    <svg {...iconProps}>
      <path d="M10 4H5v16h5M14 8l4 4-4 4M8 12h10" />
    </svg>
  );
}
