import { useEffect, useState } from "react";
import WorkspaceFrameV2 from "@/components/WorkspaceFrameV2";
import WorkerActivationHome from "@/components/WorkerActivationHome";
import ExperienceActivitiesPanel from "@/components/ExperienceActivitiesPanel";
import ExperienceHostBookings from '@/components/ExperienceHostBookings';
import WorkerJobsPanelV2, {
  WorkerInboxPanel,
} from "@/components/WorkerJobsPanelV2";
import type { WorkerBookingConversation } from "@/components/WorkerJobsPanelV2";
import WorkerShowcaseManager from "@/components/WorkerShowcaseManager";
import SupportEntryCard from "@/components/SupportEntryCard";
import WorkerProPanel from "@/components/WorkerProPanel";
import SponsoredCampaignPanel from "@/components/SponsoredCampaignPanel";
import AccountCenter, {
  type WorkspaceAccess,
  type WorkspaceChoice,
} from "@/pages/AccountCenter";
import AccountShell from "@/components/AccountShell";
import WorkerProfilePanel from "@/components/WorkerProfilePanel";
import type { Profile } from "@/types";
import IdentityAccessGate from "@/components/IdentityAccessGate";
import WorkerWallet from "@/pages/WorkerWallet";
import PayoutAccountManager from "@/components/PayoutAccountManager";
import WorkerAvailabilityControl from "@/components/WorkerAvailabilityControl";
import { useWorkerInboxSummary } from "@/hooks/useWorkerInboxSummary";
import { useWorkerPro } from "@/hooks/useWorkerPro";
import WorkspaceSwitchSheet from "@/components/WorkspaceSwitchSheet";
import InboxActivityEntry from '@/components/InboxActivityEntry';
import ActivityHeader from '@/components/ActivityHeader';
import Notifications from '@/pages/Notifications';
import { useProviderWorkspaceCapabilities } from '@/hooks/useProviderWorkspaceCapabilities';

type Tab = "experiences" | "home" | "jobs" | "inbox" | "showcase" | "earnings" | "account";

const COMMON_NAV = [
  { id: "experiences", label: "Experiences" },
  { id: "inbox", label: "Inbox" },
  { id: "earnings", label: "Earnings" },
  { id: "account", label: "Account" },
];

export default function WorkerWorkspaceModern(props: Parameters<typeof WorkerWorkspaceContent>[0]) {
  return <WorkerWorkspaceContent key={props.profile.user_id} {...props} />;
}

