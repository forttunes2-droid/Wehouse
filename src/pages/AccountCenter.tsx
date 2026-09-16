import { useEffect, useMemo, useState } from "react";
import { Toaster, toast } from "sonner";
import { supabase } from "@/lib/supabase";
import AccountShell, {
  AccountRow,
  AccountSection,
} from "@/components/AccountShell";
import AccountHelpCenter from "@/components/AccountHelpCenter";
import type { Profile } from "@/types";
import PrivacySecuritySettings from "@/pages/PrivacySecuritySettings";
import MediaViewer from "@/components/MediaViewer";
import { getCurrentLegalDocuments } from "@/lib/supabase/legal";
import {
  workspaceLabel,
  type WorkspaceName,
} from "@/lib/workspacePresentation";

type Props = {
  profile: Profile;
  onBack?: () => void;
  onGoToPrivacy: () => void;
  onGoToSaved: () => void;
  onGoToSecurity: () => void;
  onGoToProfileEdit: () => void;
  onGoToWorkerPaidTools?: () => void;
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
type PartnerStatus = "active" | "pending_verification" | string | null;

export default function AccountCenter({
  profile,
  onBack,
  onGoToSaved,
  onGoToPrivacy,
  onGoToSecurity,
  onGoToProfileEdit,
  onGoToWorkerPaidTools,
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
  const [acceptPrivacy, setAcceptPrivacy] = useState(false);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [saving, setSaving] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [activatingWorkspace, setActivatingWorkspace] = useState<
    "worker" | "property_partner" | null
  >(null);
  const [partnerStatus, setPartnerStatus] = useState<PartnerStatus>(null);
  const [photoPreview, setPhotoPreview] = useState(false);

  const role = profile.role;
  const isUser = role === "user";
  const isServiceProvider = role === "worker";
  const isStaff = role === "staff";
  const canEditGenericProfile = !isStaff && !isServiceProvider;
  const roleLabel =
    role === "worker"
      ? "Service Provider"
      : role === "property_partner"
        ? "Property Partner"
        : role === "staff" || role === "admin"
          ? "WeHouse Team"
          : role.charAt(0).toUpperCase() + role.slice(1).replace(/_/g, " ");
  const initials = (
    profile.full_name ||
    profile.username ||
    profile.email ||
    "U"
  )[0].toUpperCase();

  const privilegedWorkspaces = workspaceAccess?.privileged_workspaces || [];
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
  const partnerLive = Boolean(
    hasPartnerWorkspace && partnerStatus === "active",
  );
  const assignedWorkspaces = privilegedWorkspaces.filter((workspace) =>
    ["hotel", "staff", "admin", "creator"].includes(workspace.role),
  );
  const canStartProfessionalOnboarding = Boolean(
    workspaceAccess?.personal_workspace &&
      workspaceAccess?.identity?.account_kind === "consumer",
  );

  const switchableWorkspaces = useMemo(() => {
    const items: Array<{
      role: WorkspaceChoice;
      label: string;
      detail: string;
    }> = [];
    if (workspaceAccess?.personal_workspace)
      items.push({
        role: "personal",
        label: "Personal",
        detail: "Explore, Bookings, Inbox and Account",
      });
    if (serviceProviderLive)
      items.push({
        role: "worker",
        label: "Service Provider",
        detail: "WeHouse Services jobs, Inbox, Showcase and Earnings",
      });
    if (partnerLive)
      items.push({
        role: "property_partner",
        label: "Property Partner",
        detail: "Apartments, hotels, bookings, team and finance",
      });
    for (const workspace of assignedWorkspaces) {
      items.push({
        role: workspace.role,
        label: workspaceLabel(workspace.role),
        detail:
          workspace.role === "hotel"
            ? "Assigned hotel access"
            : workspace.lga
              ? `${workspace.lga}${workspace.state ? `, ${workspace.state}` : ""}`
              : "Assigned work access",
      });
    }
    return items;
  }, [
    assignedWorkspaces,
    partnerLive,
    serviceProviderLive,
    workspaceAccess?.personal_workspace,
  ]);

  const hasPendingProfessionalSetup = Boolean(
    (hasServiceProviderWorkspace && !serviceProviderLive) ||
      (hasPartnerWorkspace && !partnerLive),
  );

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
    if (!hasPartnerWorkspace) {
      setPartnerStatus(null);
      return;
    }
    let cancelled = false;
    void supabase
      .from("property_partners")
      .select("status")
      .eq("profile_id", profile.user_id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled || error) return;
        setPartnerStatus((data?.status as PartnerStatus) || null);
      });
    return () => {
      cancelled = true;
    };
  }, [hasPartnerWorkspace, profile.user_id]);

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
    if (error) return toast.error("This preference could not be saved");
    toast.success("Preference saved");
  }

  async function acceptLegal() {
    if (
      (published.privacy && !legal.privacy_accepted && !acceptPrivacy) ||
      (published.terms && !legal.terms_accepted && !acceptTerms)
    )
      return toast.error("Read and accept each published document");
    setSaving(true);
    let next = legal;
    if (published.privacy && !legal.privacy_accepted) {
      const { data, error } = await supabase.rpc("accept_current_legal", {
        p_document: "privacy",
      });
      if (error) {
        setSaving(false);
        return toast.error(error.message);
      }
      if (data) next = data as Legal;
    }
    if (published.terms && !legal.terms_accepted) {
      const { data, error } = await supabase.rpc("accept_current_legal", {
        p_document: "terms",
      });
      if (error) {
        setSaving(false);
        return toast.error(error.message);
      }
      if (data) next = data as Legal;
    }
    setSaving(false);
    setLegal(next);
    setAcceptPrivacy(false);
    setAcceptTerms(false);
    toast.success("Legal documents accepted");
  }

  async function logout() {
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
      toast.error("Could not log out. Check your connection and try again.");
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
        ? "Service Provider onboarding started"
        : "Property Partner onboarding started",
    );
    onWorkspaceActivated?.(workspace);
  }

  function continueProfessionalOnboarding(
    workspace: "worker" | "property_partner",
  ) {
    onWorkspaceActivated?.(workspace);
  }

  if (panel === "help")
    return <AccountHelpCenter profile={profile} onBack={() => setPanel(null)} />;

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
        title="Workspaces & access"
        description="One WeHouse identity. Open approved workspaces or continue an application."
        onBack={() => setPanel(null)}
      >
        <Toaster position="top-center" richColors />
        <section className="rounded-2xl border border-violet-500/15 bg-violet-500/[.045] p-4">
          <p className="text-[9px] font-bold uppercase tracking-[.15em] text-violet-300">
            ONE IDENTITY
          </p>
          <p className="mt-2 text-[11px] leading-5 text-[#A4A9B7]">
            Your Personal account, bookings and history stay with you. Service
            Provider, Property Partner, hotel-team and WeHouse-team access are
            additional permissions on this same identity.
          </p>
        </section>

        {switchableWorkspaces.length > 0 && onSwitchWorkspace ? (
          <AccountSection title="Switch workspace">
            {switchableWorkspaces.map((workspace) => (
              <AccountRow
                key={workspace.role}
                title={workspace.label}
                detail={
                  activeWorkspace === workspace.role
                    ? `Current · ${workspace.detail}`
                    : workspace.detail
                }
                onClick={() => onSwitchWorkspace(workspace.role)}
                icon={<ToolsIcon />}
              />
            ))}
          </AccountSection>
        ) : null}

        {canStartProfessionalOnboarding ? (
          <AccountSection title="Use WeHouse as">
            {!hasServiceProviderWorkspace ? (
              <AccountRow
                title="Service Provider"
                detail="Offer services through WeHouse Services. Onboarding and WeHouse review are free."
                onClick={() => void startProfessionalOnboarding("worker")}
                disabled={activatingWorkspace !== null}
                icon={<PersonIcon />}
              />
            ) : !serviceProviderLive ? (
              <AccountRow
                title="Continue Service Provider onboarding"
                detail={serviceProviderStatusText(profile.worker_status)}
                onClick={() => continueProfessionalOnboarding("worker")}
                disabled={activatingWorkspace !== null}
                icon={<PersonIcon />}
              />
            ) : null}

            {!hasPartnerWorkspace ? (
              <AccountRow
                title="Property Partner"
                detail="List or manage apartments and hotels. Publishing still requires the applicable WeHouse review."
                onClick={() => void startProfessionalOnboarding("property_partner")}
                disabled={activatingWorkspace !== null}
                icon={<HomeIcon />}
              />
            ) : !partnerLive ? (
              <AccountRow
                title="Continue Property Partner onboarding"
                detail={partnerStatusText(partnerStatus)}
                onClick={() => continueProfessionalOnboarding("property_partner")}
                disabled={activatingWorkspace !== null}
                icon={<HomeIcon />}
              />
            ) : null}

            {serviceProviderLive && partnerLive ? (
              <div className="px-4 py-4 text-[10px] leading-5 text-[#777E8E] sm:px-5">
                Your Service Provider and Property Partner workspaces are both
                active. Additional hotel-team or WeHouse-team access arrives by
                invitation or grant, not by creating another account.
              </div>
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
        <Toaster position="top-center" richColors />
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
            detail="Show new-message and announcement popups while WeHouse is open."
            value={pushNotifs}
            disabled={saving}
            onChange={(value) => {
              setPushNotifs(value);
              void saveNotificationPreference("pref_push_notif", value);
            }}
          />
        </AccountSection>
        <p className="px-1 text-[9px] text-[#656C7C]">
          Changes save automatically.
        </p>
      </AccountShell>
    );
  }

  if (panel === "legal") {
    const any = published.privacy || published.terms;
    const done =
      (!published.privacy || legal.privacy_accepted) &&
      (!published.terms || legal.terms_accepted);
    return (
      <AccountShell
        profile={profile}
        title="Legal & consent"
        description="Published WeHouse documents and your current consent status."
        onBack={() => setPanel(null)}
      >
        <Toaster position="top-center" richColors />
        <section className="rounded-2xl border border-white/[.06] bg-[#11141C] p-4 sm:p-5">
          <p className="text-sm font-semibold">Published documents</p>
          <p className="mt-1 text-[10px] leading-relaxed text-[#74798B]">
            Only documents actually published by WeHouse can be accepted.
          </p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <LegalCard
              title="Privacy Policy"
              published={published.privacy}
              accepted={legal.privacy_accepted}
              onClick={() => openLegal("privacy_policy")}
            />
            <LegalCard
              title="Terms & Conditions"
              published={published.terms}
              accepted={legal.terms_accepted}
              onClick={() => openLegal("terms_of_service")}
            />
          </div>
        </section>

        {!any ? (
          <Empty
            title="Nothing to accept yet"
            text="Privacy Policy and Terms & Conditions have not been published."
          />
        ) : (
          <>
            {!done ? (
              <AccountSection>
                {published.privacy && !legal.privacy_accepted ? (
                  <Check
                    label="I have read and accept the published Privacy Policy"
                    value={acceptPrivacy}
                    set={setAcceptPrivacy}
                  />
                ) : null}
                {published.terms && !legal.terms_accepted ? (
                  <Check
                    label="I have read and accept the published Terms & Conditions"
                    value={acceptTerms}
                    set={setAcceptTerms}
                  />
                ) : null}
              </AccountSection>
            ) : null}
            {done ? (
              <div className="rounded-2xl border border-emerald-500/15 bg-emerald-500/[.05] p-4 text-xs text-emerald-300">
                Current published documents accepted.
              </div>
            ) : (
              <button
                onClick={() => void acceptLegal()}
                disabled={
                  saving ||
                  (published.privacy &&
                    !legal.privacy_accepted &&
                    !acceptPrivacy) ||
                  (published.terms && !legal.terms_accepted && !acceptTerms)
                }
                className="h-12 w-full rounded-2xl bg-violet-500 text-xs font-semibold disabled:opacity-40"
              >
                {saving ? "Saving…" : "Accept published documents"}
              </button>
            )}
          </>
        )}
      </AccountShell>
    );
  }

  const anyPublished = published.privacy || published.terms;
  const legalDone =
    anyPublished &&
    (!published.privacy || legal.privacy_accepted) &&
    (!published.terms || legal.terms_accepted);

  const workspaceDetail = hasPendingProfessionalSetup
    ? "Continue onboarding, switch approved workspaces or view assigned access"
    : switchableWorkspaces.length > 1
      ? "Switch approved workspaces or add another way to use WeHouse"
      : "Offer services, list property or view assigned work access";

  return (
    <AccountShell
      profile={profile}
      title="Account"
      description="Your identity, work access, preferences and account protection."
      onBack={onBack}
    >
      <Toaster position="top-center" richColors />

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
              <span className="rounded-full border border-white/[.07] bg-white/[.03] px-2 py-1 text-[8px] font-semibold text-[#9CA2B2]">
                {roleLabel}
              </span>
            </div>
            <p className="mt-1 truncate text-[10px] text-[#777E8E]">
              {profile.email || "No email"}
            </p>
            {isServiceProvider ? (
              <p className="mt-2 text-[9px] leading-relaxed text-[#62697A]">
                Your Service Provider details and public WeHouse Services profile
                are managed from this same identity.
              </p>
            ) : null}
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

      {workspaceAccess ? (
        <AccountSection title="Workspaces & access">
          <AccountRow
            title="Use WeHouse as"
            detail={workspaceDetail}
            onClick={() => setPanel("workspaces")}
            icon={<ToolsIcon />}
          />
        </AccountSection>
      ) : null}

      <AccountSection title="Account">
        {isServiceProvider ? (
          <AccountRow
            title="Service Provider profile"
            detail="Services, coverage, pricing and the public details customers see"
            onClick={onGoToProfileEdit}
            icon={<PersonIcon />}
          />
        ) : null}
        {onGoToWorkerPaidTools ? (
          <AccountRow
            title="WeHouse Pro"
            detail="Optional business tools for your Service Provider workspace"
            onClick={onGoToWorkerPaidTools}
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
            detail="Saved apartments and search alerts"
            onClick={onGoToSaved}
            icon={<HeartIcon />}
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

      <AccountSection title="Help">
        <AccountRow
          title="Help"
          detail="General help, linked jobs, payments, payouts and safety or security concerns"
          onClick={() => setPanel("help")}
          icon={<ToolsIcon />}
        />
      </AccountSection>

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

      <button
        onClick={() => void logout()}
        disabled={signingOut}
        className="w-full rounded-2xl border border-red-500/15 bg-red-500/[.04] p-4 text-left transition hover:bg-red-500/[.06] disabled:opacity-50"
      >
        <p className="text-[12px] font-semibold text-red-300">
          {signingOut ? "Logging out…" : "Log out"}
        </p>
        <p className="mt-1 text-[9px] text-red-300/60">
          {signingOut
            ? "Closing this session securely"
            : "Sign out of this device"}
        </p>
      </button>
    </AccountShell>
  );
}

function serviceProviderStatusText(status?: string | null) {
  if (status === "profile_under_review")
    return "Your Service Provider profile is under WeHouse review.";
  if (status === "pending")
    return "Finish your services, coverage and required onboarding steps.";
  return "Continue your Service Provider onboarding.";
}

function partnerStatusText(status: PartnerStatus) {
  if (status === "pending_verification")
    return "Continue the Property Partner application and property verification flow.";
  return "Continue your Property Partner setup.";
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
        <p className="text-[12px] font-semibold">{label}</p>
        <p className="mt-0.5 text-[9px] leading-relaxed text-[#6F7585]">
          {detail}
        </p>
      </div>
      <button
        type="button"
        disabled={disabled}
        aria-pressed={value}
        onClick={() => onChange(!value)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-50 ${
          value ? "bg-violet-500" : "bg-[#292D38]"
        }`}
      >
        <span
          className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
            value ? "translate-x-5" : ""
          }`}
        />
      </button>
    </div>
  );
}

function Check({
  label,
  value,
  set,
}: {
  label: string;
  value: boolean;
  set: (value: boolean) => void;
}) {
  return (
    <label className="flex min-h-[4rem] cursor-pointer items-center gap-3 border-b border-white/[.05] px-4 py-3 last:border-b-0 sm:px-5">
      <input
        type="checkbox"
        checked={value}
        onChange={(event) => set(event.target.checked)}
        className="h-4 w-4 accent-violet-500"
      />
      <span className="text-[10px] leading-relaxed text-[#B3B8C4]">
        {label}
      </span>
    </label>
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
      className="rounded-2xl border border-white/[.06] bg-black/10 p-4 text-left disabled:opacity-40"
    >
      <p className="text-[11px] font-semibold">{title}</p>
      <p
        className={`mt-2 text-[9px] ${
          accepted ? "text-emerald-300" : "text-[#6E7484]"
        }`}
      >
        {!published ? "Not published" : accepted ? "Accepted" : "Review document"}
      </p>
    </button>
  );
}

function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-white/[.08] px-5 py-8 text-center">
      <p className="text-xs font-semibold">{title}</p>
      <p className="mt-1 text-[9px] text-[#666D7E]">{text}</p>
    </div>
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
