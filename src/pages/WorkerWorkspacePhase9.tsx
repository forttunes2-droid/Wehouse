import { useEffect, useState } from 'react';
import WorkspaceFrameV2 from '@/components/WorkspaceFrameV2';
import GoldTickBadge from '@/components/GoldTickBadge';
import WorkerActivationHome from '@/components/WorkerActivationHome';
import WorkerPriorityPanelV2 from '@/components/WorkerPriorityPanelV2';
import WorkerNextJobPanelV2 from '@/components/WorkerNextJobPanelV2';
import WorkerJobsPanelV2 from '@/components/WorkerJobsPanelV2';
import WorkerProfilePanelV2 from '@/components/WorkerProfilePanelV2';
import WorkerShowcaseManager from '@/components/WorkerShowcaseManager';
import PayoutAccountManager from '@/components/PayoutAccountManager';
import WorkerWallet from './WorkerWallet';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/types';

type Tab = 'home' | 'jobs' | 'showcase' | 'earnings' | 'profile';
type Activation = {
  live: boolean;
  identity_current?: boolean;
  identity_due_at?: string | null;
  identity_days_remaining?: number | null;
  identity_recheck_days?: number;
  identity_status?: string;
};

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

export default function WorkerWorkspacePhase9({
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
  const approved = profile.worker_status === 'verified' && profile.worker_verified === true;
  const [activation, setActivation] = useState<Activation | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('home');

  useEffect(() => {
    let live = true;
    void (async () => {
      const { data } = await supabase.rpc('get_my_worker_activation');
      if (!live) return;
      setActivation((data || { live: false }) as Activation);
      setLoading(false);
    })();
    return () => { live = false; };
  }, [profile.user_id, profile.updated_at]);

  if (loading) return <WorkspaceFrameV2 label="WEHOUSE · WORKER" title="Worker" description="Checking your Worker account." items={ACTIVATION_NAV} active="home" setActive={() => {}} onAccount={onNavigate ? () => onNavigate('profile') : undefined} onLogout={onLogout}><div className="grid min-h-64 place-items-center"><div className="h-7 w-7 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" /></div></WorkspaceFrameV2>;

  const identityCurrent = Boolean(activation?.identity_current);
  const live = approved && Boolean(activation?.live) && identityCurrent;
  const identityExpired = approved && !identityCurrent;
  const nav = live ? LIVE_NAV : ACTIVATION_NAV;
  const safeTab = !live && (tab === 'jobs' || tab === 'showcase' || tab === 'earnings') ? 'home' : tab;

  let content: React.ReactNode;
  if (safeTab === 'profile') {
    content = <WorkerProfilePanelV2 profile={profile} onEdit={onGoToSetup} onVerification={() => onNavigate?.('worker_verification')} onShowcase={live ? () => setTab('showcase') : undefined} />;
  } else if (live && safeTab === 'jobs') {
    content = <WorkerJobsPanelV2 profile={profile} />;
  } else if (live && safeTab === 'showcase') {
    content = <WorkerShowcaseManager profile={profile} />;
  } else if (live && safeTab === 'earnings') {
    content = <div className="space-y-5"><PayoutAccountManager profile={profile} /><WorkerWallet profile={profile} /></div>;
  } else if (identityExpired) {
    content = <IdentityRenewal activation={activation} onVerify={() => onNavigate?.('worker_verification')} />;
  } else if (live) {
    content = <LiveHome profile={profile} activation={activation} setTab={setTab} onVerify={() => onNavigate?.('worker_verification')} />;
  } else {
    content = <WorkerActivationHome profile={profile} onProfile={() => setTab('profile')} onVerification={() => onNavigate?.('worker_verification')} />;
  }

  const description = identityExpired
    ? 'Your approved profile is safe. Repeat the quick identity check to return to public Worker activity.'
    : safeTab === 'profile'
      ? live ? 'Preview and manage the professional profile customers see.' : 'Build the professional profile customers will see after approval.'
      : safeTab === 'showcase'
        ? 'Share current work and keep your best work in Portfolio.'
        : live ? 'Manage your work from one place.' : 'Finish verification before your services become public.';

  return <WorkspaceFrameV2
    label="WEHOUSE · WORKER"
    title={nav.find((item) => item.id === safeTab)?.label || 'Worker'}
    description={description}
    items={nav}
    active={safeTab}
    setActive={(id) => setTab(id as Tab)}
    onAccount={onNavigate ? () => onNavigate('profile') : undefined}
    onLogout={onLogout}
  >{content}</WorkspaceFrameV2>;
}

function IdentityRenewal({ activation, onVerify }: { activation: Activation | null; onVerify: () => void }) {
  const days = Number(activation?.identity_recheck_days || 14);
  return <div className="space-y-5">
    <section className="rounded-3xl border border-amber-500/20 bg-gradient-to-br from-amber-500/[.10] via-[#12141C] to-[#0F1218] p-5 sm:p-6">
      <p className="text-[9px] font-bold uppercase tracking-[.18em] text-amber-300">IDENTITY CHECK DUE</p>
      <h2 className="mt-3 text-2xl font-bold">Confirm it is still you</h2>
      <p className="mt-2 max-w-2xl text-xs leading-6 text-[#89909F]">WeHouse repeats the private live face check every {days} days to protect approved Worker accounts. Your profile, badge, portfolio, reviews, earnings history and completed jobs are not deleted. Public discovery and new Worker activity resume after the quick check passes.</p>
      <button onClick={onVerify} className="mt-5 h-12 rounded-2xl bg-amber-400 px-5 text-xs font-bold text-[#171007]">Complete identity check</button>
    </section>
    <section className="grid gap-3 sm:grid-cols-3">
      <Info label="WHAT YOU REPEAT" value="Selfie + head-turn liveness" />
      <Info label="WHAT YOU DON'T REPEAT" value="Payment, test or skill review" />
      <Info label="ACCOUNT HISTORY" value="Kept safely on your profile" />
    </section>
  </div>;
}

function LiveHome({ profile, activation, setTab, onVerify }: { profile: Profile; activation: Activation | null; setTab: (tab: Tab) => void; onVerify: () => void }) {
  const remaining = activation?.identity_days_remaining;
  const dueSoon = typeof remaining === 'number' && remaining <= 3;
  return <div className="space-y-5">
    <section className="rounded-3xl border border-violet-500/15 bg-gradient-to-br from-violet-500/[.10] via-[#12141C] to-[#0F1218] p-5 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2"><p className="text-[9px] font-bold uppercase tracking-[.18em] text-violet-300">LIVE PROFESSIONAL</p><span className="rounded-full bg-emerald-500/10 px-2 py-1 text-[8px] font-semibold text-emerald-300">WEHOUSE REVIEWED</span></div>
          <div className="mt-3 flex min-w-0 items-center gap-2"><h2 className="truncate text-2xl font-bold">{profile.full_name || profile.username || 'Your work'}</h2><GoldTickBadge title="WeHouse professional badge" /></div>
          <p className="mt-2 max-w-xl text-xs leading-relaxed text-[#7B8292]">Keep jobs moving and keep your public work current.</p>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-[9px] text-[#6F7787]"><span className="h-2 w-2 rounded-full bg-emerald-400" /><span>Available to customers</span></div>
      </div>
    </section>

    <section className={`rounded-3xl border p-4 sm:p-5 ${dueSoon ? 'border-amber-500/20 bg-amber-500/[.055]' : 'border-blue-500/15 bg-blue-500/[.04]'}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div><p className={`text-[8px] font-bold uppercase tracking-[.16em] ${dueSoon ? 'text-amber-300' : 'text-blue-300'}`}>IDENTITY PROTECTION</p><h3 className="mt-1 text-sm font-semibold">{identityLabel(activation)}</h3><p className="mt-1 text-[10px] leading-5 text-[#777F8F]">The quick selfie and head-turn check repeats every {activation?.identity_recheck_days || 14} days. It never charges another onboarding fee.</p></div>
        {dueSoon && <button onClick={onVerify} className="h-10 shrink-0 rounded-xl border border-amber-500/20 px-4 text-[10px] font-semibold text-amber-200">Check identity</button>}
      </div>
    </section>

    <div className="grid gap-4 sm:grid-cols-2">
      <button onClick={() => setTab('showcase')} className="rounded-3xl border border-violet-500/15 bg-violet-500/[.05] p-5 text-left transition hover:bg-violet-500/[.08]"><p className="text-[9px] font-bold uppercase tracking-[.16em] text-violet-300">SHOW YOUR WORK</p><h3 className="mt-2 text-base font-bold">Post a Work Status</h3><p className="mt-1 text-[10px] leading-relaxed text-[#777E8E]">24-hour update or permanent Portfolio work.</p><p className="mt-3 text-[10px] font-semibold text-violet-300">Open Showcase →</p></button>
      <button onClick={() => setTab('profile')} className="rounded-3xl border border-white/[.07] bg-[#10141C] p-5 text-left transition hover:bg-white/[.035]"><p className="text-[9px] font-bold uppercase tracking-[.16em] text-[#6E7484]">CUSTOMER VIEW</p><h3 className="mt-2 text-base font-bold">Professional Profile</h3><p className="mt-1 text-[10px] leading-relaxed text-[#777E8E]">Preview and update what customers see.</p><p className="mt-3 text-[10px] font-semibold text-[#B3B8C4]">Open profile →</p></button>
    </div>
    <div className="grid gap-4 lg:grid-cols-[1.25fr_.75fr]"><WorkerPriorityPanelV2 profile={profile} onOpenJobs={() => setTab('jobs')} /><WorkerNextJobPanelV2 profile={profile} onOpenJobs={() => setTab('jobs')} /></div>
  </div>;
}

function identityLabel(activation: Activation | null) {
  if (activation?.identity_due_at) {
    const date = new Date(activation.identity_due_at).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
    const remaining = activation.identity_days_remaining;
    return `Next identity check ${date}${typeof remaining === 'number' ? ` · ${remaining} day${remaining === 1 ? '' : 's'} remaining` : ''}`;
  }
  return 'Identity check is current';
}
function Info({ label, value }: { label: string; value: string }) { return <div className="rounded-2xl border border-white/[.06] bg-[#10141C] p-4"><p className="text-[8px] font-bold tracking-[.14em] text-[#666D7D]">{label}</p><p className="mt-2 text-[11px] font-semibold text-[#D3D6DE]">{value}</p></div>; }