function WorkerWorkspaceContent({
  profile,
  onGoToSetup,
  onLogout,
  onNavigate,
  workspaceAccess,
  activeWorkspace,
  onSwitchWorkspace,
  inboxOpenRequest = 0,
}: {
  inboxOpenRequest?: number;
  profile: Profile;
  onGoToSetup: () => void;
  onLogout: () => void;
  onNavigate?: (page: string, id?: string) => void;
  workspaceAccess?: WorkspaceAccess | null;
  activeWorkspace?: WorkspaceChoice;
  onSwitchWorkspace?: (workspace: WorkspaceChoice) => void;
}) {
  const access = useProviderWorkspaceCapabilities(profile.user_id,`${profile.worker_status}:${profile.worker_verified}`);
  const serviceReviewed = access.capabilities?.service_reviewed===true;
  const canManageJobs = access.capabilities?.can_manage_jobs===true;
  const inbox = useWorkerInboxSummary(profile.user_id);
  const rootItem = canManageJobs ? { id: "jobs", label: "Jobs" } : { id: "home", label: "Overview" };
  const nav = [rootItem,...COMMON_NAV.slice(0,2),
    ...(access.capabilities?.can_manage_showcase?[{id:'showcase',label:'Showcase'}]:[]),...COMMON_NAV.slice(2)].map((item) =>
        item.id === "inbox"
          ? { ...item, badge: inbox.totalUnread || undefined }
          : item,
      );
  const [tab, setTab] = useState<Tab>('home');
  const [conversation, setConversation] =
    useState<WorkerBookingConversation | null>(null);
  const [showcaseTargetId, setShowcaseTargetId] = useState<string>();
  const [switchOpen, setSwitchOpen] = useState(false);
  const [experienceTarget,setExperienceTarget]=useState<{id:string;sequence:number}|null>(null);
  const [experienceBookingTarget,setExperienceBookingTarget]=useState<{id:string;sequence:number}|null>(null);
  const [reminderTarget,setReminderTarget]=useState<string|null>(null);
  const [accountView, setAccountView] = useState<
    "account" | "profile" | "paid_tools" | "sponsored"
  >("account");
  useEffect(() => {
    if (!inboxOpenRequest) return;
    setConversation(null); setTab("inbox");
  }, [inboxOpenRequest]);
  useEffect(() => {
    const activated = (event: Event) => {
      const detail = (event as CustomEvent<{ workerId?: string }>).detail;
      if (detail?.workerId && detail.workerId !== profile.user_id) return;
      setConversation(null);
      setTab("account");
      setAccountView("paid_tools");
    };
    window.addEventListener("wehouse:worker-pro-activated", activated);
    return () => window.removeEventListener("wehouse:worker-pro-activated", activated);
  }, [profile.user_id]);
  const safeTab = tab==='home'&&canManageJobs?'jobs':(tab==='jobs'&&!canManageJobs)||(tab==='showcase'&&!access.capabilities?.can_manage_showcase)?'home':tab;

  function openActivityDestination(page: string, id?: string) {
    const route = page.toLowerCase().replace(/-/g, "_");
    if(route==='experience_application'&&id){
      setExperienceBookingTarget(null);setExperienceTarget({id,sequence:Date.now()});setConversation(null);setTab('experiences');return;
    }
    if(route==='experience_booking'&&id){setExperienceBookingTarget({id,sequence:Date.now()});setConversation(null);setTab('experiences');return;}
    if (route === "worker_paid_tools") {
      setReminderTarget(id||null);
      setConversation(null);
      setAccountView("paid_tools");
      setTab("account");
      return;
    }
    if (/worker_showcase|showcase_post/.test(route)) {
      setShowcaseTargetId(id);
      setTab("showcase");
      return;
    }
    onNavigate?.(page, id);
  }

  if (safeTab === "account") {
    if (accountView === "profile")
      return (
        <AccountShell
          profile={profile}
          workspace="worker"
          title="Service Worker profile"
          description="Services, coverage and the public details customers see."
          onBack={() => setAccountView("account")}
        >
          <WorkerProfilePanel
            profile={profile}
            onEdit={onGoToSetup}
            onVerification={() => onNavigate?.("worker_verification")}
          />
        </AccountShell>
      );
    if (accountView === "paid_tools")
      return (
        <ServiceProviderPaidToolsAccount
          key={reminderTarget||'paid-tools'}
          profile={profile}
          initialBusinessTools={Boolean(reminderTarget)}
          onBack={() => {setReminderTarget(null);setAccountView("account");}}
        />
      );
    if (accountView === "sponsored")
      return <AccountShell profile={profile} workspace="worker" title="Sponsored" description="Promote an eligible service profile or activity." onBack={() => setAccountView("account")}><SponsoredCampaignPanel types={['worker','experience']} /></AccountShell>;
    return (
      <AccountCenter
        profile={profile}
        onBack={() => setTab('home')}
        onGoToPrivacy={() => {}}
        onGoToSaved={() => onNavigate?.("saved")}
        onGoToSecurity={() => {}}
        onGoToProfileEdit={() => setAccountView("profile")}
        onGoToWorkerPaidTools={canManageJobs ? () => setAccountView("paid_tools") : undefined}
        onGoToSponsored={access.capabilities?.can_apply_experiences ? () => setAccountView("sponsored") : undefined}
        onNavigate={(page) => onNavigate?.(page)}
        onLogout={onLogout}
        workspaceAccess={workspaceAccess}
        activeWorkspace={activeWorkspace}
        onSwitchWorkspace={onSwitchWorkspace}
      />
    );
  }

  let content: React.ReactNode;
  if (safeTab === "experiences") {
    content = experienceBookingTarget?<ExperienceHostBookings key={experienceBookingTarget.sequence} userId={profile.user_id} initialBookingId={experienceBookingTarget.id} onBack={()=>setExperienceBookingTarget(null)}/>:<ExperienceActivitiesPanel profile={profile} initialApplication={experienceTarget} />;
  } else if (canManageJobs && safeTab === "jobs") {
    content = (
      <div className="space-y-4">
        {serviceReviewed?<WorkerAvailabilityControl profile={profile} />:<p className="rounded-xl border border-[var(--wh-border)] p-4 text-sm text-[var(--wh-text-secondary)]">Your existing jobs remain available. New service requests require current service approval.</p>}
        <WorkerJobsPanelV2
          profile={profile}
          onOpenConversation={(row) => {
            setConversation(row);
            setTab("inbox");
          }}
        />
      </div>
    );
  } else if (!canManageJobs && safeTab === "inbox") {
    // Setup-related WeHouse messages remain reachable without exposing jobs or
    // treating an unapproved worker as a public service provider.
    content = <ApplicantInbox profile={profile} unread={inbox.activityUnread} onNavigate={openActivityDestination} onUnreadChange={()=>void inbox.refresh()} />;
  } else if (canManageJobs && safeTab === "inbox") {
    content = (
      <WorkerInboxPanel
        profile={profile}
        initialConversation={conversation}
        onConversationClosed={() => setConversation(null)}
        onNavigate={openActivityDestination}
        onOpenJobs={() => setTab("jobs")}
        chatUnread={inbox.chatUnread}
        activityUnread={inbox.activityUnread}
        onUnreadRefresh={inbox.refresh}
      />
    );
  } else if (access.capabilities?.can_manage_showcase && safeTab === "showcase") {
    content = (
      <WorkerShowcaseManager
        profile={profile}
        initialPostId={showcaseTargetId}
      />
    );
  } else if (safeTab === "earnings") {
    content = (
      <div className="space-y-5">
        <WorkerWallet profile={profile} />
        <PayoutAccountManager profile={profile} workspace="worker" />
      </div>
    );
  } else {
    content = (
      <WorkerActivationHome
        profile={profile}
        onProfile={onGoToSetup}
        onExperiences={() => setTab("experiences")}
        activityBookings={access.capabilities?.experience_next}
        hasActivityBookings={access.capabilities?.has_activity_bookings}
        onActivityBooking={id=>{setExperienceBookingTarget({id:id||'',sequence:Date.now()});setTab('experiences');}}
        onRefresh={access.refresh}
        onVerification={() => onNavigate?.("worker_verification")}
      />
    );
  }

  const description =
    safeTab === "experiences"
      ? "Create private activity applications and follow WeHouse review."
      : safeTab === "inbox"
      ? "Job conversations and important payment, security and official activity."
      : safeTab === "earnings"
        ? "See available earnings, withdrawals and your verified payout account."
        : safeTab === "showcase"
          ? "Publish and manage the work customers see on your profile."
          : safeTab === "jobs"
            ? "Track each job from request to completion, including its earnings."
            : "Manage requested services and Experiences from one workspace. Each offering has its own review requirements.";

  const workspace = (
    <WorkspaceFrameV2
        identityName={profile.full_name || profile.username}
        identityAvatar={profile.avatar_url}
      label="WEHOUSE SERVICES · SERVICE WORKER"
      title={nav.find((item) => item.id === safeTab)?.label || "Service Worker"}
      description={description}
      compact={safeTab === "showcase"}
      items={nav}
      active={safeTab}
      setActive={(id) => {setExperienceTarget(null);setTab(id as Tab);}}
      onWorkspaceSwitch={
        workspaceAccess && onSwitchWorkspace ? () => setSwitchOpen(true) : undefined
      }
      onAccount={() => setTab('account')}
      onLogout={onLogout}
    >
      {access.error&&<section role="alert" className="mb-4 space-y-2 rounded-xl border border-[var(--wh-border)] p-4"><p className="text-sm text-red-700 dark:text-red-300">{access.error}</p><button type="button" disabled={access.loading} onClick={access.refresh} className="wh-motion-control min-h-11 rounded-xl border border-[var(--wh-border)] px-3 text-sm font-semibold">Retry workspace access</button></section>}
      {access.loading&&<p role="status" className="mb-3 text-sm text-[var(--wh-text-secondary)]">Checking workspace access...</p>}
      {!canManageJobs && safeTab==='home' && workspaceAccess?.personal_workspace && onSwitchWorkspace && (
        <button type="button" onClick={()=>onSwitchWorkspace('personal')} className="mb-4 flex min-h-11 items-center gap-2 rounded-lg pr-3 text-sm font-semibold text-[var(--wh-accent-text)]">
          <span aria-hidden="true">←</span> Back to Personal
        </button>
      )}
      {content}
    </WorkspaceFrameV2>
  );
  const switcher =
    workspaceAccess && onSwitchWorkspace ? (
      <WorkspaceSwitchSheet
        open={switchOpen}
        access={workspaceAccess}
        active={activeWorkspace}
        identityName={profile.full_name || profile.username}
        identityAvatar={profile.avatar_url}
        onClose={() => setSwitchOpen(false)}
        onSwitch={onSwitchWorkspace}
      />
    ) : null;

  return ['jobs','showcase','earnings'].includes(safeTab) ? (
    <>
      <IdentityAccessGate
        profile={profile}
        workspace="worker"
        onWorkspaceSwitch={
          workspaceAccess && onSwitchWorkspace ? () => setSwitchOpen(true) : undefined
        }
      >
        {workspace}
      </IdentityAccessGate>
      {switcher}
    </>
  ) : (
    <>
      {workspace}
      {switcher}
    </>
  );
}

