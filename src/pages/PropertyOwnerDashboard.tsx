import { useEffect, useMemo, useState } from 'react';
import { Toaster, toast } from 'sonner';
import { supabase, createPartnerSupportConversation, getPartnerConversations } from '@/lib/supabase';
import PropertyInspectionRequestPanel from '@/components/PropertyInspectionRequestPanel';
import PropertyPartnerFinancePanel from '@/components/PropertyPartnerFinancePanel';
import PartnerSupportChat from '@/components/PartnerSupportChat';
import type { Profile } from '@/types';

type PartnerTab = 'overview' | 'properties' | 'wallet' | 'earnings' | 'messages' | 'support' | 'profile' | 'settings';

type Props = {
  profile: Profile;
  onLogout: () => void;
  onNavigate: (page: string) => void;
  onGoToChat?: (convId?: string) => void;
};

type FinanceSnapshot = {
  available_balance: number;
  pending_balance: number;
  frozen_balance: number;
  total_withdrawn: number;
  total_earnings: number;
};

type OverviewData = {
  properties: number;
  availableProperties: number;
  pendingRequests: number;
  inspectionsInProgress: number;
  availableBalance: number;
  pendingBalance: number;
  totalEarnings: number;
};

type EarningRelease = {
  id: string;
  payment_id: string;
  earning_type: string;
  status: 'pending' | 'available' | 'held' | 'reversed';
  net_amount: number;
  release_event: string | null;
  created_at: string;
  released_at: string | null;
};

const NAV_ITEMS: Array<{ key: PartnerTab; label: string; description: string; icon: string }> = [
  { key: 'overview', label: 'Overview', description: 'Your properties, requests and balances', icon: 'M3 12l9-9 9 9M5 10v10h14V10M9 20v-6h6v6' },
  { key: 'properties', label: 'My Properties', description: 'Submit properties and view WeHouse listings', icon: 'M4 21V10l8-7 8 7v11M9 21v-6h6v6M7 10h10' },
  { key: 'wallet', label: 'Wallet', description: 'Available, pending and withdrawal activity', icon: 'M3 7h16a2 2 0 012 2v10H5a2 2 0 01-2-2V7zm0 0a2 2 0 012-2h12M16 13h5' },
  { key: 'earnings', label: 'Earnings', description: 'Property income after WeHouse commission', icon: 'M12 2v20M17 6.5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H7' },
  { key: 'messages', label: 'Messages', description: 'Communication with WeHouse only', icon: 'M21 15a4 4 0 01-4 4H8l-5 3V7a4 4 0 014-4h10a4 4 0 014 4v8zM8 10h8M8 14h5' },
  { key: 'support', label: 'Support', description: 'Ask WeHouse for help', icon: 'M12 22a10 10 0 100-20 10 10 0 000 20zM9.1 9a3 3 0 115.8 1c0 2-3 2-3 4M12 18h.01' },
  { key: 'profile', label: 'Profile', description: 'Your partner identity and location', icon: 'M20 21a8 8 0 00-16 0M12 13a5 5 0 100-10 5 5 0 000 10z' },
  { key: 'settings', label: 'Settings', description: 'Profile, privacy and account security', icon: 'M12 15.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM19.4 15a1.7 1.7 0 00.34 1.88l.06.06-2 3.46-.08-.02a1.7 1.7 0 00-1.8.3l-.1.08a1.7 1.7 0 00-.56 1.73V22h-4v-.11a1.7 1.7 0 00-.57-1.73l-.1-.08a1.7 1.7 0 00-1.8-.3l-.08.02-2-3.46.06-.06A1.7 1.7 0 007 14.4v-.13a1.7 1.7 0 00-1.23-1.58L5.7 12.66v-4l.08-.03A1.7 1.7 0 007 7.05v-.13a1.7 1.7 0 00-.34-1.88l-.06-.06 2-3.46.08.02a1.7 1.7 0 001.8-.3l.1-.08A1.7 1.7 0 0011.15 0H15v.11a1.7 1.7 0 00.57 1.73l.1.08a1.7 1.7 0 001.8.3l.08-.02 2 3.46-.06.06a1.7 1.7 0 00-.34 1.88v.13a1.7 1.7 0 001.23 1.58l.08.03v4l-.08.03A1.7 1.7 0 0019.15 15z' },
];

