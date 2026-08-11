import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/types';

type RequestRow = {
  id: string;
  request_code: string;
  property_address: string;
  property_city: string;
  property_state: string;
  property_type: string | null;
  status: string | null;
  rejection_reason: string | null;
  scheduled_date: string | null;
  created_at: string | null;
  gps_latitude?: number | null;
  gps_longitude?: number | null;
  location_accuracy_m?: number | null;
};

type CapturedLocation = { latitude:number; longitude:number; accuracy:number | null };

const EMPTY_FORM = {
  propertyAddress: '',
  propertyCity: '',
  propertyState: '',
  propertyType: 'apartment',
  bedrooms: '1',
  bathrooms: '1',
  expectedRent: '',
  description: '',
  ownerPhone: '',
};

export default function PropertyInspectionRequestPanel({ profile }: { profile: Profile }) {
  const [expanded, setExpanded] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [locating, setLocating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [location, setLocation] = useState<CapturedLocation|null>(null);
  const [form, setForm] = useState({
    ...EMPTY_FORM,
    propertyCity: profile.city || profile.local_government || '',
    propertyState: profile.state || '',
    ownerPhone: profile.phone || '',
  });

  useEffect(() => { void loadRequests(); }, [profile.user_id]);

  async function loadRequests() {
    setLoading(true);
    const { data, error } = await supabase
      .from('inspection_requests')
      .select('id, request_code, property_address, property_city, property_state, property_type, status, rejection_reason, scheduled_date, created_at, gps_latitude, gps_longitude, location_accuracy_m')
      .eq('owner_id', profile.user_id)
      .order('created_at', { ascending: false });
    if (error) {
      console.error('[PropertyInspectionRequestPanel] load failed', error);
      toast.error('Unable to load your property requests');
    }
    setRequests((data || []) as RequestRow[]);
    setLoading(false);
  }

  function captureLocation() {
    if (!navigator.geolocation) return toast.error('Location is not supported on this device');
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      position => {
        setLocation({ latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null });
        setLocating(false);
        toast.success('Property location captured');
      },
      error => {
        setLocating(false);
        toast.error(error.code === 1 ? 'Location permission was denied' : 'Unable to capture property location');
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  }

  async function submitRequest(event: React.FormEvent) {
    event.preventDefault();
    if (!form.propertyAddress.trim()) return toast.error('Property address is required');
    if (!form.propertyState.trim()) return toast.error('State is required');
    if (!form.propertyCity.trim()) return toast.error('Local government/city is required');

    setSubmitting(true);
    const { error } = await supabase.rpc('create_my_property_inspection_request_v2', {
      p_property_address: form.propertyAddress.trim(),
      p_property_city: form.propertyCity.trim(),
      p_property_state: form.propertyState.trim(),
      p_property_type: form.propertyType,
      p_bedrooms: form.propertyType === 'hotel' ? null : Number(form.bedrooms || 0),
      p_bathrooms: form.propertyType === 'hotel' ? null : Number(form.bathrooms || 0),
      p_expected_rent: form.expectedRent ? Number(form.expectedRent) : null,
      p_description: form.description.trim() || null,
      p_owner_phone: form.ownerPhone.trim() || null,
      p_photo_urls: [],
      p_gps_latitude: location?.latitude ?? null,
      p_gps_longitude: location?.longitude ?? null,
      p_location_accuracy_m: location?.accuracy ?? null,
    });
    setSubmitting(false);
    if (error) return toast.error(error.message || 'Unable to submit property request');

    toast.success('Property request sent to WeHouse');
    setForm({ ...EMPTY_FORM, propertyCity: profile.city || profile.local_government || '', propertyState: profile.state || '', ownerPhone: profile.phone || '' });
    setLocation(null);
    setExpanded(false);
    await loadRequests();
  }

  const statusClass = (status: string | null) => {
    switch (status) {
      case 'approved': case 'completed': return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
      case 'rejected': return 'bg-red-500/10 text-red-400 border-red-500/20';
      case 'scheduled': case 'in_progress': return 'bg-blue-500/10 text-blue-400 border-blue-500/20';
      default: return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
    }
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-violet-500/15 bg-[#12121A]/60">
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between lg:p-5">
        <div>
          <p className="text-sm font-semibold text-white">Request a Property Listing</p>
          <p className="mt-1 max-w-xl text-[11px] text-[#8A8B9C]">Send the property details to WeHouse. WeHouse reviews and inspects it before any public listing is created.</p>
        </div>
        <button type="button" onClick={() => setExpanded(value => !value)} className="h-10 whitespace-nowrap rounded-xl bg-gradient-to-r from-violet-500 to-violet-700 px-4 text-xs font-semibold text-white">{expanded ? 'Close Form' : 'Submit Property'}</button>
      </div>

      {expanded && (
        <form onSubmit={submitRequest} className="space-y-4 border-t border-white/[0.05] p-4 lg:p-5">
          <div className="rounded-2xl border border-blue-500/15 bg-blue-500/[0.04] p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div><p className="text-xs font-semibold text-white">Property map location</p><p className="mt-1 text-[10px] leading-relaxed text-[#7F8497]">Stand at or near the property and capture its location. This is used for inspection distance, maps and nearby-property search. Your branch is still determined by State and LGA.</p></div>
              <button type="button" onClick={captureLocation} disabled={locating} className="shrink-0 rounded-xl border border-blue-400/20 bg-blue-500/10 px-4 py-2.5 text-[10px] font-semibold text-blue-300 disabled:opacity-50">{locating ? 'Locating…' : location ? 'Update location' : 'Use current location'}</button>
            </div>
            {location && <div className="mt-3 flex flex-wrap gap-2 text-[9px] text-[#9AA0B2]"><span className="rounded-lg bg-white/[0.04] px-2 py-1">Location captured</span>{location.accuracy != null && <span className="rounded-lg bg-white/[0.04] px-2 py-1">Accuracy ±{Math.round(location.accuracy)} m</span>}<a className="rounded-lg bg-white/[0.04] px-2 py-1 text-blue-300" target="_blank" rel="noreferrer" href={`https://www.openstreetmap.org/?mlat=${location.latitude}&mlon=${location.longitude}#map=18/${location.latitude}/${location.longitude}`}>Preview map ↗</a></div>}
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="space-y-1 md:col-span-2"><span className="text-[10px] text-[#8A8B9C]">Property address *</span><input value={form.propertyAddress} onChange={event => setForm(current => ({ ...current, propertyAddress: event.target.value }))} className="h-10 w-full rounded-xl border border-[#2A2A3A] bg-[#1A1A24] px-3 text-sm text-white outline-none focus:border-violet-500" placeholder="Full property address" /></label>
            <label className="space-y-1"><span className="text-[10px] text-[#8A8B9C]">State *</span><input value={form.propertyState} onChange={event => setForm(current => ({ ...current, propertyState: event.target.value }))} className="h-10 w-full rounded-xl border border-[#2A2A3A] bg-[#1A1A24] px-3 text-sm text-white outline-none focus:border-violet-500" placeholder="State" /></label>
            <label className="space-y-1"><span className="text-[10px] text-[#8A8B9C]">Local government/city *</span><input value={form.propertyCity} onChange={event => setForm(current => ({ ...current, propertyCity: event.target.value }))} className="h-10 w-full rounded-xl border border-[#2A2A3A] bg-[#1A1A24] px-3 text-sm text-white outline-none focus:border-violet-500" placeholder="LGA or city" /></label>
            <label className="space-y-1"><span className="text-[10px] text-[#8A8B9C]">Property group *</span><select value={form.propertyType} onChange={event => setForm(current => ({ ...current, propertyType: event.target.value }))} className="h-10 w-full rounded-xl border border-[#2A2A3A] bg-[#1A1A24] px-3 text-sm text-white outline-none focus:border-violet-500"><option value="apartment">Apartment</option><option value="hotel">Hotel</option></select></label>
            <label className="space-y-1"><span className="text-[10px] text-[#8A8B9C]">Phone for inspection</span><input value={form.ownerPhone} onChange={event => setForm(current => ({ ...current, ownerPhone: event.target.value }))} className="h-10 w-full rounded-xl border border-[#2A2A3A] bg-[#1A1A24] px-3 text-sm text-white outline-none focus:border-violet-500" placeholder="Phone number" /></label>
            {form.propertyType === 'apartment' && <><label className="space-y-1"><span className="text-[10px] text-[#8A8B9C]">Bedrooms</span><input type="number" min="0" value={form.bedrooms} onChange={event => setForm(current => ({ ...current, bedrooms: event.target.value }))} className="h-10 w-full rounded-xl border border-[#2A2A3A] bg-[#1A1A24] px-3 text-sm text-white outline-none focus:border-violet-500" /></label><label className="space-y-1"><span className="text-[10px] text-[#8A8B9C]">Bathrooms</span><input type="number" min="0" value={form.bathrooms} onChange={event => setForm(current => ({ ...current, bathrooms: event.target.value }))} className="h-10 w-full rounded-xl border border-[#2A2A3A] bg-[#1A1A24] px-3 text-sm text-white outline-none focus:border-violet-500" /></label></>}
            <label className="space-y-1"><span className="text-[10px] text-[#8A8B9C]">Expected rent/rate</span><input type="number" min="0" value={form.expectedRent} onChange={event => setForm(current => ({ ...current, expectedRent: event.target.value }))} className="h-10 w-full rounded-xl border border-[#2A2A3A] bg-[#1A1A24] px-3 text-sm text-white outline-none focus:border-violet-500" placeholder="Optional" /></label>
            <label className="space-y-1 md:col-span-2"><span className="text-[10px] text-[#8A8B9C]">Property details</span><textarea rows={4} value={form.description} onChange={event => setForm(current => ({ ...current, description: event.target.value }))} className="w-full resize-none rounded-xl border border-[#2A2A3A] bg-[#1A1A24] px-3 py-2 text-sm text-white outline-none focus:border-violet-500" placeholder="Apartment type, short let/long stay, hotel information, landmarks and any other details for WeHouse" /></label>
          </div>
          <button type="submit" disabled={submitting} className="h-11 w-full rounded-xl bg-gradient-to-r from-violet-500 to-violet-700 text-sm font-semibold text-white disabled:opacity-40">{submitting ? 'Submitting...' : 'Send Request to WeHouse'}</button>
        </form>
      )}

      <div className="border-t border-white/[0.05] p-4 lg:p-5">
        <div className="mb-3 flex items-center justify-between"><p className="text-xs font-semibold text-white">My Property Requests</p><button type="button" onClick={() => void loadRequests()} className="text-[10px] text-violet-400 hover:text-violet-300">Refresh</button></div>
        {loading ? <p className="text-[11px] text-[#5C5E72]">Loading requests...</p> : requests.length === 0 ? <p className="text-[11px] text-[#5C5E72]">No property requests submitted yet.</p> : <div className="space-y-2">{requests.slice(0, 5).map(request => <div key={request.id} className="rounded-xl border border-[#2A2A3A] bg-[#1A1A24] p-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-xs font-medium text-white">{request.property_address}</p><p className="mt-0.5 text-[9px] text-[#5C5E72]">{request.request_code} · {request.property_type || 'property'} · {request.property_city}, {request.property_state}</p></div><span className={`flex-shrink-0 rounded-full border px-2 py-1 text-[8px] capitalize ${statusClass(request.status)}`}>{request.status || 'pending'}</span></div>{request.gps_latitude != null && request.gps_longitude != null && <a target="_blank" rel="noreferrer" href={`https://www.openstreetmap.org/?mlat=${request.gps_latitude}&mlon=${request.gps_longitude}#map=18/${request.gps_latitude}/${request.gps_longitude}`} className="mt-2 inline-block text-[9px] text-blue-400">View submitted location ↗</a>}{request.scheduled_date && <p className="mt-2 text-[9px] text-blue-400">Inspection date: {new Date(request.scheduled_date).toLocaleDateString()}</p>}{request.rejection_reason && <p className="mt-2 text-[9px] text-red-400">Reason: {request.rejection_reason}</p>}</div>)}</div>}
      </div>
    </section>
  );
}