function ApplicantInbox({profile,unread,onNavigate,onUnreadChange}:{
  profile:Profile;unread:number;onNavigate:(page:string,id?:string)=>void;onUnreadChange:()=>void;
}){
  const [activity,setActivity]=useState(false);
  return activity?<div><ActivityHeader onBack={()=>setActivity(false)}/><Notifications profile={profile} scope="worker" embedded onNavigate={onNavigate} onUnreadChange={onUnreadChange}/></div>:<div className="space-y-4"><InboxActivityEntry unread={unread} detail="Application decisions, account security and official updates" onOpen={()=>setActivity(true)}/><SupportEntryCard profile={profile} compact/></div>;
}

function ServiceProviderPaidToolsAccount({
  profile,
  onBack,
  initialBusinessTools=false,
}: {
  profile: Profile;
  onBack: () => void;
  initialBusinessTools?:boolean;
}) {
  const workerPro = useWorkerPro(profile.user_id);
  return (
    <AccountShell
      profile={profile}
      title="WeHouse Pro · Work tools"
      workspace="worker"
      description="Optional business tools for this Service Worker workspace. Review and trust are earned separately."
      onBack={onBack}
    >
      <WorkerProPanel
        initialBusinessTools={initialBusinessTools}
        profile={profile}
        pro={workerPro.pro}
        loading={workerPro.loading}
        error={workerPro.error}
        onRefresh={workerPro.refresh}
      />
    </AccountShell>
  );
}
