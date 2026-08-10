import { useEffect, useMemo, useState } from 'react';
import { Toaster, toast } from 'sonner';
import { supabase, createPartnerSupportConversation, getPartnerConversations, sendPartnerSupportMessage } from '@/lib/supabase';
import PropertyInspectionRequestPanel from '@/components/PropertyInspectionRequestPanel';
import PropertyPartnerFinancePanel from '@/components/PropertyPartnerFinancePanel';
import PartnerSupportChat from '@/components/PartnerSupportChat';
import type { Profile } from '@/types';

type PartnerTab = 'overview' | 'requests' | 'properties' | 'finance' | 'messages' | 'support';
type FinanceView = 'wallet' | 'earnings';
type Props = { profile: Profile; onLogout: () => void; onNavigate: (page: string) => void; onGoToChat?: (convId?: string) => void };
type Overview = { properties: number; available: number; pendingRequests: number; inspections: number; availableBalance: number; pendingBalance: number; totalEarnings: number };
type EarningRelease = { id: string; earning_type: string; status: 'pending' | 'available' | 'held' | 'reversed'; net_amount: number; release_event: string | null; created_at: string };

const TABS: Array<{ key: PartnerTab; label: string; description: string }> = [
  { key: 'overview', label: 'Overview', description: 'Your property partnership at a glance' },
  { key: 'requests', label: 'Property Requests', description: 'Submit properties and follow inspection progress' },
  { key: 'properties', label: 'My Properties', description: 'Published apartments and hotels managed by WeHouse' },
  { key: 'finance', label: 'Finance', description: 'Earnings, balances, transactions and withdrawals' },
  { key: 'messages', label: 'Messages', description: 'Property communication with WeHouse' },
  { key: 'support', label: 'Support', description: 'Get help from WeHouse' },
];

