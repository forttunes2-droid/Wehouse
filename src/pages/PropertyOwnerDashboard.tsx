import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/types';
import { Toaster, toast } from 'sonner';

interface PropertyOwnerDashboardProps {
  profile: Profile;
  onLogout: () => void;
}

type OwnerTab = 'overview' | 'properties' | 'request' | 'requests' | 'earnings';

export default function PropertyOwnerDashboard({ profile, onLogout }: PropertyOwnerDashboardProps) {
  const [activeTab, setActiveTab] = useState<OwnerTab>('overview');

  return (
    <div className="min-h-screen bg-[#0A0A0F] pb-6">
      <Toaster position="top-center" richColors />

      {/* Header */}
      <header className="bg-[#12121A] border-b border-white/[0.06] px-5 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-white">Property Owner</h1>
            <p className="text-[10px] text-[#5C5E72]">{profile.email}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] px-2 py-1 rounded-full bg-violet-500/10 text-violet-400 border border-violet-500/20">Owner</span>
            <button onClick={onLogout} className="text-[10px] text-[#5C5E72] hover:text-white px-2 py-1">Logout</button>
          </div>
        </div>
      </header>

      {/* Tabs */}
      <div className="flex gap-1 px-5 py-3 border-b border-white/[0.04] overflow-x-auto scrollbar-hide">
        {([
          { id: 'overview' as OwnerTab, label: 'Overview' },
          { id: 'properties' as OwnerTab, label: 'Properties' },
          { id: 'request' as OwnerTab, label: 'Request Inspection' },
          { id: 'requests' as OwnerTab, label: 'My Requests' },
          { id: 'earnings' as OwnerTab, label: 'Earnings' },
        ]).map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-shrink-0 h-9 px-4 rounded-xl text-[11px] font-semibold transition-all whitespace-nowrap ${
              activeTab === tab.id
                ? 'bg-violet-500 text-white'
                : 'text-[#5C5E72] hover:text-white'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <main className="px-5 py-4">
        {activeTab === 'overview' && <OverviewTab profile={profile} />}
        {activeTab === 'properties' && <PropertiesTab ownerId={profile.user_id} />}
        {activeTab === 'request' && <RequestInspectionTab profile={profile} />}
        {activeTab === 'requests' && <MyRequestsTab ownerId={profile.user_id} />}
        {activeTab === 'earnings' && <EarningsTab ownerId={profile.user_id} />}
      </main>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// OVERVIEW TAB
// ═══════════════════════════════════════════════════════════════

function OverviewTab({ profile }: { profile: Profile }) {
  const [stats, setStats] = useState({ properties: 0, requests: 0, earnings: 0 });

  useEffect(() => {
    async function load() {
      const [{ count: p }, { count: r }, { data: payouts }] = await Promise.all([
        supabase.from('owner_properties').select('*', { count: 'exact', head: true }).eq('owner_id', profile.user_id),
        supabase.from('inspection_requests').select('*', { count: 'exact', head: true }).eq('owner_id', profile.user_id),
        supabase.from('payouts').select('amount').eq('owner_id', profile.user_id).eq('status', 'paid'),
      ]);
      const totalEarnings = (payouts || []).reduce((s, p) => s + (p.amount || 0), 0);
      setStats({ properties: p || 0, requests: r || 0, earnings: totalEarnings });
    }
    load();
  }, [profile.user_id]);

  return (
    <div className="space-y-4">
      {/* Welcome */}
      <div className="rounded-2xl bg-gradient-to-br from-violet-500/10 to-violet-600/5 border border-violet-500/20 p-5">
        <h2 className="text-sm font-semibold text-white">Welcome, {profile.full_name || profile.username || 'Owner'}</h2>
        <p className="text-[10px] text-[#5C5E72] mt-1">
          WeHouse manages your property listings. Submit an inspection request to get started.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Properties" value={stats.properties} color="violet" />
        <StatCard label="Requests" value={stats.requests} color="amber" />
        <StatCard label="Earnings" value={`N${stats.earnings.toLocaleString()}`} color="emerald" />
      </div>

      {/* Quick Actions */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold text-[#5C5E72] uppercase tracking-wider">Quick Actions</h3>
        <button
          onClick={() => {}}
          className="w-full rounded-2xl bg-[#12121A]/60 border border-white/[0.04] p-4 flex items-center gap-3 text-left hover:bg-white/[0.02] transition-colors"
        >
          <div className="w-10 h-10 rounded-xl bg-violet-500/10 flex items-center justify-center">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#8B5CF6" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
          </div>
          <div>
            <p className="text-sm font-semibold text-white">Request Inspection</p>
            <p className="text-[10px] text-[#5C5E72]">Submit a new property for WeHouse to inspect</p>
          </div>
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// PROPERTIES TAB
// ═══════════════════════════════════════════════════════════════

function PropertiesTab({ ownerId }: { ownerId: string }) {
  const [properties, setProperties] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('owner_properties')
        .select('*, listings(*)')
        .eq('owner_id', ownerId);
      setProperties(data || []);
      setLoading(false);
    }
    load();
  }, [ownerId]);

  if (loading) return <LoadingSpinner />;

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold text-[#5C5E72] uppercase tracking-wider">My Properties ({properties.length})</h3>
      {properties.length === 0 ? (
        <div className="text-center py-10 text-[#5C5E72] text-sm">
          No properties listed yet. Submit an inspection request to get started.
        </div>
      ) : (
        properties.map(p => (
          <div key={p.id} className="rounded-2xl bg-[#12121A]/60 border border-white/[0.04] p-4">
            <p className="text-sm font-semibold text-white">{p.listings?.title || 'Untitled'}</p>
            <p className="text-[10px] text-[#5C5E72]">{p.listings?.city}, {p.listings?.state}</p>
            <p className="text-[10px] text-[#5C5E72]">{p.listings?.bedrooms} bed &middot; N{p.listings?.price?.toLocaleString()}</p>
            <span className={`inline-block mt-2 text-[9px] px-2 py-0.5 rounded-full ${
              p.listings?.status === 'available' ? 'bg-emerald-500/10 text-emerald-400' :
              p.listings?.status === 'reserved' ? 'bg-amber-500/10 text-amber-400' :
              'bg-gray-500/10 text-gray-400'
            }`}>{p.listings?.status || 'unknown'}</span>
          </div>
        ))
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// REQUEST INSPECTION TAB
// ═══════════════════════════════════════════════════════════════

function RequestInspectionTab({ profile }: { profile: Profile }) {
  const [form, setForm] = useState({
    property_address: '',
    property_city: '',
    property_state: '',
    property_type: 'apartment' as string,
    bedrooms: '',
    bathrooms: '',
    expected_rent: '',
    description: '',
    owner_phone: profile.phone || '',
  });
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.property_address || !form.property_city || !form.property_state) {
      toast.error('Address, city, and state are required');
      return;
    }

    setSubmitting(true);
    const requestCode = `WHIR-${Date.now().toString(36).toUpperCase()}`;

    const { error } = await supabase.from('inspection_requests').insert({
      request_code: requestCode,
      owner_id: profile.user_id,
      owner_email: profile.email,
      owner_phone: form.owner_phone,
      property_address: form.property_address,
      property_city: form.property_city,
      property_state: form.property_state,
      property_type: form.property_type,
      bedrooms: form.bedrooms ? parseInt(form.bedrooms) : null,
      bathrooms: form.bathrooms ? parseInt(form.bathrooms) : null,
      expected_rent: form.expected_rent ? parseFloat(form.expected_rent) : null,
      description: form.description,
      status: 'pending',
    });

    setSubmitting(false);

    if (error) {
      toast.error('Failed: ' + error.message);
      return;
    }

    toast.success('Inspection request submitted! WeHouse will review and schedule.');
    setForm({ property_address: '', property_city: '', property_state: '', property_type: 'apartment', bedrooms: '', bathrooms: '', expected_rent: '', description: '', owner_phone: profile.phone || '' });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="rounded-2xl bg-gradient-to-br from-violet-500/10 to-violet-600/5 border border-violet-500/20 p-4">
        <h3 className="text-sm font-semibold text-white">Request Property Inspection</h3>
        <p className="text-[10px] text-[#5C5E72] mt-1">
          Fill in your property details. WeHouse will inspect, photograph, and list it for you.
        </p>
      </div>

      <div className="space-y-3">
        <Input label="Property Address *" value={form.property_address} onChange={v => setForm(f => ({ ...f, property_address: v }))} placeholder="123 Main Street, Block 4" required />
        <div className="grid grid-cols-2 gap-3">
          <Input label="City *" value={form.property_city} onChange={v => setForm(f => ({ ...f, property_city: v }))} placeholder="Lagos" required />
          <Input label="State *" value={form.property_state} onChange={v => setForm(f => ({ ...f, property_state: v }))} placeholder="Lagos" required />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Select label="Property Type" value={form.property_type} onChange={v => setForm(f => ({ ...f, property_type: v }))} options={[
            { value: 'apartment', label: 'Apartment' },
            { value: 'house', label: 'House' },
            { value: 'self_contain', label: 'Self Contain' },
            { value: 'mini_flat', label: 'Mini Flat' },
            { value: 'duplex', label: 'Duplex' },
            { value: 'bungalow', label: 'Bungalow' },
            { value: 'mansion', label: 'Mansion' },
          ]} />
          <Input label="Expected Rent (N)" value={form.expected_rent} onChange={v => setForm(f => ({ ...f, expected_rent: v }))} placeholder="500000" type="number" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Bedrooms" value={form.bedrooms} onChange={v => setForm(f => ({ ...f, bedrooms: v }))} placeholder="2" type="number" />
          <Input label="Bathrooms" value={form.bathrooms} onChange={v => setForm(f => ({ ...f, bathrooms: v }))} placeholder="2" type="number" />
        </div>
        <Input label="Phone" value={form.owner_phone} onChange={v => setForm(f => ({ ...f, owner_phone: v }))} placeholder="08012345678" />
        <TextArea label="Description" value={form.description} onChange={v => setForm(f => ({ ...f, description: v }))} placeholder="Tell us about your property..." rows={4} />
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="w-full h-12 rounded-xl bg-violet-500 text-white font-semibold hover:bg-violet-600 transition-colors disabled:opacity-50"
      >
        {submitting ? 'Submitting...' : 'Submit Inspection Request'}
      </button>
    </form>
  );
}

// ═══════════════════════════════════════════════════════════════
// MY REQUESTS TAB
// ═══════════════════════════════════════════════════════════════

function MyRequestsTab({ ownerId }: { ownerId: string }) {
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadRequests();
  }, [ownerId]);

  async function loadRequests() {
    const { data } = await supabase
      .from('inspection_requests')
      .select('*')
      .eq('owner_id', ownerId)
      .order('created_at', { ascending: false });
    setRequests(data || []);
    setLoading(false);
  }

  if (loading) return <LoadingSpinner />;

  const statusColors: Record<string, string> = {
    pending: 'bg-amber-500/10 text-amber-400',
    scheduled: 'bg-blue-500/10 text-blue-400',
    in_progress: 'bg-purple-500/10 text-purple-400',
    approved: 'bg-emerald-500/10 text-emerald-400',
    rejected: 'bg-red-500/10 text-red-400',
    completed: 'bg-gray-500/10 text-gray-400',
  };

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold text-[#5C5E72] uppercase tracking-wider">My Requests ({requests.length})</h3>
      {requests.length === 0 ? (
        <div className="text-center py-10 text-[#5C5E72] text-sm">No requests yet. Submit your first inspection request.</div>
      ) : (
        requests.map(r => (
          <div key={r.id} className="rounded-2xl bg-[#12121A]/60 border border-white/[0.04] p-4">
            <div className="flex items-center justify-between">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-white truncate">{r.property_address}</p>
                  <span className={`text-[8px] px-1.5 py-0.5 rounded-full ${statusColors[r.status] || 'bg-gray-500/10'}`}>{r.status}</span>
                </div>
                <p className="text-[10px] text-[#5C5E72]">{r.property_city}, {r.property_state} &middot; {r.property_type}</p>
                <p className="text-[9px] text-[#5C5E72]">{r.request_code} &middot; {new Date(r.created_at).toLocaleDateString()}</p>
              </div>
            </div>
            {r.rejection_reason && (
              <p className="text-[10px] text-red-400 mt-2">Reason: {r.rejection_reason}</p>
            )}
            {r.notes && (
              <p className="text-[10px] text-[#5C5E72] mt-2">Note: {r.notes}</p>
            )}
          </div>
        ))
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// EARNINGS TAB
// ═══════════════════════════════════════════════════════════════

function EarningsTab({ ownerId }: { ownerId: string }) {
  const [payouts, setPayouts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('payouts')
        .select('*')
        .eq('owner_id', ownerId)
        .order('created_at', { ascending: false });
      setPayouts(data || []);
      setLoading(false);
    }
    load();
  }, [ownerId]);

  if (loading) return <LoadingSpinner />;

  const totalPaid = payouts.filter(p => p.status === 'paid').reduce((s, p) => s + p.amount, 0);
  const totalPending = payouts.filter(p => p.status === 'pending').reduce((s, p) => s + p.amount, 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-emerald-500/5 border border-emerald-500/10 p-4 text-center">
          <p className="text-xl font-bold text-emerald-400">N{totalPaid.toLocaleString()}</p>
          <p className="text-[9px] text-[#5C5E72]">Total Paid</p>
        </div>
        <div className="rounded-2xl bg-amber-500/5 border border-amber-500/10 p-4 text-center">
          <p className="text-xl font-bold text-amber-400">N{totalPending.toLocaleString()}</p>
          <p className="text-[9px] text-[#5C5E72]">Pending</p>
        </div>
      </div>

      <h3 className="text-xs font-semibold text-[#5C5E72] uppercase tracking-wider">Payout History</h3>
      {payouts.length === 0 ? (
        <div className="text-center py-10 text-[#5C5E72] text-sm">No payouts yet</div>
      ) : (
        payouts.map(p => (
          <div key={p.id} className="rounded-2xl bg-[#12121A]/60 border border-white/[0.04] p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-white">{p.payout_code}</p>
                <p className="text-[10px] text-[#5C5E72]">{p.period_start} to {p.period_end}</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-bold text-emerald-400">N{p.amount.toLocaleString()}</p>
                <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${
                  p.status === 'paid' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'
                }`}>{p.status}</span>
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// SHARED COMPONENTS
// ═══════════════════════════════════════════════════════════════

function StatCard({ label, value, color }: { label: string; value: string | number; color: string }) {
  const colorMap: Record<string, string> = {
    violet: 'from-violet-500/10 to-violet-600/5 text-violet-400 border-violet-500/20',
    amber: 'from-amber-500/10 to-amber-600/5 text-amber-400 border-amber-500/20',
    emerald: 'from-emerald-500/10 to-emerald-600/5 text-emerald-400 border-emerald-500/20',
  };
  return (
    <div className={`rounded-2xl bg-gradient-to-br ${colorMap[color]} border p-4 text-center`}>
      <p className="text-lg font-extrabold">{value}</p>
      <p className="text-[9px] mt-1 opacity-70">{label}</p>
    </div>
  );
}

function Input({ label, value, onChange, placeholder, type = 'text', required }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string; required?: boolean }) {
  return (
    <div>
      <label className="text-[11px] text-[#8B8DA0] mb-1.5 block font-medium">{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        className="w-full h-10 rounded-xl bg-[#1A1A24] border border-[#232330] text-white text-sm px-4 placeholder:text-[#5C5E72] outline-none focus:border-violet-500"
      />
    </div>
  );
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div>
      <label className="text-[11px] text-[#8B8DA0] mb-1.5 block font-medium">{label}</label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full h-10 rounded-xl bg-[#1A1A24] border border-[#232330] text-white text-sm px-4 outline-none focus:border-violet-500"
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

function TextArea({ label, value, onChange, placeholder, rows = 3 }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; rows?: number }) {
  return (
    <div>
      <label className="text-[11px] text-[#8B8DA0] mb-1.5 block font-medium">{label}</label>
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        className="w-full rounded-xl bg-[#1A1A24] border border-[#232330] text-white text-sm px-4 py-3 placeholder:text-[#5C5E72] outline-none focus:border-violet-500 resize-none"
      />
    </div>
  );
}

function LoadingSpinner() {
  return (
    <div className="flex justify-center py-10">
      <div className="w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}
