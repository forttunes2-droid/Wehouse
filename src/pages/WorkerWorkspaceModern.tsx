import { useState } from 'react';
import WorkspaceFrameV2 from '@/components/WorkspaceFrameV2';
import WorkerActivationHome from '@/components/WorkerActivationHome';
import WorkerPriorityPanelV2 from '@/components/WorkerPriorityPanelV2';
import WorkerNextJobPanelV2 from '@/components/WorkerNextJobPanelV2';
import WorkerJobsPanelV2 from '@/components/WorkerJobsPanelV2';
import WorkerProfilePanelV2 from '@/components/WorkerProfilePanelV2';
import WorkerShowcaseManager from '@/components/WorkerShowcaseManager';
import WorkerWallet from './WorkerWallet';
import type { Profile } from '@/types';

type Tab = 'home' | 'jobs' | 'showcase' | 'earnings' | 'profile';

const LIVE_NAV = [
  { id: 'home', label: 'Home' },
  { id: 'jobs', label: 'Jobs' },
  { id: 'showcase', label: 'Showcase' },
  { id: 'earnings', label: 'Earnings' },
  { id: 'profile', label: 'Professional Profile' },
];

const ACTIVATION_NAV = [
  { id: 'home', label: 'Home' },
  { id: 'profile', label: 'Professional Profile' },
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
  const safeTab = !live && (tab === 'jobs' || tab === 'showcase' || tab === 'earnings') ? 'home' : tab;

  let content: React.ReactNode;
  if (safeTab === 'profile') {
    content = (
      <WorkerProfilePanelV2
        profile={profile}
        onEdit={onGoToSetup}
        onVerification={() => onNavigate?.('worker_verification')}
        onShowcase={live ? () => setTab('showcase') : undefined}
      />
    );
  } else if (live && safeTab === 'jobs') {
    content = <WorkerJobsPanelV2 profile={profile} />;
  } else if (live && safeTab === 'showcase') {
    content = <WorkerShowcaseManager profile={profile} />;
  } else if (live && safeTab === 'earnings') {
    content = <WorkerWallet profile={profile} />;
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
    : safeTab === 'showcase'
      ? 'Share current work and keep your best work in Portfolio.'
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
    <div className="space-y-5">
      <section className="rounded-3xl border border-violet-500/15 bg-gradient-to-br from-violet-500/[.10] via-[#12141C] to-[#0F1218] p-5 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[9px] font-bold uppercase tracking-[.18em] text-violet-300">LIVE PROFESSIONAL</p>
              <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-[8px] font-semibold text-emerald-300">WEHOUSE VERIFIED</span>
            </div>
            <h2 className="mt-3 truncate text-2xl font-bold">{profile.full_name || profile.username || 'Your work'}</h2>
            <p className="mt-2 max-w-xl text-xs leading-relaxed text-[#7B8292]">Keep jobs moving and keep your public work current.</p>
          </div>
          <div className="flex shrink-0 items-center gap-2 text-[9px] text-[#6F7787]">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            <span>Available to customers</span>
          </div>
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-2">
        <button onClick={() => setTab('showcase')} className="rounded-3xl border border-violet-500/15 bg-violet-500/[.05] p-5 text-left transition hover:bg-violet-500/[.08]">
          <p className="text-[9px] font-bold uppercase tracking-[.16em] text-violet-300">SHOW YOUR WORK</p>
          <h3 className="mt-2 text-base font-bold">Post a Work Status</h3>
          <p className="mt-1 text-[10px] leading-relaxed text-[#777E8E]">24-hour update or permanent Portfolio work.</p>
          <p className="mt-3 text-[10px] font-semibold text-violet-300">Open Showcase →</p>
        </button>
        <button onClick={() => setTab('profile')} className="rounded-3xl border border-white/[.07] bg-[#10141C] p-5 text-left transition hover:bg-white/[.035]">
          <p className="text-[9px] font-bold uppercase tracking-[.16em] text-[#6E7484]">CUSTOMER VIEW</p>
          <h3 className="mt-2 text-base font-bold">Professional Profile</h3>
          <p className="mt-1 text-[10px] leading-relaxed text-[#777E8E]">Preview and update what customers see.</p>
          <p className="mt-3 text-[10px] font-semibold text-[#B3B8C4]">Open profile →</p>
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.25fr_.75fr]">
        <WorkerPriorityPanelV2 profile={profile} onOpenJobs={() => setTab('jobs')} />
        <WorkerNextJobPanelV2 profile={profile} onOpenJobs={() => setTab('jobs')} />
      </div>
    </div>
  );
}