const money = (value: number) => `₦${Number(value || 0).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;

export default function PropertyOwnerDashboard({ profile, onLogout, onNavigate }: Props) {
  const [activeTab, setActiveTab] = useState<PartnerTab>('overview');
  const [isDesktop, setIsDesktop] = useState(false);
  const currentItem = useMemo(() => NAV_ITEMS.find(item => item.key === activeTab)!, [activeTab]);
  const initials = (profile.full_name || profile.username || profile.email || 'P')[0].toUpperCase();

  useEffect(() => {
    const update = () => setIsDesktop(window.innerWidth >= 1024);
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  return (
    <div className="min-h-[100dvh] bg-[#09090D] text-white lg:flex">
      <Toaster position="top-center" richColors />

      {isDesktop && (
        <aside className="fixed inset-y-0 left-0 z-40 w-[248px] border-r border-white/[0.06] bg-[#0D0D13]/95 backdrop-blur-xl">
          <div className="flex h-full flex-col">
            <div className="flex h-16 items-center gap-3 border-b border-white/[0.06] px-5">
              <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 shadow-lg shadow-violet-950/30">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2"><path d="M3 11l9-8 9 8v9a2 2 0 01-2 2H5a2 2 0 01-2-2v-9z" /><path d="M9 22v-7h6v7" /></svg>
              </div>
              <div><p className="text-sm font-bold">WeHouse</p><p className="text-[10px] text-[#73758A]">Property Partner</p></div>
            </div>

            <nav className="flex-1 space-y-1 overflow-y-auto p-3">
              {NAV_ITEMS.map(item => {
                const selected = activeTab === item.key;
                return (
                  <button key={item.key} onClick={() => setActiveTab(item.key)} className={`group flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition ${selected ? 'border border-violet-500/20 bg-violet-500/10 text-white' : 'border border-transparent text-[#85879A] hover:bg-white/[0.035] hover:text-white'}`}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={selected ? '#A78BFA' : 'currentColor'} strokeWidth="1.8"><path d={item.icon} /></svg>
                    <div className="min-w-0"><p className="text-[13px] font-medium">{item.label}</p><p className="truncate text-[9px] text-[#5D5F72]">{item.description}</p></div>
                  </button>
                );
              })}
            </nav>

            <div className="border-t border-white/[0.06] p-4">
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center overflow-hidden rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 text-sm font-bold">
                  {profile.avatar_url ? <img src={profile.avatar_url} alt="" className="h-full w-full object-cover" /> : initials}
                </div>
                <div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold">{profile.full_name || profile.username || 'Partner'}</p><p className="truncate text-[9px] text-[#66687B]">@{profile.username || 'partner'}</p></div>
                <button onClick={onLogout} title="Log out" className="rounded-lg p-2 text-[#66687B] hover:bg-red-500/10 hover:text-red-400"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 17l5-5-5-5M15 12H3M21 3v18h-6" /></svg></button>
              </div>
            </div>
          </div>
        </aside>
      )}

      <div className={`min-h-[100dvh] flex-1 ${isDesktop ? 'ml-[248px]' : ''}`}>
        <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-[#09090D]/90 backdrop-blur-xl">
          <div className="flex h-16 items-center justify-between px-4 lg:px-8">
            <div><h1 className="text-base font-bold lg:text-lg">{currentItem.label}</h1><p className="text-[10px] text-[#686A7D] lg:text-[11px]">{currentItem.description}</p></div>
            {!isDesktop && <button onClick={onLogout} className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-2 text-[#85879A]"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 17l5-5-5-5M15 12H3M21 3v18h-6" /></svg></button>}
          </div>
          {!isDesktop && (
            <div className="overflow-x-auto border-t border-white/[0.04] px-2 py-2 scrollbar-hide">
              <div className="flex min-w-max gap-1">{NAV_ITEMS.map(item => <button key={item.key} onClick={() => setActiveTab(item.key)} className={`rounded-lg px-3 py-2 text-[10px] font-medium ${activeTab === item.key ? 'bg-violet-500/15 text-violet-300' : 'text-[#66687B]'}`}>{item.label}</button>)}</div>
            </div>
          )}
        </header>

        <main className="mx-auto max-w-7xl px-4 py-5 pb-24 lg:px-8 lg:py-8">
          {activeTab === 'overview' && <OverviewTab profile={profile} setActiveTab={setActiveTab} />}
          {activeTab === 'properties' && <PropertiesTab profile={profile} />}
          {activeTab === 'wallet' && <PropertyPartnerFinancePanel profile={profile} />}
          {activeTab === 'earnings' && <EarningsTab profile={profile} />}
          {activeTab === 'messages' && <MessagesTab profile={profile} />}
          {activeTab === 'support' && <SupportTab profile={profile} />}
          {activeTab === 'profile' && <ProfileTab profile={profile} />}
          {activeTab === 'settings' && <SettingsTab onNavigate={onNavigate} onLogout={onLogout} />}
        </main>
      </div>
    </div>
  );
}

function OverviewTab({ profile, setActiveTab }: { profile: Profile; setActiveTab: (tab: PartnerTab) => void }) {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      const [listingsResult, requestsResult, financeResult] = await Promise.all([
        supabase.from('listings').select('id,status,availability_status').or(`owner_id.eq.${profile.user_id},partner_id.eq.${profile.user_id}`),
        supabase.from('inspection_requests').select('id,status').eq('owner_id', profile.user_id),
        supabase.rpc('get_my_property_partner_finance'),
      ]);
      if (!active) return;
      const listings = listingsResult.data || [];
      const requests = requestsResult.data || [];
      const finance = (financeResult.data || {}) as FinanceSnapshot;
      setData({
        properties: listings.length,
        availableProperties: listings.filter((row: any) => row.availability_status === 'available' || row.status === 'approved').length,
        pendingRequests: requests.filter((row: any) => ['pending', 'scheduled'].includes(row.status)).length,
        inspectionsInProgress: requests.filter((row: any) => row.status === 'in_progress').length,
        availableBalance: Number(finance.available_balance || 0),
        pendingBalance: Number(finance.pending_balance || 0),
        totalEarnings: Number(finance.total_earnings || 0),
      });
      setLoading(false);
    }
    void load();
    return () => { active = false; };
  }, [profile.user_id]);

  if (loading || !data) return <Loading />;
  const cards = [
    ['Properties', data.properties, 'Published by WeHouse'],
    ['Available', data.availableProperties, 'Currently active'],
    ['Pending requests', data.pendingRequests, 'Awaiting WeHouse action'],
    ['Inspections', data.inspectionsInProgress, 'Currently in progress'],
  ];

  return <div className="space-y-6">
    <section className="overflow-hidden rounded-3xl border border-violet-500/15 bg-gradient-to-br from-violet-500/[0.12] via-[#151520] to-[#111119] p-5 lg:p-7">
      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr] lg:items-end">
        <div><span className="rounded-full border border-violet-400/20 bg-violet-400/10 px-3 py-1 text-[10px] font-semibold text-violet-300">PROPERTY PARTNER</span><h2 className="mt-4 max-w-2xl text-2xl font-bold leading-tight lg:text-3xl">Manage your relationship with WeHouse from one clear dashboard.</h2><p className="mt-2 max-w-xl text-xs leading-relaxed text-[#999BAD]">Submit properties for inspection, follow WeHouse listing progress, and track only verified property earnings.</p></div>
        <div className="flex gap-2 lg:justify-end"><button onClick={() => setActiveTab('properties')} className="rounded-xl bg-violet-500 px-4 py-3 text-xs font-semibold hover:bg-violet-400">Submit property</button><button onClick={() => setActiveTab('wallet')} className="rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 py-3 text-xs font-semibold text-[#C4C5D0] hover:bg-white/[0.07]">Open wallet</button></div>
      </div>
    </section>
    <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">{cards.map(([label, value, note]) => <MetricCard key={String(label)} label={String(label)} value={String(value)} note={String(note)} />)}</section>
    <section className="grid gap-3 lg:grid-cols-3"><MoneyCard label="Available to withdraw" value={data.availableBalance} tone="emerald" /><MoneyCard label="Pending release" value={data.pendingBalance} tone="amber" /><MoneyCard label="Total released earnings" value={data.totalEarnings} tone="violet" /></section>
    <section className="rounded-2xl border border-white/[0.06] bg-[#111119] p-4"><p className="text-xs font-semibold">How earnings work</p><p className="mt-2 text-[11px] leading-relaxed text-[#77798B]">Verified eligible rent or hotel payments enter pending balance after WeHouse commission. They become available only after the required move-in, check-in, installment or stay-completion event.</p></section>
  </div>;
}

function PropertiesTab({ profile }: { profile: Profile }) {
  const [properties, setProperties] = useState<any[]>([]);
  const [selected, setSelected] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    async function load() {
      const { data, error } = await supabase.from('listings').select('*').or(`owner_id.eq.${profile.user_id},partner_id.eq.${profile.user_id}`).order('created_at', { ascending: false });
      if (!active) return;
      if (error) toast.error('Unable to load your properties');
      setProperties(data || []);
      setLoading(false);
    }
    void load();
    return () => { active = false; };
  }, [profile.user_id]);

  if (selected) return <PropertyDetails property={selected} onBack={() => setSelected(null)} />;

  return <div className="space-y-6">
    <PropertyInspectionRequestPanel profile={profile} />
    <section>
      <div className="mb-3 flex items-center justify-between"><div><h2 className="text-sm font-semibold">Properties published by WeHouse</h2><p className="text-[10px] text-[#66687B]">Read-only property records connected to your account.</p></div><span className="rounded-full bg-white/[0.04] px-3 py-1 text-[10px] text-[#888A9B]">{properties.length}</span></div>
      {loading ? <Loading /> : properties.length === 0 ? <Empty title="No published properties yet" text="Submit a property request above. After WeHouse inspects and publishes it, it will appear here." /> : <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{properties.map(property => <button key={property.id} onClick={() => setSelected(property)} className="overflow-hidden rounded-2xl border border-white/[0.06] bg-[#111119] text-left transition hover:-translate-y-0.5 hover:border-violet-500/25">
        <div className="h-40 bg-[#171722]">{property.images?.[0] ? <img src={property.images[0]} alt="" className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center text-[#46485A]"><svg width="35" height="35" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3"><path d="M4 21V10l8-7 8 7v11M9 21v-6h6v6" /></svg></div>}</div>
        <div className="p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-semibold">{property.title || 'Property'}</p><p className="mt-1 truncate text-[10px] text-[#66687B]">{[property.city, property.state].filter(Boolean).join(', ')}</p></div><Status value={property.availability_status || property.status || 'pending'} /></div><p className="mt-3 text-xs font-bold">{money(Number(property.price || 0))}</p></div>
      </button>)}</div>}
    </section>
  </div>;
}

function PropertyDetails({ property, onBack }: { property: any; onBack: () => void }) {
  return <div className="space-y-5"><button onClick={onBack} className="flex items-center gap-2 text-xs text-[#888A9B] hover:text-white"><span>←</span> Back to properties</button><section className="overflow-hidden rounded-3xl border border-white/[0.06] bg-[#111119]">{property.images?.[0] && <img src={property.images[0]} alt="" className="h-56 w-full object-cover lg:h-72" />}<div className="p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-bold">{property.title || 'Property'}</h2><p className="mt-1 text-xs text-[#747689]">{[property.address, property.city, property.state].filter(Boolean).join(', ')}</p></div><Status value={property.availability_status || property.status || 'pending'} /></div><div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4"><Info label="Group" value={property.property_type || 'Apartment'} /><Info label="Type" value={property.sub_type || 'Not specified'} /><Info label="Bedrooms" value={property.bedrooms ?? '—'} /><Info label="Bathrooms" value={property.bathrooms ?? '—'} /></div><div className="mt-4 rounded-xl border border-white/[0.05] bg-white/[0.025] p-4"><p className="text-[10px] font-semibold uppercase tracking-wide text-[#73758A]">Listing management</p><p className="mt-1 text-xs leading-relaxed text-[#A1A2B0]">WeHouse creates and manages this public listing. Contact WeHouse through Messages or Support to request a correction.</p></div></div></section></div>;
}

function EarningsTab({ profile }: { profile: Profile }) {
  const [rows, setRows] = useState<EarningRelease[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { let active = true; async function load() { const { data, error } = await supabase.from('property_partner_earning_releases').select('id,payment_id,earning_type,status,net_amount,release_event,created_at,released_at').eq('partner_id', profile.user_id).order('created_at', { ascending: false }); if (!active) return; if (error) toast.error('Unable to load earnings'); setRows((data || []) as EarningRelease[]); setLoading(false); } void load(); return () => { active = false; }; }, [profile.user_id]);
  const totals = rows.reduce((acc, row) => { acc[row.status] += Number(row.net_amount || 0); return acc; }, { pending: 0, available: 0, held: 0, reversed: 0 });
  return <div className="space-y-6"><section className="grid grid-cols-2 gap-3 lg:grid-cols-4"><MoneyCard label="Released" value={totals.available} tone="emerald" /><MoneyCard label="Pending" value={totals.pending} tone="amber" /><MoneyCard label="Held" value={totals.held} tone="red" /><MoneyCard label="Reversed" value={totals.reversed} tone="slate" /></section><section className="rounded-2xl border border-white/[0.06] bg-[#111119] p-4"><h2 className="text-sm font-semibold">Earning history</h2><p className="mt-1 text-[10px] text-[#66687B]">Net property income after the applicable Apartment or Hotel Commission.</p>{loading ? <Loading /> : rows.length === 0 ? <Empty title="No property earnings yet" text="Eligible verified payments will appear here after WeHouse records them." /> : <div className="mt-4 divide-y divide-white/[0.05]">{rows.map(row => <div key={row.id} className="flex items-center justify-between gap-4 py-3"><div><p className="text-xs font-medium capitalize">{row.earning_type.replace(/_/g, ' ')}</p><p className="mt-1 text-[9px] text-[#626477]">{new Date(row.created_at).toLocaleDateString()} {row.release_event ? `· ${row.release_event.replace(/_/g, ' ')}` : ''}</p></div><div className="text-right"><p className="text-xs font-semibold">{money(row.net_amount)}</p><Status value={row.status} /></div></div>)}</div>}</section></div>;
}

function MessagesTab({ profile }: { profile: Profile }) {
  const [conversations, setConversations] = useState<any[]>([]);
  const [activeConversation, setActiveConversation] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  async function load() { setLoading(true); const result = await getPartnerConversations(profile.user_id); setConversations(result.conversations || []); setLoading(false); }
  useEffect(() => { void load(); }, [profile.user_id]);
  if (activeConversation) return <PartnerSupportChat conversationId={activeConversation} profile={profile} senderRole="partner" onClose={() => { setActiveConversation(null); void load(); }} />;
  return <section className="rounded-2xl border border-white/[0.06] bg-[#111119] p-4"><div className="mb-4"><h2 className="text-sm font-semibold">WeHouse conversations</h2><p className="mt-1 text-[10px] text-[#66687B]">Property Partners communicate with WeHouse, not customers.</p></div>{loading ? <Loading /> : conversations.length === 0 ? <Empty title="No messages yet" text="Replies from WeHouse about inspections, listings, payments or support will appear here." /> : <div className="space-y-2">{conversations.map(conversation => <button key={conversation.id} onClick={() => setActiveConversation(conversation.id)} className="w-full rounded-xl border border-white/[0.05] bg-white/[0.025] p-4 text-left hover:border-violet-500/20"><div className="flex items-center justify-between gap-3"><p className="truncate text-xs font-semibold">{conversation.subject || 'WeHouse conversation'}</p>{conversation.unread_count > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-violet-500 px-1 text-[9px] font-bold">{conversation.unread_count}</span>}</div><p className="mt-1 truncate text-[10px] text-[#66687B]">{conversation.last_message || 'Open conversation'}</p></button>)}</div>}</section>;
}

function SupportTab({ profile }: { profile: Profile }) {
  const [subject, setSubject] = useState('General support');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  async function submit() { if (!message.trim()) return toast.error('Enter your message'); setSending(true); const result = await createPartnerSupportConversation(profile.user_id, subject, message.trim()); setSending(false); if (result.error) return toast.error(result.error.message || 'Unable to contact WeHouse'); setMessage(''); toast.success('Message sent to WeHouse'); }
  return <div className="grid gap-4 lg:grid-cols-[1.2fr_.8fr]"><section className="rounded-2xl border border-white/[0.06] bg-[#111119] p-5"><h2 className="text-sm font-semibold">Contact WeHouse</h2><p className="mt-1 text-[10px] text-[#66687B]">Use this for listing corrections, inspections, payments, withdrawals or account help.</p><div className="mt-5 space-y-3"><select value={subject} onChange={event => setSubject(event.target.value)} className="h-11 w-full rounded-xl border border-white/[0.08] bg-[#181822] px-3 text-xs outline-none focus:border-violet-500"><option>General support</option><option>Property inspection</option><option>Listing correction</option><option>Payment or earnings</option><option>Withdrawal</option><option>Account issue</option></select><textarea value={message} onChange={event => setMessage(event.target.value)} rows={6} placeholder="Describe what you need help with" className="w-full resize-none rounded-xl border border-white/[0.08] bg-[#181822] p-3 text-xs outline-none focus:border-violet-500" /><button onClick={() => void submit()} disabled={sending} className="h-11 w-full rounded-xl bg-violet-500 text-xs font-semibold disabled:opacity-50">{sending ? 'Sending…' : 'Send to WeHouse'}</button></div></section><section className="rounded-2xl border border-white/[0.06] bg-[#111119] p-5"><h2 className="text-sm font-semibold">Important</h2><div className="mt-4 space-y-3 text-[11px] leading-relaxed text-[#85879A]"><p>• Property requests are submitted from My Properties.</p><p>• WeHouse creates and publishes listings after review.</p><p>• Property Partners do not edit public listings or communicate with customers directly.</p><p>• Reservation fees belong to WeHouse and are not partner earnings.</p></div></section></div>;
}

function ProfileTab({ profile }: { profile: Profile }) {
  const fields = [['Full name', profile.full_name || 'Not set'], ['Username', profile.username ? `@${profile.username}` : 'Not set'], ['Email', profile.email], ['Phone', profile.phone || 'Not set'], ['State', profile.state || 'Not set'], ['Local government', profile.local_government || profile.city || 'Not set'], ['Partner ID', profile.user_id], ['Member since', new Date(profile.created_at).toLocaleDateString()]];
  return <div className="space-y-4"><section className="flex items-center gap-4 rounded-2xl border border-white/[0.06] bg-[#111119] p-5"><div className="grid h-16 w-16 place-items-center overflow-hidden rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 text-xl font-bold">{profile.avatar_url ? <img src={profile.avatar_url} alt="" className="h-full w-full object-cover" /> : (profile.full_name || profile.username || 'P')[0].toUpperCase()}</div><div><h2 className="text-lg font-bold">{profile.full_name || profile.username || 'Property Partner'}</h2><p className="text-xs text-[#6E7083]">Property Partner</p></div></section><section className="grid gap-3 md:grid-cols-2">{fields.map(([label, value]) => <Info key={label} label={label} value={value} />)}</section></div>;
}

function SettingsTab({ onNavigate, onLogout }: { onNavigate: (page: string) => void; onLogout: () => void }) {
  const items = [['Edit profile', 'Update your name, photo, phone and personal location', 'profile_edit'], ['Privacy', 'Control profile and contact visibility', 'privacy'], ['Security', 'Password, sessions and account protection', 'security'], ['Account center', 'Review your complete account information', 'account']];
  return <div className="space-y-4"><section className="overflow-hidden rounded-2xl border border-white/[0.06] bg-[#111119] divide-y divide-white/[0.05]">{items.map(([title, description, page]) => <button key={title} onClick={() => onNavigate(page)} className="flex w-full items-center justify-between gap-4 p-4 text-left hover:bg-white/[0.025]"><div><p className="text-sm font-medium">{title}</p><p className="mt-1 text-[10px] text-[#66687B]">{description}</p></div><span className="text-[#55576A]">›</span></button>)}</section><button onClick={onLogout} className="h-11 w-full rounded-xl border border-red-500/20 bg-red-500/[0.07] text-xs font-semibold text-red-400 hover:bg-red-500/[0.12]">Log out</button></div>;
}

function MetricCard({ label, value, note }: { label: string; value: string; note: string }) { return <div className="rounded-2xl border border-white/[0.06] bg-[#111119] p-4"><p className="text-[10px] text-[#696B7D]">{label}</p><p className="mt-2 text-2xl font-bold">{value}</p><p className="mt-1 text-[9px] text-[#55576A]">{note}</p></div>; }
function MoneyCard({ label, value, tone }: { label: string; value: number; tone: 'emerald' | 'amber' | 'violet' | 'red' | 'slate' }) { const tones = { emerald: 'border-emerald-500/15 bg-emerald-500/[0.06] text-emerald-300', amber: 'border-amber-500/15 bg-amber-500/[0.06] text-amber-300', violet: 'border-violet-500/15 bg-violet-500/[0.06] text-violet-300', red: 'border-red-500/15 bg-red-500/[0.06] text-red-300', slate: 'border-white/[0.07] bg-white/[0.03] text-[#B0B1BE]' }; return <div className={`rounded-2xl border p-4 ${tones[tone]}`}><p className="text-[10px] opacity-75">{label}</p><p className="mt-2 text-lg font-bold text-white">{money(value)}</p></div>; }
function Info({ label, value }: { label: string; value: string | number }) { return <div className="rounded-xl border border-white/[0.06] bg-[#111119] p-4"><p className="text-[9px] uppercase tracking-wide text-[#616375]">{label}</p><p className="mt-1 break-words text-xs font-medium text-[#D3D4DC]">{value}</p></div>; }
function Status({ value }: { value: string }) { const normalized = value.toLowerCase(); const style = normalized === 'available' || normalized === 'approved' || normalized === 'completed' ? 'bg-emerald-500/10 text-emerald-300' : normalized === 'rejected' || normalized === 'reversed' ? 'bg-red-500/10 text-red-300' : normalized === 'held' ? 'bg-orange-500/10 text-orange-300' : 'bg-amber-500/10 text-amber-300'; return <span className={`inline-flex rounded-full px-2 py-1 text-[8px] font-semibold capitalize ${style}`}>{value.replace(/_/g, ' ')}</span>; }
function Empty({ title, text }: { title: string; text: string }) { return <div className="rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.015] px-5 py-12 text-center"><p className="text-sm font-semibold">{title}</p><p className="mx-auto mt-2 max-w-md text-[10px] leading-relaxed text-[#626477]">{text}</p></div>; }
function Loading() { return <div className="grid min-h-32 place-items-center"><div className="h-7 w-7 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" /></div>; }
