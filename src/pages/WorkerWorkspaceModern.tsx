import { useState } from 'react';
import WorkspaceFrameV2 from '@/components/WorkspaceFrameV2';
import GoldTickBadge from '@/components/GoldTickBadge';
import WorkerActivationHome from '@/components/WorkerActivationHome';
import WorkerPriorityPanelV2 from '@/components/WorkerPriorityPanelV2';
import WorkerNextJobPanelV2 from '@/components/WorkerNextJobPanelV2';
import WorkerJobsPanelV2, { WorkerConversationsPanel } from '@/components/WorkerJobsPanelV2';
import type { WorkerBookingConversation } from '@/components/WorkerJobsPanelV2';
import WorkerProfilePanelV2 from '@/components/WorkerProfilePanelV2';
import WorkerShowcaseManager from '@/components/WorkerShowcaseManager';
import type { Profile } from '@/types';

type Tab = 'home' | 'jobs' | 'conversations' | 'work' | 'profile';

const LIVE_NAV = [
  { id: 'home', label: 'Home' },
  { id: 'jobs', label: 'Jobs' },
  { id: 'conversations', label: 'Conversations' },
  { id: 'work', label: 'My Work' },
  { id: 'profile', label: 'Profile' },
];

const ACTIVATION_NAV = [
  { id: 'home', label: 'Home' },
  { id: 'profile', label: 'Profile' },
];

export default function WorkerWorkspaceModern({
  profile,
  onGoToSetup,
  onLogout,
  onNavigate,
}: {
  profile: Profile;
  onGoToSetup: () => void;
  onLogout: () => void;
  onNavigate?: (page: string) => void;
}) {
  const live = profile.worker_status === 'verified' && profile.worker_verified === true;
  const nav = live ? LIVE_NAV : ACTIVATION_NAV;
  const [tab, setTab] = useState<Tab>('home');
  const [conversation, setConversation] = useState<WorkerBookingConversation | null>(null);
  const safeTab = !live && (tab === 'jobs' || tab === 'conversations' || tab === 'work') ? 'home' : tab;

  let content: React.ReactNode;
  if (safeTab === 'profile') {
    content = (
      <WorkerProfilePanelV2
        profile={profile}
        onEdit={onGoToSetup}
        onVerification={() => onNavigate?.('worker_verification')}
        onWork={live ? () => setTab('work') : undefined}
      />
    );
  } else if (live && safeTab === 'jobs') {
    content = <WorkerJobsPanelV2 profile={profile} onOpenConversation={(row) => { setConversation(row); setTab('conversations'); }} />;
  } else if (live && safeTab === 'conversations') {
    content = <WorkerConversationsPanel profile={profile} initialConversation={conversation} onConversationClosed={() => setConversation(null)} />;
  } else if (live && safeTab === 'work') {
    content = <WorkerShowcaseManager profile={profile} />;
  } else if (live) {
    content = <LiveHome profile={profile} setTab={setTab} />;
  } else {
    content = (
      <WorkerActivationHome
        profile={profile}
        onProfile={() => setTab('profile')}
        onVerification={() => onNavigate?.('worker_verification')}
      />
    );
  }

  const description = safeTab === 'profile'
    ? live
      ? 'Preview and manage the professional profile customers see.'
      : 'Build the professional profile customers will see after approval.'
    : safeTab === 'work'
      ? 'Share current work and keep your best work in Portfolio.'
      : safeTab === 'conversations'
        ? 'Customer requests and job updates stay in one continuous conversation.'
        : safeTab === 'jobs'
          ? 'Track each job from request to completion, including its earnings.'
      : live
        ? 'Manage your work from one place.'
        : 'Finish verification before your services become public.';

  return (
    <WorkspaceFrameV2
      label="WEHOUSE · WORKER"
      title={nav.find((item) => item.id === safeTab)?.label || 'Worker'}
      description={description}
      items={nav}
      active={safeTab}
      setActive={(id) => setTab(id as Tab)}
      onAccount={onNavigate ? () => onNavigate('profile') : undefined}
      onLogout={onLogout}
    >
      {content}
    </WorkspaceFrameV2>
  );
}

function LiveHome({ profile, setTab }: { profile: Profile; setTab: (tab: Tab) => void }) {
  return (
    <div className="space-y-4">
      <section className="border-b border-white/[.07] pb-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[9px] font-bold uppercase tracking-[.18em] text-violet-300">LIVE PROFESSIONAL</p>
              <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-[8px] font-semibold text-emerald-300">WEHOUSE REVIEWED</span>
            </div>
            <div className="mt-3 flex min-w-0 items-center gap-2">
              <h2 className="truncate text-2xl font-bold">{profile.full_name || profile.username || 'Your work'}</h2>
              <GoldTickBadge title="WeHouse professional badge" />
            </div>
            <p className="mt-2 max-w-xl text-xs leading-relaxed text-[#7B8292]">Your jobs, availability and public work in one place.</p>
          </div>
          <div className="flex shrink-0 items-center gap-2 text-[9px] text-[#6F7787]">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            <span>Available to customers</span>
          </div>
        </div>
      </section>

      <div className="flex gap-2 overflow-x-auto pb-1">
        <button onClick={() => setTab('jobs')} className="min-h-11 shrink-0 rounded-full bg-violet-500 px-4 text-xs font-semibold">View jobs</button>
        <button onClick={() => setTab('work')} className="min-h-11 shrink-0 rounded-full border border-white/[.09] px-4 text-xs font-semibold text-[#C3C7D1]">Add work</button>
        <button onClick={() => setTab('profile')} className="min-h-11 shrink-0 rounded-full border border-white/[.09] px-4 text-xs font-semibold text-[#C3C7D1]">View profile</button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.25fr_.75fr]">
        <WorkerPriorityPanelV2 profile={profile} onOpenJobs={() => setTab('jobs')} />
        <WorkerNextJobPanelV2 profile={profile} onOpenJobs={() => setTab('jobs')} />
      </div>
    </div>
  );
}
