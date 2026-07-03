import { useState, useEffect } from 'react';
import { supabase, getOrCreateConversation } from '@/lib/supabase';
import { NIGERIA_STATES, getCitiesForState } from '@/data/nigeria-locations';
import type { Profile } from '@/types';
import { Toaster, toast } from 'sonner';

interface Props {
  profile: Profile;
  onLogout: () => void;
  onNavigate?: (page: string) => void;
  onGoToChat?: (convId: string) => void;
  onGoToMessages?: () => void;
}

type OwnerTab = 'overview' | 'properties' | 'request' | 'requests' | 'bookings' | 'earnings';
type PropertyCategory = 'apartment' | 'hotel';
type ApartmentSub = 'short_let' | 'long_stay';

const AMENITIES = [
  { key: 'consistent_water', label: 'Consistent Water' },
  { key: 'generator', label: 'Generator' },
  { key: 'security', label: 'Security' },
  { key: 'parking', label: 'Parking Space' },
  { key: 'ac', label: 'Air Conditioning' },
  { key: 'furnished', label: 'Furnished' },
  { key: 'wifi', label: 'Wi-Fi' },
  { key: 'gym', label: 'Gym' },
  { key: 'swimming_pool', label: 'Swimming Pool' },
  { key: 'prepaid_meter', label: 'Prepaid Meter' },
  { key: 'pop_ceiling', label: 'POP Ceiling' },
  { key: 'wardrobe', label: 'Wardrobe' },
  { key: 'kitchen_cabinets', label: 'Kitchen Cabinets' },
  { key: 'balcony', label: 'Balcony' },
  { key: 'interlocked_road', label: 'Interlocked Road' },
  { key: 'waste_disposal', label: 'Waste Disposal' },
];

// ═══════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════

