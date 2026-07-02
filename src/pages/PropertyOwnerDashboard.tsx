import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/types';
import { Toaster, toast } from 'sonner';

interface PropertyOwnerDashboardProps {
  profile: Profile;
  onLogout: () => void;
  onNavigate?: (page: string) => void;
}

type OwnerTab = 'overview' | 'properties' | 'request' | 'requests' | 'earnings';

export default function PropertyOwnerDashboard({ profile, onLogout, onNavigate }: PropertyOwnerDashboardProps) {
  const [activeTab, setActiveTab] = useState<OwnerTab>('overview');

  return (
    <div className="min-h-screen bg-[#0A0A0F] pb-6">
      <Toaster position="top-center" richColors />

      {/* Header with Back Button */}
      <header className="bg-[#12121A] border-b border-white/[0.06] px-5 py-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => onNavigate?.('home')}
            className="w-9 h-9 rounded-xl bg-[#1A1A24] border border-[#232330] flex items-center justify-center text-[#8A8B9C] hover:text-white hover:border-[#3B82F6]/30 transition-all"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold text-white">Property Partner</h1>
            <p className="text-[10px] text-[#5C5E72] truncate">{profile.email}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] px-2 py-1 rounded-full bg-violet-500/10 text-violet-400 border border-violet-500/20">Partner</span>
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
        {activeTab === 'overview' && <OverviewTab profile={profile} onRequestInspection={() => setActiveTab('request')} />}
        {activeTab === 'properties' && <PropertiesTab ownerId={profile.user_id} />}
        {activeTab === 'request' && <RequestInspectionTab profile={profile} onSubmitted={() => setActiveTab('requests')} />}
        {activeTab === 'requests' && <MyRequestsTab ownerId={profile.user_id} />}
        {activeTab === 'earnings' && <EarningsTab ownerId={profile.user_id} />}
      </main>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// OVERVIEW TAB
// ═══════════════════════════════════════════════════════════════

function OverviewTab({ profile, onRequestInspection }: { profile: Profile; onRequestInspection?: () => void }) {
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
          onClick={onRequestInspection}
          className="w-full rounded-2xl bg-[#12121A]/60 border border-white/[0.04] p-4 flex items-center gap-3 text-left hover:bg-white/[0.02] transition-colors active:scale-[0.98]"
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

interface PropertyForm {
  id: string;
  property_address: string;
  property_city: string;
  property_state: string;
  property_type: 'house' | 'apartment' | 'duplex' | '';
  bedrooms: string;
  bathrooms: string;
  expected_rent: string;
  description: string;
}

function RequestInspectionTab({ profile, onSubmitted }: { profile: Profile; onSubmitted?: () => void }) {
  const [properties, setProperties] = useState<PropertyForm[]>([]);
  const [form, setForm] = useState<PropertyForm>({
    id: '', property_address: '', property_city: '', property_state: '',
    property_type: '', bedrooms: '1', bathrooms: '1', expected_rent: '', description: '',
  });
  const [ownerPhone, setOwnerPhone] = useState(profile.phone || '');
  const [submitting, setSubmitting] = useState(false);

  const propertyTypes = [
    { value: 'house' as const, label: 'House', icon: '🏠', desc: 'Standalone' },
    { value: 'apartment' as const, label: 'Apartment', icon: '🏢', desc: 'Flat' },
    { value: 'duplex' as const, label: 'Duplex', icon: '🏘️', desc: 'Two-floor' },
  ];

  function resetForm() {
    setForm({ id: '', property_address: '', property_city: '', property_state: '', property_type: '', bedrooms: '1', bathrooms: '1', expected_rent: '', description: '' });
  }

  function addProperty() {
    if (!form.property_address || !form.property_city || !form.property_state) {
      toast.error('Address, city, and state are required');
      return;
    }
    if (!form.property_type) {
      toast.error('Please select a property type');
      return;
    }
    setProperties(prev => [...prev, { ...form, id: crypto.randomUUID() }]);
    resetForm();
    toast.success('Property added! Add more or submit all.');
  }

  function removeProperty(id: string) {
    setProperties(prev => prev.filter(p => p.id !== id));
  }

  async function handleSubmitAll() {
    if (properties.length === 0) {
      toast.error('Add at least one property');
      return;
    }

    setSubmitting(true);
    const baseCode = `WHIR-${Date.now().toString(36).toUpperCase()}`;

    const inserts = properties.map((p, i) => ({
      request_code: `${baseCode}-${i + 1}`,
      owner_id: profile.user_id,
      owner_email: profile.email,
      owner_phone: ownerPhone,
      property_address: p.property_address,
      property_city: p.property_city,
      property_state: p.property_state,
      property_type: p.property_type,
      bedrooms: parseInt(p.bedrooms),
      bathrooms: parseInt(p.bathrooms),
      expected_rent: p.expected_rent ? parseFloat(p.expected_rent) : null,
      description: p.description,
      status: 'pending' as const,
    }));

    const { error } = await supabase.from('inspection_requests').insert(inserts);
    setSubmitting(false);

    if (error) {
      toast.error('Failed: ' + error.message);
      return;
    }

    toast.success(`${properties.length} inspection request(s) submitted! WeHouse will review and schedule.`);
    setProperties([]);
    resetForm();
    onSubmitted?.();
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-gradient-to-br from-violet-500/10 to-violet-600/5 border border-violet-500/20 p-4">
        <h3 className="text-sm font-semibold text-white">Request Property Inspection</h3>
        <p className="text-[10px] text-[#5C5E72] mt-1">
          Add all your properties, then submit them all in one go.
        </p>
      </div>

      {/* Added Properties List */}
      {properties.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-[#8B8DA0] uppercase tracking-wider">Added Properties ({properties.length})</h4>
          {properties.map((p) => (
            <div key={p.id} className="rounded-xl bg-[#12121A]/80 border border-violet-500/10 p-3 flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-violet-500/10 flex items-center justify-center text-sm">
                {propertyTypes.find(t => t.value === p.property_type)?.icon}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-white truncate">{p.property_address}</p>
                <p className="text-[9px] text-[#5C5E72]">{p.property_city}, {p.property_state} · {p.property_type} · {p.bedrooms}bd/{p.bathrooms}ba</p>
              </div>
              <button onClick={() => removeProperty(p.id)} className="text-[10px] text-red-400 hover:text-red-300 px-2 py-1">Remove</button>
            </div>
          ))}
        </div>
      )}

      {/* Property Form */}
      <div className="rounded-2xl bg-[#12121A]/40 border border-white/[0.04] p-4 space-y-3">
        <h4 className="text-xs font-semibold text-white">Add Property {properties.length + 1}</h4>

        <Input label="Property Address *" value={form.property_address} onChange={v => setForm(f => ({ ...f, property_address: v }))} placeholder="123 Main Street, Block 4" required />
        <div className="grid grid-cols-2 gap-3">
          <Input label="City *" value={form.property_city} onChange={v => setForm(f => ({ ...f, property_city: v }))} placeholder="Ikeja" required />
          <Input label="State *" value={form.property_state} onChange={v => setForm(f => ({ ...f, property_state: v }))} placeholder="Lagos" required />
        </div>

        <div>
          <label className="text-[11px] text-[#8B8DA0] mb-2 block font-medium">Property Type *</label>
          <div className="grid grid-cols-3 gap-2">
            {propertyTypes.map((pt) => (
              <button key={pt.value} type="button" onClick={() => setForm(f => ({ ...f, property_type: pt.value }))}
                className={`rounded-xl border p-3 text-center transition-all ${form.property_type === pt.value ? 'border-violet-500 bg-violet-500/10' : 'border-[#232330] bg-[#1A1A24] hover:border-violet-500/30'}`}>
                <span className="text-xl">{pt.icon}</span>
                <p className={`text-xs font-semibold mt-1 ${form.property_type === pt.value ? 'text-violet-400' : 'text-white'}`}>{pt.label}</p>
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[11px] text-[#8B8DA0] mb-1.5 block font-medium">Bedrooms</label>
            <select value={form.bedrooms} onChange={e => setForm(f => ({ ...f, bedrooms: e.target.value }))}
              className="w-full h-10 rounded-xl bg-[#1A1A24] border border-[#232330] text-white text-sm px-4 outline-none focus:border-violet-500">
              {[1,2,3,4,5,6].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[11px] text-[#8B8DA0] mb-1.5 block font-medium">Bathrooms</label>
            <select value={form.bathrooms} onChange={e => setForm(f => ({ ...f, bathrooms: e.target.value }))}
              className="w-full h-10 rounded-xl bg-[#1A1A24] border border-[#232330] text-white text-sm px-4 outline-none focus:border-violet-500">
              {[1,2,3,4,5,6].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Expected Rent (N/year)" value={form.expected_rent} onChange={v => setForm(f => ({ ...f, expected_rent: v }))} placeholder="500000" type="number" />
          {properties.length === 0 && (
            <Input label="Phone" value={ownerPhone} onChange={v => setOwnerPhone(v)} placeholder="08012345678" />
          )}
        </div>
        <TextArea label="Description" value={form.description} onChange={v => setForm(f => ({ ...f, description: v }))} placeholder="Tell us about this property..." rows={3} />

        <button type="button" onClick={addProperty}
          className="w-full h-10 rounded-xl border border-dashed border-violet-500/30 text-violet-400 text-sm font-semibold hover:bg-violet-500/10 transition-colors">
          + Add This Property
        </button>
      </div>

      {/* Submit All */}
      <button onClick={handleSubmitAll} disabled={submitting || properties.length === 0}
        className="w-full h-12 rounded-xl bg-violet-500 text-white font-semibold hover:bg-violet-600 transition-colors disabled:opacity-40 active:scale-[0.98]">
        {submitting ? 'Submitting...' : properties.length === 0 ? 'Add Properties Above' : `Submit All ${properties.length} Properties`}
      </button>
    </div>
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