const money = (value: number) => `₦${Number(value || 0).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;

export default function PropertyOwnerDashboard({ profile, onLogout, onNavigate }: Props) {
  const [tab, setTab] = useState<PartnerTab>('overview');
  const current = useMemo(() => TABS.find(item => item.key === tab)!, [tab]);
  return <div className="min-h-[100dvh] bg-[#09090D] text-white">
    <Toaster position="top-center" richColors />
    <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-[#09090D]/94 backdrop-blur-xl">
      <div className="mx-auto max-w-7xl px-4 pt-4 lg:px-8 lg:pt-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0"><p className="text-[9px] font-bold tracking-[.22em] text-violet-400">PROPERTY PARTNER</p><h1 className="mt-1 text-lg font-bold lg:text-xl">{current.label}</h1><p className="mt-1 text-[10px] text-[#686A7D] lg:text-[11px]">{current.description}</p></div>
          <div className="flex shrink-0 gap-2"><button onClick={() => onNavigate('profile')} className="rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-[10px] text-[#A5A6B5]">Account</button><button onClick={onLogout} className="rounded-xl border border-red-500/15 bg-red-500/[0.05] px-3 py-2 text-[10px] text-red-300">Log out</button></div>
        </div>
        <div className="mt-4 overflow-x-auto pb-3 scrollbar-hide"><div className="flex min-w-max gap-1">{TABS.map(item => <button key={item.key} onClick={() => setTab(item.key)} className={`rounded-xl px-3 py-2 text-[10px] font-semibold transition ${tab === item.key ? 'bg-violet-500 text-white' : 'text-[#6F7184] hover:bg-white/[0.04] hover:text-white'}`}>{item.label}</button>)}</div></div>
      </div>
    </header>
    <main className="mx-auto max-w-7xl px-4 py-5 pb-24 lg:px-8 lg:py-8">
      {tab === 'overview' && <OverviewTab profile={profile} onTab={setTab} />}
      {tab === 'requests' && <RequestsTab profile={profile} />}
      {tab === 'properties' && <PropertiesTab profile={profile} />}
      {tab === 'finance' && <FinanceTab profile={profile} />}
      {tab === 'messages' && <MessagesTab profile={profile} />}
      {tab === 'support' && <SupportTab profile={profile} />}
    </main>
  </div>;
}

function OverviewTab({ profile, onTab }: { profile: Profile; onTab: (tab: PartnerTab) => void }) {
  const [data, setData] = useState<Overview | null>(null);
  useEffect(() => { let active = true; (async () => {
    const [listingsResult, requestsResult, financeResult] = await Promise.all([
      supabase.from('listings').select('id,status,availability_status').or(`owner_id.eq.${profile.user_id},partner_id.eq.${profile.user_id}`),
      supabase.from('inspection_requests').select('id,status').eq('owner_id', profile.user_id),
      supabase.rpc('get_my_property_partner_finance'),
    ]);
    if (!active) return;
    const listings = listingsResult.data || []; const requests = requestsResult.data || []; const finance = (financeResult.data || {}) as any;
    setData({ properties: listings.length, available: listings.filter((row: any) => row.availability_status === 'available' || row.status === 'approved').length, pendingRequests: requests.filter((row: any) => ['pending','scheduled'].includes(row.status)).length, inspections: requests.filter((row: any) => row.status === 'in_progress').length, availableBalance: Number(finance.available_balance || 0), pendingBalance: Number(finance.pending_balance || 0), totalEarnings: Number(finance.total_earnings || 0) });
  })(); return () => { active = false; }; }, [profile.user_id]);
  if (!data) return <Loading />;
  return <div className="space-y-6">
    <section className="overflow-hidden rounded-3xl border border-violet-500/15 bg-gradient-to-br from-violet-500/[0.13] via-[#151520] to-[#101018] p-5 lg:p-7"><div className="grid gap-6 lg:grid-cols-[1.4fr_1fr] lg:items-end"><div><span className="rounded-full border border-violet-400/20 bg-violet-400/10 px-3 py-1 text-[10px] font-semibold text-violet-300">YOUR PARTNERSHIP</span><h2 className="mt-4 max-w-2xl text-2xl font-bold leading-tight lg:text-3xl">Submit properties. WeHouse handles inspection and public listing.</h2><p className="mt-2 max-w-xl text-xs leading-relaxed text-[#9395A8]">Track each property request, view listings WeHouse has published for you, then follow verified earnings and withdrawals.</p></div><div className="flex flex-wrap gap-2 lg:justify-end"><button onClick={() => onTab('requests')} className="rounded-xl bg-violet-500 px-4 py-3 text-xs font-semibold hover:bg-violet-400">Submit property</button><button onClick={() => onTab('finance')} className="rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 py-3 text-xs font-semibold text-[#C4C5D0]">Open finance</button></div></div></section>
    <section className="grid grid-cols-2 gap-3 lg:grid-cols-4"><Metric label="Published properties" value={data.properties}/><Metric label="Available" value={data.available}/><Metric label="Pending requests" value={data.pendingRequests}/><Metric label="Inspections in progress" value={data.inspections}/></section>
    <section className="grid gap-3 md:grid-cols-3"><Money label="Available to withdraw" value={data.availableBalance}/><Money label="Pending release" value={data.pendingBalance}/><Money label="Total released earnings" value={data.totalEarnings}/></section>
  </div>;
}

function RequestsTab({ profile }: { profile: Profile }) {
  const [requests, setRequests] = useState<any[]>([]); const [loading, setLoading] = useState(true);
  async function load() { setLoading(true); const { data, error } = await supabase.from('inspection_requests').select('id,request_code,property_address,property_type,property_state,property_city,expected_rent,status,created_at,inspection_date,inspection_report').eq('owner_id', profile.user_id).order('created_at', { ascending: false }); if (error) toast.error('Unable to load property requests'); setRequests(data || []); setLoading(false); }
  useEffect(() => { void load(); }, [profile.user_id]);
  return <div className="space-y-6">
    <PropertyInspectionRequestPanel profile={profile}/>
    <section><div className="mb-3 flex items-center justify-between gap-3"><div><h2 className="text-sm font-semibold">Request & inspection history</h2><p className="mt-1 text-[10px] text-[#66687B]">Follow the property from submission through inspection and WeHouse listing preparation.</p></div><button onClick={() => void load()} className="rounded-lg border border-white/[0.07] px-3 py-2 text-[9px] text-[#888A9B]">Refresh</button></div>
      {loading ? <Loading/> : requests.length === 0 ? <Empty title="No property requests yet" text="Use the form above to send your first property to WeHouse for review and inspection."/> : <div className="space-y-3">{requests.map(request => <section key={request.id} className="rounded-2xl border border-white/[0.06] bg-[#111119] p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-xs font-semibold">{request.property_address || request.property_type || 'Property request'}</p><p className="mt-1 text-[10px] text-[#66687B]">{[request.property_city, request.property_state].filter(Boolean).join(', ')} {request.request_code ? `· ${request.request_code}` : ''}</p></div><Status value={request.status || 'pending'}/></div><div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4"><Info label="Property type" value={request.property_type || 'Not specified'}/><Info label="Expected rent" value={request.expected_rent ? money(Number(request.expected_rent)) : '—'}/><Info label="Submitted" value={request.created_at ? new Date(request.created_at).toLocaleDateString() : '—'}/><Info label="Inspection date" value={request.inspection_date ? new Date(request.inspection_date).toLocaleDateString() : 'Not scheduled'}/></div>{request.inspection_report && <div className="mt-3 rounded-xl border border-white/[0.05] bg-white/[0.02] p-3"><p className="text-[9px] uppercase tracking-wide text-[#66687B]">Inspection update</p><p className="mt-1 text-[10px] leading-relaxed text-[#A4A5B2]">{request.inspection_report}</p></div>}</section>)}</div>}
    </section>
  </div>;
}

function PropertiesTab({ profile }: { profile: Profile }) {
  const [properties, setProperties] = useState<any[]>([]); const [selected, setSelected] = useState<any | null>(null); const [loading, setLoading] = useState(true);
  useEffect(() => { let active = true; (async () => { const { data, error } = await supabase.from('listings').select('*').or(`owner_id.eq.${profile.user_id},partner_id.eq.${profile.user_id}`).order('created_at', { ascending: false }); if (!active) return; if (error) toast.error('Unable to load your properties'); setProperties(data || []); setLoading(false); })(); return () => { active = false; }; }, [profile.user_id]);
  if (selected) return <PropertyDetails property={selected} onBack={() => setSelected(null)} />;
  return <section><div className="mb-4 flex items-center justify-between"><div><h2 className="text-sm font-semibold">Properties published by WeHouse</h2><p className="mt-1 text-[10px] text-[#66687B]">Read-only public listings connected to your Property Partner account.</p></div><span className="rounded-full bg-white/[0.04] px-3 py-1 text-[10px] text-[#888A9B]">{properties.length}</span></div>{loading ? <Loading/> : properties.length === 0 ? <Empty title="No published properties yet" text="Your approved property will appear here after WeHouse completes inspection and publishes the listing."/> : <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{properties.map(property => <button key={property.id} onClick={() => setSelected(property)} className="overflow-hidden rounded-2xl border border-white/[0.06] bg-[#111119] text-left transition hover:-translate-y-0.5 hover:border-violet-500/25"><div className="h-40 bg-[#171722]">{property.images?.[0] ? <img src={property.images[0]} alt="" className="h-full w-full object-cover"/> : <div className="grid h-full place-items-center text-[#46485A]">No image</div>}</div><div className="p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-semibold">{property.title || 'Property'}</p><p className="mt-1 truncate text-[10px] text-[#66687B]">{[property.city, property.state].filter(Boolean).join(', ')}</p></div><Status value={property.availability_status || property.status || 'pending'}/></div><p className="mt-3 text-xs font-bold">{money(Number(property.price || 0))}</p></div></button>)}</div>}</section>;
}

function PropertyDetails({ property, onBack }: { property: any; onBack: () => void }) { return <div className="space-y-5"><button onClick={onBack} className="text-xs text-[#888A9B] hover:text-white">← Back to properties</button><section className="overflow-hidden rounded-3xl border border-white/[0.06] bg-[#111119]">{property.images?.[0] && <img src={property.images[0]} alt="" className="h-56 w-full object-cover lg:h-72"/>}<div className="p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-bold">{property.title || 'Property'}</h2><p className="mt-1 text-xs text-[#747689]">{[property.address, property.city, property.state].filter(Boolean).join(', ')}</p></div><Status value={property.availability_status || property.status || 'pending'}/></div><div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4"><Info label="Group" value={property.property_type || 'Apartment'}/><Info label="Type" value={property.sub_type || 'Not specified'}/><Info label="Bedrooms" value={property.bedrooms ?? '—'}/><Info label="Bathrooms" value={property.bathrooms ?? '—'}/></div><div className="mt-4 rounded-xl border border-white/[0.05] bg-white/[0.025] p-4"><p className="text-[10px] font-semibold uppercase tracking-wide text-[#73758A]">Listing management</p><p className="mt-1 text-xs leading-relaxed text-[#A1A2B0]">WeHouse creates and manages this public listing. Use Messages or Support to request a correction.</p></div></div></section></div>; }

function FinanceTab({ profile }: { profile: Profile }) {
  const [view, setView] = useState<FinanceView>('wallet');
  return <div className="space-y-5"><div className="inline-flex rounded-xl border border-white/[0.06] bg-[#101018] p-1"><button onClick={() => setView('wallet')} className={`rounded-lg px-4 py-2 text-[10px] font-semibold ${view === 'wallet' ? 'bg-violet-500 text-white' : 'text-[#747689]'}`}>Wallet & Withdrawals</button><button onClick={() => setView('earnings')} className={`rounded-lg px-4 py-2 text-[10px] font-semibold ${view === 'earnings' ? 'bg-violet-500 text-white' : 'text-[#747689]'}`}>Earnings</button></div>{view === 'wallet' ? <PropertyPartnerFinancePanel profile={profile}/> : <EarningsTab profile={profile}/>}</div>;
}

function EarningsTab({ profile }: { profile: Profile }) {
  const [rows, setRows] = useState<EarningRelease[]>([]); const [loading, setLoading] = useState(true);
  useEffect(() => { let active = true; (async () => { const { data, error } = await supabase.from('property_partner_earning_releases').select('id,earning_type,status,net_amount,release_event,created_at').eq('partner_id', profile.user_id).order('created_at', { ascending: false }); if (!active) return; if (error) toast.error('Unable to load earnings'); setRows((data || []) as EarningRelease[]); setLoading(false); })(); return () => { active = false; }; }, [profile.user_id]);
  const totals = rows.reduce((result, row) => { result[row.status] += Number(row.net_amount || 0); return result; }, { pending: 0, available: 0, held: 0, reversed: 0 });
  return <div className="space-y-6"><section className="grid grid-cols-2 gap-3 lg:grid-cols-4"><Money label="Released" value={totals.available}/><Money label="Pending" value={totals.pending}/><Money label="Held" value={totals.held}/><Money label="Reversed" value={totals.reversed}/></section><section className="rounded-2xl border border-white/[0.06] bg-[#111119] p-4"><h2 className="text-sm font-semibold">Earning history</h2><p className="mt-1 text-[10px] text-[#66687B]">Net eligible property income after WeHouse commission.</p>{loading ? <Loading/> : rows.length === 0 ? <Empty title="No property earnings yet" text="Eligible verified payments will appear here after WeHouse records them."/> : <div className="mt-4 divide-y divide-white/[0.05]">{rows.map(row => <div key={row.id} className="flex items-center justify-between gap-4 py-3"><div><p className="text-xs font-medium capitalize">{row.earning_type.replace(/_/g,' ')}</p><p className="mt-1 text-[9px] text-[#626477]">{new Date(row.created_at).toLocaleDateString()} {row.release_event ? `· ${row.release_event.replace(/_/g,' ')}` : ''}</p></div><div className="text-right"><p className="text-xs font-semibold">{money(row.net_amount)}</p><Status value={row.status}/></div></div>)}</div>}</section></div>;
}

function MessagesTab({ profile }: { profile: Profile }) {
  const [conversations, setConversations] = useState<any[]>([]); const [activeConversation, setActiveConversation] = useState<string | null>(null); const [loading, setLoading] = useState(true);
  async function load() { setLoading(true); const result = await getPartnerConversations(profile.user_id); setConversations(result.conversations || []); setLoading(false); }
  useEffect(() => { void load(); }, [profile.user_id]);
  if (activeConversation) return <PartnerSupportChat conversationId={activeConversation} profile={profile} senderRole="partner" onClose={() => { setActiveConversation(null); void load(); }}/>;
  return <section className="rounded-2xl border border-white/[0.06] bg-[#111119] p-4"><div className="mb-4"><h2 className="text-sm font-semibold">WeHouse conversations</h2><p className="mt-1 text-[10px] text-[#66687B]">Property Partners communicate with WeHouse about properties and finance, not directly with customers.</p></div>{loading ? <Loading/> : conversations.length === 0 ? <Empty title="No messages yet" text="Replies from WeHouse about inspections, listings, payments or support will appear here."/> : <div className="space-y-2">{conversations.map(conversation => <button key={conversation.id} onClick={() => setActiveConversation(conversation.id)} className="w-full rounded-xl border border-white/[0.05] bg-white/[0.025] p-4 text-left hover:border-violet-500/20"><div className="flex items-center justify-between gap-3"><p className="truncate text-xs font-semibold">{conversation.subject || 'WeHouse conversation'}</p>{conversation.unread_count > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-violet-500 px-1 text-[9px] font-bold">{conversation.unread_count}</span>}</div><p className="mt-1 truncate text-[10px] text-[#66687B]">{conversation.last_message || 'Open conversation'}</p></button>)}</div>}</section>;
}

function SupportTab({ profile }: { profile: Profile }) {
  const [subject, setSubject] = useState('General support'); const [message, setMessage] = useState(''); const [sending, setSending] = useState(false);
  async function submit() { if (!message.trim()) return toast.error('Enter your message'); setSending(true); const created = await createPartnerSupportConversation(profile.user_id, subject); if (created.error || !created.conversationId) { setSending(false); return toast.error(created.error?.message || 'Unable to contact WeHouse'); } const sent = await sendPartnerSupportMessage(created.conversationId, profile.user_id, message.trim(), 'partner'); setSending(false); if (sent.error) return toast.error(sent.error.message || 'Unable to send your message'); setMessage(''); toast.success('Message sent to WeHouse'); }
  return <div className="grid gap-4 lg:grid-cols-[1.2fr_.8fr]"><section className="rounded-2xl border border-white/[0.06] bg-[#111119] p-5"><h2 className="text-sm font-semibold">Contact WeHouse</h2><p className="mt-1 text-[10px] text-[#66687B]">Use this when you need help, rather than creating a duplicate property or finance action.</p><div className="mt-5 space-y-3"><select value={subject} onChange={event => setSubject(event.target.value)} className="h-11 w-full rounded-xl border border-white/[0.08] bg-[#181822] px-3 text-xs outline-none focus:border-violet-500"><option>General support</option><option>Property inspection</option><option>Listing correction</option><option>Payment or earnings</option><option>Withdrawal</option><option>Account issue</option></select><textarea value={message} onChange={event => setMessage(event.target.value)} rows={6} placeholder="Describe what you need help with" className="w-full resize-none rounded-xl border border-white/[0.08] bg-[#181822] p-3 text-xs outline-none focus:border-violet-500"/><button onClick={() => void submit()} disabled={sending} className="h-11 w-full rounded-xl bg-violet-500 text-xs font-semibold disabled:opacity-50">{sending ? 'Sending…' : 'Send to WeHouse'}</button></div></section><section className="rounded-2xl border border-white/[0.06] bg-[#111119] p-5"><h2 className="text-sm font-semibold">Where things belong</h2><div className="mt-4 space-y-3 text-[11px] leading-relaxed text-[#85879A]"><p>• New property or inspection progress → Property Requests.</p><p>• Published listings → My Properties.</p><p>• Earnings, balances and withdrawals → Finance.</p><p>• Ongoing WeHouse conversations → Messages.</p><p>• New help request → Support.</p></div></section></div>;
}

function Metric({ label, value }: { label: string; value: string | number }) { return <div className="rounded-2xl border border-white/[0.06] bg-[#111119] p-4"><p className="text-[9px] text-[#66687B]">{label}</p><p className="mt-2 text-xl font-bold">{value}</p></div>; }
function Money({ label, value }: { label: string; value: number }) { return <div className="rounded-2xl border border-emerald-500/15 bg-emerald-500/[0.05] p-4"><p className="text-[9px] text-emerald-300/70">{label}</p><p className="mt-2 text-lg font-bold">{money(value)}</p></div>; }
function Info({ label, value }: { label: string; value: string | number }) { return <div className="rounded-xl border border-white/[0.06] bg-[#111119] p-4"><p className="text-[9px] uppercase tracking-wide text-[#616375]">{label}</p><p className="mt-1 break-words text-xs font-medium capitalize text-[#D3D4DC]">{value}</p></div>; }
function Status({ value }: { value: string }) { const normalized = value.toLowerCase(); const style = normalized === 'available' || normalized === 'approved' || normalized === 'completed' ? 'bg-emerald-500/10 text-emerald-300' : normalized === 'rejected' || normalized === 'reversed' ? 'bg-red-500/10 text-red-300' : normalized === 'held' ? 'bg-orange-500/10 text-orange-300' : 'bg-amber-500/10 text-amber-300'; return <span className={`inline-flex rounded-full px-2 py-1 text-[8px] font-semibold capitalize ${style}`}>{value.replace(/_/g,' ')}</span>; }
function Empty({ title, text }: { title: string; text: string }) { return <div className="rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.015] px-5 py-12 text-center"><p className="text-sm font-semibold">{title}</p><p className="mx-auto mt-2 max-w-md text-[10px] leading-relaxed text-[#626477]">{text}</p></div>; }
function Loading() { return <div className="grid min-h-40 place-items-center"><div className="h-7 w-7 animate-spin rounded-full border-2 border-violet-500 border-t-transparent"/></div>; }