export default function PropertyOwnerDashboard({ profile, onNavigate, onGoToChat, onGoToMessages }: Props) {
  const [activeTab, setActiveTab] = useState<OwnerTab>('overview');
  const [partnerId, setPartnerId] = useState<string | null>(null);
  const [stats, setStats] = useState({
    totalProperties: 0, activeProperties: 0, pendingRequests: 0,
    totalBookings: 0, totalEarnings: 0,
  });

  // Auto-create partner record if it doesn't exist
  useEffect(() => {
    async function ensurePartner() {
      // Check if partner record exists
      const { data: existing } = await supabase
        .from('property_partners')
        .select('id')
        .eq('profile_id', profile.user_id)
        .maybeSingle();

      if (existing) {
        setPartnerId(existing.id);
        return;
      }

      // Auto-create partner record from profile
      const { data: created, error } = await supabase
        .from('property_partners')
        .insert({
          profile_id: profile.user_id,
          full_name: profile.full_name || profile.username || 'Partner',
          email: profile.email,
          phone: profile.phone || '',
          is_verified: false,
          status: 'active',
        })
        .select('id')
        .single();

      if (error) {
        toast.error('Failed to set up partner account: ' + error.message);
        return;
      }

      if (created) {
        setPartnerId(created.id);
        toast.success('Partner account created!');
      }
    }
    ensurePartner();
  }, [profile.user_id]);

  useEffect(() => {
    if (!partnerId) return;
    async function loadStats() {
      const [{ count: ap }, { count: rp }, { count: b }, { data: payouts }] = await Promise.all([
        supabase.from('properties').select('*', { count: 'exact', head: true }).eq('partner_id', partnerId),
        supabase.from('inspection_requests').select('*', { count: 'exact', head: true }).eq('partner_id', partnerId).eq('status', 'pending'),
        supabase.from('bookings').select('*', { count: 'exact', head: true }).eq('partner_id', partnerId),
        supabase.from('property_payouts').select('amount').eq('partner_id', partnerId).eq('status', 'paid'),
      ]);
      const earnings = (payouts || []).reduce((s, p) => s + (p.amount || 0), 0);
      setStats({
        totalProperties: ap || 0, activeProperties: ap || 0, pendingRequests: rp || 0,
        totalBookings: b || 0, totalEarnings: earnings,
      });
    }
    loadStats();
  }, [partnerId]);

  const TABS: { id: OwnerTab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'properties', label: 'My Properties' },
    { id: 'request', label: 'New Request' },
    { id: 'requests', label: 'Requests' },
    { id: 'bookings', label: 'Bookings' },
    { id: 'earnings', label: 'Earnings' },
  ];

  // Start chat with WeHouse staff — finds staff first, then admin, then creator
  async function handleChatWithWeHouse() {
    // Try staff first, then admin, then creator
    let staffMember = null;
    for (const role of ['staff', 'admin', 'creator', 'creator_admin']) {
      const { data } = await supabase
        .from('profiles')
        .select('user_id, username')
        .eq('role', role)
        .limit(1)
        .maybeSingle();
      if (data) { staffMember = data; break; }
    }

    if (!staffMember) {
      toast.error('No staff available right now. Please email support@wehouse.com.ng');
      return;
    }

    const { conversation, error } = await getOrCreateConversation(profile.user_id, staffMember.user_id);
    if (error || !conversation) {
      toast.error('Failed to start chat: ' + (error?.message || 'unknown error'));
      return;
    }

    if (onGoToChat) {
      onGoToChat(conversation.id);
    } else {
      toast.success('Chat started with ' + (staffMember.username || 'WeHouse support'));
    }
  }

  return (
    <div className="min-h-screen bg-[#0A0A0F] pb-6">
      <Toaster position="top-center" richColors />

      {/* Header */}
      <header className="bg-[#12121A] border-b border-white/[0.06] px-5 py-4">
        <div className="flex items-center gap-3">
          <button onClick={() => onNavigate?.('home')}
            className="w-9 h-9 rounded-xl bg-[#1A1A24] border border-[#232330] flex items-center justify-center text-[#8A8B9C] hover:text-white transition-all">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold text-white">Property Partner</h1>
            <p className="text-[10px] text-[#5C5E72] truncate">{profile.email}</p>
          </div>
          <div className="flex items-center gap-2">
            {/* Chat with WeHouse button */}
            <button
              onClick={handleChatWithWeHouse}
              className="w-9 h-9 rounded-xl bg-[#1A1A24] border border-[#232330] flex items-center justify-center text-emerald-400 hover:text-emerald-300 hover:border-emerald-500/30 transition-all"
              title="Chat with WeHouse"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
            </button>
            {/* Messages/Inbox button */}
            <button
              onClick={onGoToMessages}
              className="w-9 h-9 rounded-xl bg-[#1A1A24] border border-[#232330] flex items-center justify-center text-[#3B82F6] hover:text-[#60A5FA] hover:border-[#3B82F6]/30 transition-all"
              title="My Messages"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
            </button>
            <span className="text-[10px] px-2 py-1 rounded-full bg-violet-500/10 text-violet-400 border border-violet-500/20">Partner</span>
          </div>
        </div>
      </header>

      {/* Tabs */}
      <div className="flex gap-1 px-5 py-3 border-b border-white/[0.04] overflow-x-auto scrollbar-hide">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={`flex-shrink-0 h-9 px-4 rounded-xl text-[11px] font-semibold transition-all whitespace-nowrap ${
              activeTab === t.id ? 'bg-violet-500 text-white' : 'text-[#5C5E72] hover:text-white'
            }`}>{t.label}</button>
        ))}
      </div>

      <main className="px-5 py-4 max-w-lg mx-auto">
        {activeTab === 'overview' && <OverviewTab stats={stats} onTab={setActiveTab} />}
        {activeTab === 'properties' && <PropertiesTab partnerId={partnerId} />}
        {activeTab === 'request' && <RequestInspectionTab partnerId={partnerId} onSubmitted={() => setActiveTab('requests')} />}
        {activeTab === 'requests' && <RequestsTab partnerId={partnerId} />}
        {activeTab === 'bookings' && <BookingsTab partnerId={partnerId} />}
        {activeTab === 'earnings' && <EarningsTab partnerId={partnerId} />}
      </main>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// OVERVIEW TAB
// ═══════════════════════════════════════════════════════════════

