import { useEffect, useMemo, useState } from 'react';
import { Toaster, toast } from 'sonner';
import { supabase, setWorkerAvailability } from '@/lib/supabase';
import { getMyBookingConversations, BOOKING_STATUS_LABELS } from '@/lib/supabase/worker-bookings';
import BookingNegotiationChat from '@/components/BookingNegotiationChat';
import WorkerWallet from './WorkerWallet';
import type { Profile } from '@/types';
import { WORKER_OCCUPATION_LABELS } from '@/types';

type WorkerTab = 'overview' | 'jobs' | 'schedule' | 'wallet' | 'services' | 'reviews' | 'verification' | 'account';

type WorkerDashboardProps = {
  profile: Profile;
  onGoToSetup: () => void;
  onLogout: () => void;
  onNavigate?: (page: string) => void;
  onGoToChat?: (convId: string) => void;
  onGoToMessages?: () => void;
};

type Stats = {
  views: number;
  activeJobs: number;
  completedJobs: number;
  rating: number;
  reviewCount: number;
};

const TABS: Array<{ key: WorkerTab; label: string; description: string }> = [
  { key: 'overview', label: 'Overview', description: 'Status, availability and work summary' },
  { key: 'jobs', label: 'Jobs', description: 'Booking requests and active work' },
  { key: 'schedule', label: 'Schedule', description: 'Upcoming confirmed jobs' },
  { key: 'wallet', label: 'Wallet', description: 'Earnings, withdrawals and activity' },
  { key: 'services', label: 'Services', description: 'Your professional service profile' },
  { key: 'reviews', label: 'Reviews', description: 'Customer feedback from completed jobs' },
  { key: 'verification', label: 'Verification', description: 'Public status and verification progress' },
  { key: 'account', label: 'Account', description: 'Profile, privacy and security' },
];

const STATUS: Record<string, { label: string; text: string; style: string }> = {
  pending: { label: 'Pending approval', text: 'WeHouse must approve verification access before your public worker review begins.', style: 'border-amber-500/20 bg-amber-500/[0.07] text-amber-300' },
  verification_paid: { label: 'Verification ready', text: 'Complete your professional verification submission.', style: 'border-blue-500/20 bg-blue-500/[0.07] text-blue-300' },
  profile_under_review: { label: 'Under review', text: 'WeHouse is reviewing your professional evidence.', style: 'border-violet-500/20 bg-violet-500/[0.07] text-violet-300' },
  verified: { label: 'Verified and public', text: 'Customers can discover and book you while availability is enabled.', style: 'border-emerald-500/20 bg-emerald-500/[0.07] text-emerald-300' },
  rejected: { label: 'Changes required', text: 'Review the feedback and submit corrected verification evidence.', style: 'border-red-500/20 bg-red-500/[0.07] text-red-300' },
  suspended: { label: 'Suspended', text: 'Your worker profile is not public. Contact WeHouse support.', style: 'border-red-500/20 bg-red-500/[0.07] text-red-300' },
};

