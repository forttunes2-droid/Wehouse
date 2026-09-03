import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/types';
import PropertyInspectionRequestPanel from './PropertyInspectionRequestPanel';
import PropertyMediaCarousel from './PropertyMediaCarousel';
import BackButton from '@/components/BackButton';

type RequestRow = {
  id: string;
  request_code: string | null;
  property_address: string | null;
  property_type: string | null;
  sub_type: string | null;
  property_state: string | null;
  property_city: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  expected_rent: number | null;
  security_deposit_amount: number | null;
  description: string | null;
  photo_urls: string[] | null;
  gps_latitude: number | null;
  gps_longitude: number | null;
  location_accuracy_m: number | null;
  status: string | null;
  created_at: string | null;
  scheduled_date: string | null;
  completed_at: string | null;
  draft_listing_id: string | null;
  draft_hotel_id: number | null;
  published_at: string | null;
  notes: string | null;
  rejection_reason: string | null;
  submission_batch_id: string | null;
  submission_batch_position: number | null;
  authority_relationship: string | null;
  access_evidence_status: string | null;
};

const fields = 'id,request_code,property_address,property_type,sub_type,property_state,property_city,bedrooms,bathrooms,expected_rent,security_deposit_amount,description,photo_urls,gps_latitude,gps_longitude,location_accuracy_m,status,created_at,scheduled_date,completed_at,draft_listing_id,draft_hotel_id,published_at,notes,rejection_reason,submission_batch_id,submission_batch_position,authority_relationship,access_evidence_status';