function OverviewTab({ stats, onTab }: { stats: any; onTab: (t: OwnerTab) => void }) {
  const cards = [
    { label: 'My Properties', value: stats.totalProperties, color: 'violet', tab: 'properties' as OwnerTab },
    { label: 'Pending', value: stats.pendingRequests, color: 'amber', tab: 'requests' as OwnerTab },
    { label: 'Bookings', value: stats.totalBookings, color: 'blue', tab: 'bookings' as OwnerTab },
    { label: 'Earnings', value: `N${stats.totalEarnings.toLocaleString()}`, color: 'emerald', tab: 'earnings' as OwnerTab },
  ];

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-gradient-to-br from-violet-500/10 to-violet-600/5 border border-violet-500/20 p-5">
        <h2 className="text-sm font-semibold text-white">Welcome to your Partner Dashboard</h2>
        <p className="text-[10px] text-[#5C5E72] mt-1">
          Request property inspections. WeHouse will inspect, approve, and list your properties. You track everything here.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {cards.map(c => (
          <button key={c.label} onClick={() => onTab(c.tab)}
            className={`rounded-2xl bg-gradient-to-br from-${c.color}-500/10 to-${c.color}-600/5 border border-${c.color}-500/20 p-4 text-center hover:scale-[1.02] transition-all active:scale-[0.98]`}>
            <p className="text-lg font-extrabold text-white">{c.value}</p>
            <p className="text-[9px] text-[#5C5E72] mt-1">{c.label}</p>
          </button>
        ))}
      </div>

      <button onClick={() => onTab('request')}
        className="w-full rounded-2xl bg-violet-500 text-white h-12 font-semibold text-sm hover:bg-violet-600 transition-colors active:scale-[0.98]">
        + Request New Property Inspection
      </button>

      <div className="rounded-2xl bg-[#12121A]/60 border border-white/[0.04] p-4">
        <h3 className="text-xs font-semibold text-white mb-2">How It Works</h3>
        <ol className="space-y-2">
          {[
            'Request inspection — Fill property details, upload photos',
            'WeHouse reviews — Admin assigns a field officer to inspect',
            'Field inspection — Our staff visits, verifies, photographs',
            'Approved & listed — Your property goes public on WeHouse',
            'Manage bookings — Track reservations, earnings, all in one place',
          ].map((s, i) => (
            <li key={i} className="flex items-start gap-2 text-[10px] text-[#8A8B9C]">
              <span className="w-5 h-5 rounded-full bg-violet-500/10 text-violet-400 flex items-center justify-center text-[9px] font-bold flex-shrink-0">{i + 1}</span>
              {s}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// MY PROPERTIES TAB
// ═══════════════════════════════════════════════════════════════

function PropertiesTab({ partnerId }: { partnerId: string | null }) {
  const [properties, setProperties] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!partnerId) { setLoading(false); return; }
    async function load() {
      const { data } = await supabase.from('properties').select('*').eq('partner_id', partnerId).order('created_at', { ascending: false });
      setProperties(data || []);
      setLoading(false);
    }
    load();
  }, [partnerId]);

  if (loading) return <Spinner />;
  if (!properties.length) return <Empty title="No properties yet" desc="Submit an inspection request. Once approved by WeHouse staff, your properties will appear here." />;

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold text-[#5C5E72] uppercase tracking-wider">Listed Properties ({properties.length})</h3>
      {properties.map(p => (
        <div key={p.id} className="rounded-2xl bg-[#12121A]/60 border border-white/[0.04] overflow-hidden">
          <div className="h-32 bg-[#1A1A24] relative">
            {p.images?.length > 0 ? (
              <img src={p.images[0]} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-[#5C5E72] text-xs">No photo yet</div>
            )}
            <span className={`absolute top-2 right-2 text-[8px] px-2 py-0.5 rounded-full font-semibold ${
              p.status === 'approved' || p.status === 'active' ? 'bg-emerald-500/20 text-emerald-400' :
              p.status === 'pending' ? 'bg-amber-500/20 text-amber-400' :
              'bg-red-500/20 text-red-400'
            }`}>{p.status || 'pending'}</span>
          </div>
          <div className="p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-white truncate">{p.title || p.address || 'Untitled Property'}</p>
            </div>
            <p className="text-[10px] text-[#5C5E72]">{p.city}, {p.state} · {p.property_type}{p.sub_type ? ` (${p.sub_type === 'short_let' ? 'Short Let' : 'Long Stay'})` : ''}</p>
            {p.amenities?.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {p.amenities.slice(0, 4).map((a: string) => (
                  <span key={a} className="text-[8px] px-1.5 py-0.5 rounded bg-[#1A1A24] text-[#5C5E72]">{a.replace(/_/g, ' ')}</span>
                ))}
                {p.amenities.length > 4 && <span className="text-[8px] text-[#5C5E72]">+{p.amenities.length - 4} more</span>}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// REQUEST INSPECTION TAB
// ═══════════════════════════════════════════════════════════════

interface DraftProperty {
  id: string;
  category: PropertyCategory;
  sub_type: ApartmentSub | '';
  property_state: string;
  property_city: string;
  property_address: string;
  bedrooms: string;
  bathrooms: string;
  expected_rent: string;
  description: string;
  amenities: string[];
  photoUrls: string[];
  uploading: boolean;
}

function RequestInspectionTab({ partnerId, onSubmitted }: { partnerId: string | null; onSubmitted?: () => void }) {
  const [properties, setProperties] = useState<DraftProperty[]>([]);
  const [draft, setDraft] = useState<DraftProperty>({
    id: '', category: 'apartment', sub_type: '', property_state: '', property_city: '',
    property_address: '', bedrooms: '1', bathrooms: '1', expected_rent: '',
    description: '', amenities: [], photoUrls: [], uploading: false,
  });
  const [submitting, setSubmitting] = useState(false);
  // Phone is taken from profile, editable per-property in description

  const availableLgas = draft.property_state ? getCitiesForState(draft.property_state) : [];

  const resetDraft = () => setDraft({
    id: '', category: 'apartment', sub_type: '', property_state: '', property_city: '',
    property_address: '', bedrooms: '1', bathrooms: '1', expected_rent: '',
    description: '', amenities: [], photoUrls: [], uploading: false,
  });

  const toggleAmenity = (key: string) => {
    setDraft(d => ({
      ...d,
      amenities: d.amenities.includes(key) ? d.amenities.filter(a => a !== key) : [...d.amenities, key],
    }));
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setDraft(d => ({ ...d, uploading: true }));
    const newUrls: string[] = [];
    for (const file of Array.from(files)) {
      const path = `inspection-photos/${Date.now()}-${Math.random().toString(36).slice(2)}.${file.name.split('.').pop()}`;
      const { error } = await supabase.storage.from('listings').upload(path, file);
      if (!error) {
        const { data } = supabase.storage.from('listings').getPublicUrl(path);
        newUrls.push(data.publicUrl);
      }
    }
    setDraft(d => ({ ...d, photoUrls: [...d.photoUrls, ...newUrls], uploading: false }));
  };

  const addProperty = () => {
    if (!draft.property_address || !draft.property_state || !draft.property_city) {
      toast.error('Fill in state, LGA, and street address');
      return;
    }
    if (draft.category === 'apartment' && !draft.sub_type) {
      toast.error('Select Short Let or Long Stay');
      return;
    }
    setProperties(prev => [...prev, { ...draft, id: crypto.randomUUID() }]);
    resetDraft();
    toast.success('Property added to batch!');
  };

  const removeProperty = (id: string) => setProperties(prev => prev.filter(p => p.id !== id));
  const removePhoto = (url: string) => setDraft(d => ({ ...d, photoUrls: d.photoUrls.filter(u => u !== url) }));

  const submitAll = async () => {
    if (properties.length === 0) { toast.error('Add at least one property'); return; }
    if (!partnerId) { toast.error('Partner account not found'); return; }
    setSubmitting(true);

    const inserts = properties.map(p => ({
      partner_id: partnerId,
      property_type: p.category === 'apartment' ? `apartment_${p.sub_type}` : 'hotel',
      property_address: p.property_address,
      property_city: p.property_city,
      property_state: p.property_state,
      bedrooms: parseInt(p.bedrooms) || null,
      bathrooms: parseInt(p.bathrooms) || null,
      expected_rent: p.expected_rent ? parseFloat(p.expected_rent) : null,
      description: p.description,
      amenities: p.amenities,
      photo_urls: p.photoUrls,
      status: 'pending' as const,
    }));

    const { error } = await supabase.from('inspection_requests').insert(inserts);
    setSubmitting(false);

    if (error) { toast.error('Failed: ' + error.message); return; }

    toast.success(`${properties.length} inspection request(s) submitted! WeHouse will assign a field officer.`);
    setProperties([]);
    resetDraft();
    onSubmitted?.();
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-gradient-to-br from-violet-500/10 to-violet-600/5 border border-violet-500/20 p-4">
        <h3 className="text-sm font-semibold text-white">Request Property Inspection</h3>
        <p className="text-[10px] text-[#5C5E72] mt-1">
          Add all properties you want inspected. WeHouse staff will visit each one.
        </p>
      </div>

      {/* Batch List */}
      {properties.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-[#8B8DA0] uppercase tracking-wider">Added ({properties.length})</h4>
          {properties.map(p => (
            <div key={p.id} className="rounded-xl bg-[#12121A]/80 border border-violet-500/10 p-3 flex items-center gap-3">
              {p.photoUrls[0] ? (
                <img src={p.photoUrls[0]} alt="" className="w-10 h-10 rounded-lg object-cover" />
              ) : (
                <div className="w-10 h-10 rounded-lg bg-violet-500/10 flex items-center justify-center text-sm">
                  {p.category === 'hotel' ? '🏨' : p.sub_type === 'short_let' ? '⏱' : '🏠'}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-white truncate">{p.property_address}</p>
                <p className="text-[9px] text-[#5C5E72]">{p.property_city}, {p.property_state} · {p.category === 'hotel' ? 'Hotel' : p.sub_type === 'short_let' ? 'Short Let' : 'Long Stay'}</p>
              </div>
              <button onClick={() => removeProperty(p.id)} className="text-[10px] text-red-400 hover:text-red-300 px-2 py-1">Remove</button>
            </div>
          ))}
        </div>
      )}

      {/* Draft Form */}
      <div className="rounded-2xl bg-[#12121A]/40 border border-white/[0.04] p-4 space-y-4">
        <h4 className="text-xs font-semibold text-white">Property {properties.length + 1}</h4>

        {/* Category: Apartment vs Hotel */}
        <div>
          <label className="text-[11px] text-[#8B8DA0] mb-2 block font-medium">Property Category *</label>
          <div className="grid grid-cols-2 gap-2">
            {[
              { value: 'apartment' as PropertyCategory, label: 'Apartment', icon: '🏢', desc: 'Short Let or Long Stay' },
              { value: 'hotel' as PropertyCategory, label: 'Hotel', icon: '🏨', desc: 'Hotel / Guest House' },
            ].map(cat => (
              <button key={cat.value} type="button"
                onClick={() => setDraft(d => ({ ...d, category: cat.value, sub_type: '' }))}
                className={`rounded-xl border p-3 text-center transition-all ${draft.category === cat.value ? 'border-violet-500 bg-violet-500/10' : 'border-[#232330] bg-[#1A1A24] hover:border-violet-500/30'}`}>
                <span className="text-xl">{cat.icon}</span>
                <p className={`text-xs font-semibold mt-1 ${draft.category === cat.value ? 'text-violet-400' : 'text-white'}`}>{cat.label}</p>
                <p className="text-[9px] text-[#5C5E72]">{cat.desc}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Sub-type: Short Let / Long Stay (only for apartments) */}
        {draft.category === 'apartment' && (
          <div>
            <label className="text-[11px] text-[#8B8DA0] mb-2 block font-medium">Apartment Type *</label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { value: 'short_let' as ApartmentSub, label: 'Short Let', desc: 'Daily / Weekly rental' },
                { value: 'long_stay' as ApartmentSub, label: 'Long Stay', desc: 'Monthly / Yearly rental' },
              ].map(st => (
                <button key={st.value} type="button"
                  onClick={() => setDraft(d => ({ ...d, sub_type: st.value }))}
                  className={`rounded-xl border p-3 text-center transition-all ${draft.sub_type === st.value ? 'border-violet-500 bg-violet-500/10' : 'border-[#232330] bg-[#1A1A24]'}`}>
                  <p className={`text-xs font-semibold ${draft.sub_type === st.value ? 'text-violet-400' : 'text-white'}`}>{st.label}</p>
                  <p className="text-[9px] text-[#5C5E72]">{st.desc}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Location: State → LGA → Address */}
        <div className="space-y-3">
          <Select label="State *" value={draft.property_state}
            onChange={v => setDraft(d => ({ ...d, property_state: v, property_city: '' }))}
            options={[{ value: '', label: 'Select State' }, ...NIGERIA_STATES.map(s => ({ value: s.state, label: s.state }))]} />

          <Select label="Local Government (LGA) *" value={draft.property_city}
            onChange={v => setDraft(d => ({ ...d, property_city: v }))}
            disabled={!draft.property_state}
            options={[{ value: '', label: draft.property_state ? 'Select LGA' : 'Select state first' }, ...availableLgas.map(l => ({ value: l, label: l }))]} />

          <Input label="Full Street Address *" value={draft.property_address}
            onChange={v => setDraft(d => ({ ...d, property_address: v }))}
            placeholder="e.g. 15 Adeola Odeku Street, Block B, Flat 3" />
        </div>

        {/* Bedrooms / Bathrooms */}
        <div className="grid grid-cols-2 gap-3">
          <Select label="Bedrooms" value={draft.bedrooms}
            onChange={v => setDraft(d => ({ ...d, bedrooms: v }))}
            options={[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => ({ value: String(n), label: String(n) }))} />
          <Select label="Bathrooms" value={draft.bathrooms}
            onChange={v => setDraft(d => ({ ...d, bathrooms: v }))}
            options={[1, 2, 3, 4, 5, 6].map(n => ({ value: String(n), label: String(n) }))} />
        </div>

        {/* Expected Rent */}
        <Input label="Expected Rent (N/year)" value={draft.expected_rent}
          onChange={v => setDraft(d => ({ ...d, expected_rent: v }))}
          placeholder="e.g. 1500000" type="number" />

        {/* Amenities */}
        <div>
          <label className="text-[11px] text-[#8B8DA0] mb-2 block font-medium">Amenities Available</label>
          <div className="grid grid-cols-2 gap-2">
            {AMENITIES.map(a => (
              <button key={a.key} type="button" onClick={() => toggleAmenity(a.key)}
                className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left transition-all ${
                  draft.amenities.includes(a.key) ? 'border-violet-500/50 bg-violet-500/10' : 'border-[#232330] bg-[#1A1A24]'
                }`}>
                <div className={`w-3.5 h-3.5 rounded-sm border flex items-center justify-center ${
                  draft.amenities.includes(a.key) ? 'bg-violet-500 border-violet-500' : 'border-[#5C5E72]'
                }`}>
                  {draft.amenities.includes(a.key) && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><path d="M5 12l5 5L20 7" /></svg>}
                </div>
                <span className={`text-[10px] ${draft.amenities.includes(a.key) ? 'text-violet-400' : 'text-[#8A8B9C]'}`}>{a.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Photo Upload */}
        <div>
          <label className="text-[11px] text-[#8B8DA0] mb-2 block font-medium">Property Photos</label>
          <div className="flex flex-wrap gap-2 mb-2">
            {draft.photoUrls.map(url => (
              <div key={url} className="relative w-16 h-16 rounded-xl overflow-hidden">
                <img src={url} alt="" className="w-full h-full object-cover" />
                <button onClick={() => removePhoto(url)} className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-red-500 text-white flex items-center justify-center text-[8px]">x</button>
              </div>
            ))}
          </div>
          <label className={`flex items-center justify-center gap-2 h-10 rounded-xl border border-dashed cursor-pointer transition-colors ${
            draft.uploading ? 'border-amber-500/30 text-amber-400' : 'border-violet-500/30 text-violet-400 hover:bg-violet-500/10'
          }`}>
            <input type="file" accept="image/*" multiple className="hidden" onChange={handlePhotoUpload} />
            <span className="text-xs font-semibold">{draft.uploading ? 'Uploading...' : '+ Add Photos'}</span>
          </label>
        </div>

        {/* Description */}
        <TextArea label="Description" value={draft.description}
          onChange={v => setDraft(d => ({ ...d, description: v }))}
          placeholder="Tell us about this property... What makes it special?" rows={3} />

        {/* Add to Batch Button */}
        <button type="button" onClick={addProperty}
          className="w-full h-10 rounded-xl border border-dashed border-violet-500/30 text-violet-400 text-sm font-semibold hover:bg-violet-500/10 transition-colors">
          + Add to Batch
        </button>
      </div>

      {/* Submit */}
      <button onClick={submitAll} disabled={submitting || properties.length === 0}
        className="w-full h-12 rounded-xl bg-violet-500 text-white font-semibold hover:bg-violet-600 transition-colors disabled:opacity-40 active:scale-[0.98]">
        {submitting ? 'Submitting...' : properties.length === 0 ? 'Add Properties Above' : `Submit ${properties.length} Property Request(s)`}
      </button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// MY REQUESTS TAB
// ═══════════════════════════════════════════════════════════════

function RequestsTab({ partnerId }: { partnerId: string | null }) {
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!partnerId) { setLoading(false); return; }
    load();
  }, [partnerId]);

  async function load() {
    const { data } = await supabase.from('inspection_requests').select('*').eq('partner_id', partnerId).order('created_at', { ascending: false });
    setRequests(data || []);
    setLoading(false);
  }

  if (loading) return <Spinner />;
  if (!requests.length) return <Empty title="No requests yet" desc="Submit your first property inspection request to get started." />;

  const statusMap: Record<string, { color: string; label: string }> = {
    pending: { color: 'bg-amber-500/10 text-amber-400', label: 'Pending' },
    scheduled: { color: 'bg-blue-500/10 text-blue-400', label: 'Scheduled' },
    in_progress: { color: 'bg-purple-500/10 text-purple-400', label: 'In Progress' },
    approved: { color: 'bg-emerald-500/10 text-emerald-400', label: 'Approved' },
    rejected: { color: 'bg-red-500/10 text-red-400', label: 'Rejected' },
    completed: { color: 'bg-emerald-500/10 text-emerald-400', label: 'Completed' },
  };

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold text-[#5C5E72] uppercase tracking-wider">Inspection Requests ({requests.length})</h3>
      {requests.map(r => {
        const s = statusMap[r.status] || statusMap.pending;
        return (
          <div key={r.id} className="rounded-2xl bg-[#12121A]/60 border border-white/[0.04] overflow-hidden">
            {r.photo_urls?.length > 0 && (
              <div className="h-24 bg-[#1A1A24]">
                <img src={r.photo_urls[0]} alt="" className="w-full h-full object-cover" />
              </div>
            )}
            <div className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <span className={`text-[8px] px-1.5 py-0.5 rounded-full ${s.color}`}>{s.label}</span>
                {r.scheduled_date && <span className="text-[8px] text-blue-400">Scheduled: {r.scheduled_date}</span>}
              </div>
              <p className="text-sm font-semibold text-white">{r.property_address}</p>
              <p className="text-[10px] text-[#5C5E72]">{r.property_city}, {r.property_state} · {r.property_type?.replace('apartment_', 'Apartment - ').replace('short_let', 'Short Let').replace('long_stay', 'Long Stay').replace('hotel', 'Hotel')}</p>
              {r.amenities?.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {r.amenities.slice(0, 5).map((a: string) => (
                    <span key={a} className="text-[8px] px-1.5 py-0.5 rounded bg-[#1A1A24] text-[#5C5E72]">{a.replace(/_/g, ' ')}</span>
                  ))}
                </div>
              )}
              {r.notes && <p className="text-[10px] text-[#5C5E72] mt-2 italic">Note: {r.notes}</p>}
              {r.rejection_reason && <p className="text-[10px] text-red-400 mt-2">Reason: {r.rejection_reason}</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// BOOKINGS TAB
// ═══════════════════════════════════════════════════════════════

function BookingsTab({ partnerId }: { partnerId: string | null }) {
  const [bookings, setBookings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!partnerId) { setLoading(false); return; }
    async function load() {
      const { data } = await supabase.from('bookings').select('*').eq('partner_id', partnerId).order('created_at', { ascending: false });
      setBookings(data || []);
      setLoading(false);
    }
    load();
  }, [partnerId]);

  if (loading) return <Spinner />;
  if (!bookings.length) return <Empty title="No bookings yet" desc="Bookings will appear here once users start reserving your listed properties." />;

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold text-[#5C5E72] uppercase tracking-wider">Bookings ({bookings.length})</h3>
      {bookings.map(b => (
        <div key={b.id} className="rounded-2xl bg-[#12121A]/60 border border-white/[0.04] p-4">
          <div className="flex items-center justify-between mb-1">
            <p className="text-sm font-semibold text-white">{b.booking_code || 'Booking'}</p>
            <span className={`text-[8px] px-1.5 py-0.5 rounded-full ${
              b.status === 'confirmed' ? 'bg-emerald-500/10 text-emerald-400' :
              b.status === 'pending' ? 'bg-amber-500/10 text-amber-400' :
              'bg-red-500/10 text-red-400'
            }`}>{b.status}</span>
          </div>
          <p className="text-[10px] text-[#5C5E72]">Check-in: {b.check_in} · {b.nights} night(s)</p>
          <p className="text-[10px] text-[#5C5E72]">Guest: {b.guest_name || '—'} · {b.guest_phone || '—'}</p>
          <p className="text-xs font-semibold text-white mt-2">N{(b.total_amount || 0).toLocaleString()}</p>
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// EARNINGS TAB
// ═══════════════════════════════════════════════════════════════

function EarningsTab({ partnerId }: { partnerId: string | null }) {
  const [payouts, setPayouts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!partnerId) { setLoading(false); return; }
    async function load() {
      const { data } = await supabase.from('property_payouts').select('*').eq('partner_id', partnerId).order('created_at', { ascending: false });
      setPayouts(data || []);
      setLoading(false);
    }
    load();
  }, [partnerId]);

  if (loading) return <Spinner />;
  const totalPaid = payouts.filter(p => p.status === 'paid').reduce((s, p) => s + (p.amount || 0), 0);
  const totalPending = payouts.filter(p => p.status === 'pending').reduce((s, p) => s + (p.amount || 0), 0);

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

      <h3 className="text-xs font-semibold text-[#5C5E72] uppercase tracking-wider">Payout History ({payouts.length})</h3>
      {!payouts.length ? <Empty title="No payouts yet" desc="Earnings appear here once WeHouse processes bookings on your properties." /> : payouts.map(p => (
        <div key={p.id} className="rounded-2xl bg-[#12121A]/60 border border-white/[0.04] p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-white">{p.payout_code || 'Payout'}</p>
            <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${p.status === 'paid' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'}`}>{p.status}</span>
          </div>
          <p className="text-sm font-bold text-white mt-1">N{(p.amount || 0).toLocaleString()}</p>
          <p className="text-[10px] text-[#5C5E72]">{p.period_start} to {p.period_end}</p>
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// SHARED COMPONENTS
// ═══════════════════════════════════════════════════════════════

function Input({ label, value, onChange, placeholder, type = 'text' }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) {
  return (
    <div>
      <label className="text-[11px] text-[#8B8DA0] mb-1.5 block font-medium">{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="w-full h-10 rounded-xl bg-[#1A1A24] border border-[#232330] text-white text-sm px-4 placeholder:text-[#5C5E72] outline-none focus:border-violet-500" />
    </div>
  );
}

function Select({ label, value, onChange, options, disabled = false }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; disabled?: boolean }) {
  return (
    <div>
      <label className="text-[11px] text-[#8B8DA0] mb-1.5 block font-medium">{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)} disabled={disabled}
        className="w-full h-10 rounded-xl bg-[#1A1A24] border border-[#232330] text-white text-sm px-4 outline-none focus:border-violet-500 disabled:opacity-40">
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

function TextArea({ label, value, onChange, placeholder, rows = 3 }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; rows?: number }) {
  return (
    <div>
      <label className="text-[11px] text-[#8B8DA0] mb-1.5 block font-medium">{label}</label>
      <textarea value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={rows}
        className="w-full rounded-xl bg-[#1A1A24] border border-[#232330] text-white text-sm px-4 py-3 placeholder:text-[#5C5E72] outline-none focus:border-violet-500 resize-none" />
    </div>
  );
}

function Spinner() {
  return <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" /></div>;
}

function Empty({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="text-center py-10">
      <div className="w-12 h-12 rounded-2xl bg-[#1A1A24] flex items-center justify-center mx-auto mb-3">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#5C5E72" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></svg>
      </div>
      <p className="text-sm font-semibold text-[#5C5E72]">{title}</p>
      <p className="text-[10px] text-[#5C5E72] mt-1 max-w-[200px] mx-auto">{desc}</p>
    </div>
  );
}