export default function WorkerDashboard({ profile, onGoToSetup, onLogout, onNavigate }: WorkerDashboardProps) {
  const [tab, setTab] = useState<WorkerTab>('overview');
  const current = useMemo(() => TABS.find(item => item.key === tab)!, [tab]);

  return <div className="min-h-[100dvh] bg-[#09090D] text-white">
    <Toaster position="top-center" richColors />
    <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-[#09090D]/90 backdrop-blur-xl">
      <div className="flex h-16 items-center justify-between px-4 lg:px-8"><div><h1 className="text-base font-bold lg:text-lg">{current.label}</h1><p className="text-[10px] text-[#686A7D] lg:text-[11px]">{current.description}</p></div><button onClick={onLogout} className="rounded-xl border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-[10px] text-[#77798B] hover:border-red-500/20 hover:text-red-300">Log out</button></div>
      <div className="overflow-x-auto border-t border-white/[0.04] px-2 py-2 scrollbar-hide"><div className="flex min-w-max gap-1">{TABS.map(item => <button key={item.key} onClick={() => setTab(item.key)} className={`rounded-lg px-3 py-2 text-[10px] font-medium ${tab === item.key ? 'bg-violet-500/15 text-violet-300' : 'text-[#66687B] hover:text-white'}`}>{item.label}</button>)}</div></div>
    </header>

    <main className="mx-auto max-w-7xl px-4 py-5 pb-24 lg:px-8 lg:py-8">
      {tab === 'overview' && <Overview profile={profile} onTab={setTab} onSetup={onGoToSetup} onNavigate={onNavigate} />}
      {tab === 'jobs' && <Jobs profile={profile} />}
      {tab === 'schedule' && <Schedule profile={profile} />}
      {tab === 'wallet' && <WorkerWallet profile={profile} />}
      {tab === 'services' && <Services profile={profile} onSetup={onGoToSetup} />}
      {tab === 'reviews' && <Reviews profile={profile} />}
      {tab === 'verification' && <Verification profile={profile} onNavigate={onNavigate} />}
      {tab === 'account' && <Account profile={profile} onNavigate={onNavigate} />}
    </main>
  </div>;
}

function Overview({ profile, onTab, onSetup, onNavigate }: { profile: Profile; onTab: (tab: WorkerTab) => void; onSetup: () => void; onNavigate?: (page: string) => void }) {
  const [stats, setStats] = useState<Stats>({ views: 0, activeJobs: 0, completedJobs: 0, rating: 0, reviewCount: 0 });
  const [wallet, setWallet] = useState({ available_balance: 0, pending_balance: 0 });
  const [available, setAvailable] = useState(Boolean(profile.available));
  const [savingAvailability, setSavingAvailability] = useState(false);
  const status = STATUS[profile.worker_status || 'pending'] || STATUS.pending;

  useEffect(() => {
    let active = true;
    async function load() {
      const [views, activeJobs, completed, reviews, walletResult] = await Promise.all([
        supabase.from('worker_views').select('*', { count: 'exact', head: true }).eq('worker_id', profile.user_id),
        supabase.from('worker_bookings').select('*', { count: 'exact', head: true }).eq('worker_id', profile.user_id).not('status', 'in', '(approved_released,cancelled,refunded)'),
        supabase.from('worker_bookings').select('*', { count: 'exact', head: true }).eq('worker_id', profile.user_id).eq('status', 'approved_released'),
        supabase.from('reviews').select('rating').eq('reviewee_id', profile.user_id),
        supabase.from('wallets').select('available_balance,pending_balance').eq('owner_id', profile.user_id).eq('owner_type', 'worker').maybeSingle(),
      ]);
      if (!active) return;
      const reviewRows = reviews.data || [];
      setStats({ views: views.count || 0, activeJobs: activeJobs.count || 0, completedJobs: completed.count || 0, reviewCount: reviewRows.length, rating: reviewRows.length ? reviewRows.reduce((sum: number, row: any) => sum + Number(row.rating || 0), 0) / reviewRows.length : 0 });
      setWallet({ available_balance: Number(walletResult.data?.available_balance || 0), pending_balance: Number(walletResult.data?.pending_balance || 0) });
    }
    void load();
    return () => { active = false; };
  }, [profile.user_id]);

  async function toggleAvailability() {
    if (profile.worker_status !== 'verified') return toast.error('Only verified workers can become publicly available');
    setSavingAvailability(true);
    const next = !available;
    const { error } = await setWorkerAvailability(profile.user_id, next);
    setSavingAvailability(false);
    if (error) return toast.error(error.message || 'Unable to update availability');
    setAvailable(next);
    toast.success(next ? 'You are available for bookings' : 'You are unavailable for bookings');
  }

  return <div className="space-y-6">
    <section className="overflow-hidden rounded-3xl border border-blue-500/15 bg-gradient-to-br from-blue-500/[0.12] via-[#14151F] to-[#101018] p-5 lg:p-7"><div className="grid gap-5 lg:grid-cols-[1.4fr_1fr] lg:items-end"><div><span className="rounded-full border border-blue-400/20 bg-blue-400/10 px-3 py-1 text-[10px] font-semibold text-blue-300">WORKER</span><h2 className="mt-4 text-2xl font-bold lg:text-3xl">{profile.full_name || profile.username || 'Your professional dashboard'}</h2><p className="mt-2 max-w-xl text-xs leading-relaxed text-[#9395A8]">Manage real jobs, professional visibility and released earnings without duplicate tools or unrelated controls.</p></div><div className="flex flex-wrap gap-2 lg:justify-end"><button onClick={() => onTab('jobs')} className="rounded-xl bg-blue-500 px-4 py-3 text-xs font-semibold hover:bg-blue-400">Open jobs</button><button onClick={onSetup} className="rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 py-3 text-xs font-semibold text-[#C4C5D0]">Edit service profile</button></div></div></section>
    <section className={`rounded-2xl border p-4 ${status.style}`}><p className="text-xs font-semibold">{status.label}</p><p className="mt-1 text-[10px] opacity-80">{status.text}</p></section>
    <section className="grid grid-cols-2 gap-3 lg:grid-cols-4"><Metric label="Profile views" value={stats.views} /><Metric label="Active jobs" value={stats.activeJobs} /><Metric label="Completed" value={stats.completedJobs} /><Metric label="Rating" value={stats.reviewCount ? `${stats.rating.toFixed(1)} / 5` : 'No reviews'} /></section>
    {profile.worker_status === 'verified' && <section className={`flex items-center justify-between gap-4 rounded-2xl border p-4 ${available ? 'border-emerald-500/20 bg-emerald-500/[0.06]' : 'border-white/[0.06] bg-[#111119]'}`}><div><p className={`text-xs font-semibold ${available ? 'text-emerald-300' : 'text-white'}`}>{available ? 'Available for bookings' : 'Unavailable for bookings'}</p><p className="mt-1 text-[10px] text-[#686A7D]">{available ? 'Your verified profile can appear in public worker discovery.' : 'Your profile is hidden from new booking requests.'}</p></div><button onClick={() => void toggleAvailability()} disabled={savingAvailability} className={`relative h-7 w-12 rounded-full transition ${available ? 'bg-emerald-500' : 'bg-[#282936]'} disabled:opacity-50`}><span className={`absolute top-1 h-5 w-5 rounded-full bg-white transition ${available ? 'left-6' : 'left-1'}`} /></button></section>}
    <section className="grid gap-3 md:grid-cols-2"><Money label="Available earnings" value={wallet.available_balance} onClick={() => onTab('wallet')} /><Money label="Pending earnings" value={wallet.pending_balance} onClick={() => onTab('wallet')} /></section>
    <section className="grid gap-3 md:grid-cols-3"><Action title="Verification" text="View your public verification status" onClick={() => onTab('verification')} /><Action title="Messages" text="Open job and customer conversations" onClick={() => onNavigate?.('messages')} /><Action title="Account" text="Profile, privacy and security" onClick={() => onTab('account')} /></section>
  </div>;
}

function Jobs({ profile }: { profile: Profile }) {
  const [conversations, setConversations] = useState<any[]>([]);
  const [filter, setFilter] = useState('all');
  const [activeChat, setActiveChat] = useState<{ conversationId: string; bookingId: string } | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() { setLoading(true); const { conversations: rows } = await getMyBookingConversations(profile.user_id); setConversations(rows || []); setLoading(false); }
  useEffect(() => { void load(); }, [profile.user_id]);

  if (activeChat) return <BookingNegotiationChat conversationId={activeChat.conversationId} bookingId={activeChat.bookingId} profile={profile} isWorker onClose={() => { setActiveChat(null); void load(); }} />;
  const shown = filter === 'all' ? conversations : conversations.filter(row => row.booking_status === filter);
  const filters = [['all', 'All'], ['booking_requested', 'New'], ['negotiating', 'Negotiating'], ['waiting_payment', 'Awaiting payment'], ['confirmed', 'Confirmed'], ['in_progress', 'In progress'], ['completed_pending_approval', 'Awaiting approval'], ['approved_released', 'Paid']];

  return <div className="space-y-4"><div className="flex gap-1 overflow-x-auto scrollbar-hide">{filters.map(([key, label]) => <button key={key} onClick={() => setFilter(key)} className={`whitespace-nowrap rounded-lg px-3 py-2 text-[10px] font-medium ${filter === key ? 'bg-blue-500/15 text-blue-300' : 'bg-[#111119] text-[#66687B]'}`}>{label}</button>)}</div>{loading ? <Loading /> : shown.length === 0 ? <Empty title="No jobs in this stage" text="New booking requests and active jobs will appear here." /> : <div className="space-y-2">{shown.map(row => { const status = BOOKING_STATUS_LABELS[row.booking_status]; return <button key={row.conversation_id} onClick={() => setActiveChat({ conversationId: row.conversation_id, bookingId: row.booking_id })} className="w-full rounded-2xl border border-white/[0.06] bg-[#111119] p-4 text-left hover:border-blue-500/20"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold">{row.service_type || 'Service booking'}</p><p className="mt-1 text-[10px] text-[#686A7D]">#{row.booking_code} · @{row.other_person_username || row.other_person_name || 'customer'}</p></div>{status && <span className={`rounded-full px-2 py-1 text-[8px] ${status.color}`}>{status.label}</span>}</div>{row.last_message && <p className="mt-3 truncate text-[10px] text-[#85879A]">{row.last_message}</p>}{Number(row.negotiated_amount || 0) > 0 && <p className="mt-3 text-xs font-semibold text-emerald-300">₦{Number(row.negotiated_amount).toLocaleString()}</p>}</button>; })}</div>}</div>;
}

function Schedule({ profile }: { profile: Profile }) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { let active = true; async function load() { const { data } = await supabase.from('worker_bookings').select('id,booking_code,service_type,status,scheduled_date,address').eq('worker_id', profile.user_id).not('scheduled_date', 'is', null).order('scheduled_date', { ascending: true }); if (active) { setRows(data || []); setLoading(false); } } void load(); return () => { active = false; }; }, [profile.user_id]);
  return loading ? <Loading /> : rows.length === 0 ? <Empty title="No scheduled jobs" text="Confirmed bookings with dates will appear here." /> : <div className="space-y-2">{rows.map(row => <section key={row.id} className="rounded-2xl border border-white/[0.06] bg-[#111119] p-4"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-semibold">{row.service_type || 'Service booking'}</p><p className="mt-1 text-[10px] text-[#686A7D]">{new Date(row.scheduled_date).toLocaleString()}</p><p className="mt-1 text-[9px] text-[#55576A]">{row.address || 'Address shared in booking chat'}</p></div><span className="rounded-full bg-blue-500/10 px-2 py-1 text-[8px] capitalize text-blue-300">{row.status?.replace(/_/g, ' ')}</span></div></section>)}</div>;
}

function Services({ profile, onSetup }: { profile: Profile; onSetup: () => void }) {
  const label = profile.worker_occupation ? WORKER_OCCUPATION_LABELS[profile.worker_occupation] || profile.worker_occupation : 'Not set';
  return <div className="space-y-4"><section className="rounded-3xl border border-blue-500/15 bg-gradient-to-br from-blue-500/[0.1] to-[#111119] p-5"><p className="text-[10px] uppercase tracking-wide text-blue-300">Primary service</p><h2 className="mt-2 text-xl font-bold">{label}</h2><p className="mt-2 text-xs leading-relaxed text-[#85879A]">{profile.worker_bio || 'Add a clear professional description so customers understand your experience and service.'}</p></section><section className="grid gap-3 md:grid-cols-2"><Info label="State" value={profile.state || 'Not set'} /><Info label="Local government" value={profile.local_government || profile.city || 'Not set'} /><Info label="Years of experience" value={profile.years_of_experience ?? 'Not set'} /><Info label="Verification status" value={(profile.worker_status || 'pending').replace(/_/g, ' ')} /></section><button onClick={onSetup} className="h-11 w-full rounded-xl bg-blue-500 text-xs font-semibold hover:bg-blue-400">Edit professional service profile</button></div>;
}

function Reviews({ profile }: { profile: Profile }) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { let active = true; async function load() { const { data } = await supabase.from('reviews').select('id,rating,comment,created_at').eq('reviewee_id', profile.user_id).order('created_at', { ascending: false }); if (active) { setRows(data || []); setLoading(false); } } void load(); return () => { active = false; }; }, [profile.user_id]);
  const average = rows.length ? rows.reduce((sum, row) => sum + Number(row.rating || 0), 0) / rows.length : 0;
  return <div className="space-y-4"><section className="rounded-2xl border border-white/[0.06] bg-[#111119] p-5"><p className="text-[10px] text-[#66687B]">Average rating</p><p className="mt-2 text-3xl font-bold">{rows.length ? average.toFixed(1) : '—'} <span className="text-base text-amber-300">★</span></p><p className="mt-1 text-[9px] text-[#55576A]">{rows.length} review{rows.length === 1 ? '' : 's'}</p></section>{loading ? <Loading /> : rows.length === 0 ? <Empty title="No reviews yet" text="Customers can review you after completed jobs." /> : <div className="space-y-2">{rows.map(row => <section key={row.id} className="rounded-2xl border border-white/[0.06] bg-[#111119] p-4"><p className="text-amber-300">{'★'.repeat(Math.max(0, Math.min(5, Number(row.rating || 0))))}</p>{row.comment && <p className="mt-2 text-xs leading-relaxed text-[#9B9CAD]">{row.comment}</p>}<p className="mt-2 text-[9px] text-[#55576A]">{new Date(row.created_at).toLocaleDateString()}</p></section>)}</div>}</div>;
}

function Verification({ profile, onNavigate }: { profile: Profile; onNavigate?: (page: string) => void }) {
  const status = STATUS[profile.worker_status || 'pending'] || STATUS.pending;
  return <div className="space-y-4"><section className={`rounded-3xl border p-5 ${status.style}`}><p className="text-sm font-semibold">{status.label}</p><p className="mt-2 text-[11px] leading-relaxed opacity-80">{status.text}</p></section><section className="rounded-2xl border border-white/[0.06] bg-[#111119] p-5"><h2 className="text-sm font-semibold">Professional verification</h2><p className="mt-2 text-[11px] leading-relaxed text-[#77798B]">Verification evidence, skill video and review details are kept in the dedicated verification workflow instead of being duplicated inside the dashboard.</p><button onClick={() => onNavigate?.('worker_verification')} disabled={profile.worker_status === 'pending'} className="mt-5 h-11 w-full rounded-xl bg-blue-500 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-40">{profile.worker_status === 'pending' ? 'Awaiting verification access' : 'Open verification workflow'}</button></section></div>;
}

function Account({ profile, onNavigate }: { profile: Profile; onNavigate?: (page: string) => void }) {
  const items = [['Account center', 'Profile identity and personal details', 'account'], ['Edit profile', 'Name, photo, phone and personal location', 'profile_edit'], ['Privacy', 'Profile and contact visibility', 'privacy'], ['Security', 'Password, sessions and account protection', 'security']];
  return <div className="space-y-4"><section className="flex items-center gap-4 rounded-2xl border border-white/[0.06] bg-[#111119] p-5"><div className="grid h-16 w-16 place-items-center overflow-hidden rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 text-xl font-bold">{profile.avatar_url ? <img src={profile.avatar_url} alt="" className="h-full w-full object-cover" /> : (profile.full_name || profile.username || 'W')[0].toUpperCase()}</div><div><h2 className="text-lg font-bold">{profile.full_name || profile.username || 'Worker'}</h2><p className="text-xs text-[#6E7083]">@{profile.username || 'worker'}</p></div></section><section className="divide-y divide-white/[0.05] overflow-hidden rounded-2xl border border-white/[0.06] bg-[#111119]">{items.map(([title, text, page]) => <button key={title} onClick={() => onNavigate?.(page)} className="flex w-full items-center justify-between gap-4 p-4 text-left hover:bg-white/[0.025]"><div><p className="text-sm font-medium">{title}</p><p className="mt-1 text-[10px] text-[#66687B]">{text}</p></div><span className="text-[#55576A]">›</span></button>)}</section></div>;
}

function Metric({ label, value }: { label: string; value: string | number }) { return <div className="rounded-2xl border border-white/[0.06] bg-[#111119] p-4"><p className="text-[9px] text-[#66687B]">{label}</p><p className="mt-2 text-xl font-bold">{value}</p></div>; }
function Money({ label, value, onClick }: { label: string; value: number; onClick: () => void }) { return <button onClick={onClick} className="rounded-2xl border border-emerald-500/15 bg-emerald-500/[0.05] p-4 text-left hover:border-emerald-500/30"><p className="text-[9px] text-emerald-300/70">{label}</p><p className="mt-2 text-xl font-bold">₦{Number(value || 0).toLocaleString('en-NG', { minimumFractionDigits: 2 })}</p></button>; }
function Action({ title, text, onClick }: { title: string; text: string; onClick: () => void }) { return <button onClick={onClick} className="rounded-2xl border border-white/[0.06] bg-[#111119] p-4 text-left hover:border-blue-500/20"><p className="text-xs font-semibold">{title}</p><p className="mt-1 text-[10px] text-[#66687B]">{text}</p></button>; }
function Info({ label, value }: { label: string; value: string | number }) { return <div className="rounded-2xl border border-white/[0.06] bg-[#111119] p-4"><p className="text-[9px] uppercase tracking-wide text-[#606274]">{label}</p><p className="mt-2 text-xs font-medium capitalize">{String(value)}</p></div>; }
function Empty({ title, text }: { title: string; text: string }) { return <div className="rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.015] px-5 py-12 text-center"><p className="text-sm font-semibold">{title}</p><p className="mx-auto mt-2 max-w-md text-[10px] leading-relaxed text-[#626477]">{text}</p></div>; }
function Loading() { return <div className="grid min-h-40 place-items-center"><div className="h-7 w-7 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" /></div>; }