export default function PartnerSubmittedRequests({ profile }: { profile: Profile }) {
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [selected, setSelected] = useState<RequestRow | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    const { data, error } = await supabase.from('inspection_requests').select(fields).eq('owner_id', profile.user_id).order('created_at', { ascending: false });
    if (error) {
      toast.error(error.message || 'Unable to load property requests');
      setRequests([]);
    } else {
      setRequests((data || []) as RequestRow[]);
    }
    setLoading(false);
  }

  useEffect(() => {
    let active = true;
    void (async () => {
      const { data, error } = await supabase.from('inspection_requests').select(fields).eq('owner_id', profile.user_id).order('created_at', { ascending: false });
      if (!active) return;
      if (error) {
        toast.error(error.message || 'Unable to load property requests');
        setRequests([]);
      } else {
        setRequests((data || []) as RequestRow[]);
      }
      setLoading(false);
    })();
    return () => { active = false; };
  }, [profile.user_id]);

  const batchCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const request of requests) if (request.submission_batch_id) counts.set(request.submission_batch_id, (counts.get(request.submission_batch_id) || 0) + 1);
    return counts;
  }, [requests]);

  function contact(request: RequestRow) {
    window.dispatchEvent(new CustomEvent('openSupportChat', { detail: {
      category: 'property_inspection',
      subject: `Property inspection ${request.request_code || ''}`.trim(),
      contextType: 'property_inspection',
      contextId: request.id,
      contextSnapshot: { request_code: request.request_code, property_address: request.property_address, property_type: request.property_type, city: request.property_city, state: request.property_state, status: request.status },
    } }));
  }

  if (selected) return <RequestDetail request={selected} onBack={() => setSelected(null)} onContact={() => contact(selected)} />;

  return <div className="space-y-6">
    <PropertyInspectionRequestPanel profile={profile} />
    <section>
      <div className="mb-3 flex items-center justify-between gap-3"><div><h2 className="text-sm font-semibold">Your submitted properties</h2><p className="mt-1 text-[10px] text-[#66687B]">Open a property to see its details, photos, inspection stage and updates.</p></div><button type="button" onClick={() => void refresh()} className="rounded-lg border border-white/[.07] px-3 py-2 text-[9px] text-[#888A9B]">Refresh</button></div>
      {loading ? <Loader /> : requests.length === 0 ? <Empty /> : <div className="space-y-3">{requests.map(request => <button key={request.id} type="button" onClick={() => setSelected(request)} className="flex w-full items-center gap-3 rounded-2xl border border-white/[.06] bg-[#111119] p-3 text-left transition active:scale-[.99] sm:p-4">
        <div className="h-20 w-24 shrink-0 overflow-hidden rounded-xl bg-[#191A24]">{request.photo_urls?.[0] ? <img src={request.photo_urls[0]} alt="" className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center text-[9px] text-[#595C6D]">No photo</div>}</div>
        <div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-2"><p className="truncate text-xs font-semibold">{request.property_address || request.property_type || 'Property'}</p><Status request={request} /></div><p className="mt-1 truncate text-[9px] text-[#696C7D]">{[request.property_city, request.property_state].filter(Boolean).join(', ')}</p><div className="mt-2 flex flex-wrap items-center gap-2 text-[8px] text-[#777A8B]"><span>{request.request_code || 'Request sent'}</span>{request.submission_batch_id && Number(batchCounts.get(request.submission_batch_id) || 0) > 1 && <span className="rounded-full bg-violet-500/10 px-2 py-1 text-violet-300">Batch {request.submission_batch_position}/{batchCounts.get(request.submission_batch_id)}</span>}<span className="ml-auto text-violet-300">View details →</span></div></div>
      </button>)}</div>}
    </section>
  </div>;
}

function RequestDetail({request, onBack, onContact }: { request: RequestRow; onBack: () => void; onContact: () => void }) {
  const images = request.photo_urls || [];
  const stopped = request.status === 'rejected';
  const progress = stopped ? 0 : request.published_at ? 5 : (request.draft_listing_id || request.draft_hotel_id) ? 4 : request.completed_at || ['completed','approved'].includes(request.status || '') ? 3 : request.scheduled_date || ['scheduled','in_progress'].includes(request.status || '') ? 2 : 1;
  const steps = ['Received', 'Inspection', 'Visit reviewed', 'Listing prepared', 'Public'];
  return <div className="space-y-5">
    <div className="flex items-center gap-3"><BackButton onClick={onBack}/><span className="text-xs text-[#A1A3B1]">Submitted properties</span></div>
    <section className="overflow-hidden rounded-3xl border border-white/[.06] bg-[#111119]">
      {images.length > 0 ? <PropertyMediaCarousel images={images} title={request.property_address || 'Submitted property'} /> : <div className="grid aspect-[16/8] place-items-center bg-gradient-to-br from-violet-500/10 to-transparent text-[10px] text-[#696D7D]">No property media supplied</div>}
      <div className="p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-[9px] font-semibold uppercase tracking-[.16em] text-violet-300">{request.request_code || 'Property request'}</p><h2 className="mt-2 text-xl font-bold">{request.property_address || 'Submitted property'}</h2><p className="mt-1 text-[10px] text-[#747789]">{[request.property_city, request.property_state].filter(Boolean).join(', ')}</p></div><Status request={request} /></div>
      <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4"><Info label="Type" value={friendly(request.property_type)} /><Info label="Stay" value={friendly(request.sub_type)} /><Info label="Bedrooms" value={request.bedrooms ?? '—'} /><Info label="Bathrooms" value={request.bathrooms ?? '—'} /></div>
      <div className="mt-2"><Info label="Your relationship" value={friendly(request.authority_relationship)} /></div>
      {request.description && <div className="mt-4"><p className="text-[9px] uppercase tracking-wide text-[#66697A]">Property details</p><p className="mt-2 whitespace-pre-wrap text-xs leading-6 text-[#A5A7B3]">{request.description}</p></div>}
      </div>
    </section>
    <AccessEvidenceSummary status={request.access_evidence_status} />
    <section className="rounded-3xl border border-white/[.06] bg-[#111119] p-5"><div className="flex items-start justify-between gap-3"><div><h3 className="text-sm font-semibold">Journey to publication</h3><p className="mt-1 text-[9px] text-[#696D7D]">Access evidence and the independent WeHouse visit must both pass before publication.</p></div><span className={`rounded-full px-2 py-1 text-[8px] font-semibold ${stopped ? 'bg-red-500/10 text-red-300' : 'bg-violet-500/10 text-violet-300'}`}>{stopped ? 'Stopped' : `${progress} of 5`}</span></div><div className="mt-5 grid grid-cols-5 gap-1">{steps.map((label, index) => <div key={label} className="min-w-0 text-center"><div className={`mx-auto grid h-8 w-8 place-items-center rounded-full text-[9px] font-bold ${progress > index ? (progress === 5 ? 'bg-emerald-500 text-white' : 'bg-violet-500 text-white') : 'bg-white/[.05] text-[#5F6272]'}`}>{progress > index ? '✓' : index + 1}</div><p className={`mt-2 break-words text-[7px] leading-tight sm:text-[8px] ${progress > index ? 'text-[#CFD0D9]' : 'text-[#5F6272]'}`}>{label}</p></div>)}</div>{request.scheduled_date && <p className="mt-4 rounded-xl bg-violet-500/[.06] p-3 text-[10px] text-violet-200">Inspection visit: {new Date(request.scheduled_date).toLocaleString()}</p>}{!stopped && progress < 5 && <p className="mt-3 text-[9px] leading-5 text-[#777C8D]">{progress === 1 ? 'Next: complete access evidence, then WeHouse assigns a Field Officer.' : progress === 2 ? 'Next: the Field Officer submits independent visit evidence.' : progress === 3 ? 'Next: WeHouse prepares the public listing details.' : 'Next: an Admin or Creator performs the final check and publishes it.'}</p>}{progress === 5 && <p className="mt-3 text-[9px] font-semibold text-emerald-300">This property is now public on WeHouse.</p>}</section>
    {(request.notes || request.rejection_reason) && <section className="rounded-2xl border border-white/[.06] bg-[#111119] p-4"><p className="text-[9px] uppercase tracking-wide text-[#66697A]">Latest WeHouse update</p><p className="mt-2 text-xs leading-6 text-[#A5A7B3]">{request.rejection_reason || request.notes}</p></section>}
    {(request.gps_latitude != null && request.gps_longitude != null) && <section className="rounded-2xl border border-violet-500/15 bg-violet-500/[.04] p-4"><p className="text-xs font-semibold">Property coordinates supplied</p><p className="mt-1 text-[10px] text-[#777E90]">{request.gps_latitude.toFixed(6)}, {request.gps_longitude.toFixed(6)}{request.location_accuracy_m ? ` · ±${Math.round(request.location_accuracy_m)}m` : ''}</p></section>}
    <button type="button" onClick={onContact} className="h-12 w-full rounded-xl border border-violet-500/20 bg-violet-500/[.08] text-xs font-semibold text-violet-200">Ask Support about this property</button>
  </div>;
}

function AccessEvidenceSummary({status}:{status:string|null}) {
  const verified=status==='verified';
  const rejected=status==='rejected';
  return <section className={`rounded-2xl border p-4 ${verified?'border-emerald-500/15 bg-emerald-500/[.04]':rejected?'border-amber-500/15 bg-amber-500/[.04]':'border-white/[.06] bg-[#111119]'}`}>
    <div className="flex items-center gap-3"><span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${verified?'bg-emerald-500/15 text-emerald-300':rejected?'bg-amber-500/15 text-amber-300':'bg-violet-500/10 text-violet-300'}`}>{verified?'✓':rejected?'!':'•'}</span><div><p className="text-xs font-semibold">{verified?'Property access confirmed':rejected?'New access evidence required':'Private access recording received'}</p><p className="mt-1 text-[9px] leading-4 text-[#74798A]">The temporary recording code was consumed during submission and is no longer displayed. {verified?'WeHouse accepted the private evidence.':rejected?'Open a correction request from the WeHouse update when instructed.':'WeHouse will review it before assigning the field visit.'}</p></div></div>
  </section>;
}

function Info({ label, value }: { label: string; value: string | number }) { return <div className="rounded-xl border border-white/[.06] bg-black/10 p-3"><p className="text-[8px] uppercase text-[#5F6273]">{label}</p><p className="mt-1 truncate text-[10px] font-semibold capitalize">{value || '—'}</p></div>; }
function Status({ request }: { request: RequestRow }) { const state=partnerState(request); return <span className={`shrink-0 rounded-full px-2 py-1 text-[8px] font-semibold ${state.tone}`}>{state.label}</span>; }
function partnerState(request:RequestRow){
  const status=String(request.status||'pending').toLowerCase();
  if(request.published_at)return{label:'Live',tone:'bg-emerald-500/10 text-emerald-300'};
  if(status==='rejected')return{label:'Rejected',tone:'bg-red-500/10 text-red-300'};
  if(status==='changes_requested')return{label:'Changes requested',tone:'bg-amber-500/10 text-amber-300'};
  if(request.draft_listing_id||request.draft_hotel_id)return{label:'Listing preparation',tone:'bg-violet-500/10 text-violet-300'};
  if(request.completed_at||['completed','approved'].includes(status))return{label:'Visit reviewed',tone:'bg-violet-500/10 text-violet-300'};
  if(request.scheduled_date||['scheduled','in_progress'].includes(status))return{label:'Inspection',tone:'bg-violet-500/10 text-violet-300'};
  if(request.access_evidence_status==='submitted')return{label:'Access review',tone:'bg-violet-500/10 text-violet-300'};
  return{label:'Under review',tone:'bg-amber-500/10 text-amber-300'};
}
function Loader() { return <div className="grid min-h-40 place-items-center"><div className="h-7 w-7 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" /></div>; }
function Empty() { return <div className="rounded-2xl border border-dashed border-white/[.08] px-5 py-12 text-center"><p className="text-sm font-semibold">No properties submitted yet</p><p className="mt-2 text-[10px] text-[#66697A]">Use Add properties above to send your first property.</p></div>; }
function friendly(value: string | null | undefined) { return String(value || '—').replace(/_/g, ' ').replace(/\b\w/g, character => character.toUpperCase()); }
