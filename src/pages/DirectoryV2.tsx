import { useEffect, useMemo, useState } from 'react';
import { Toaster, toast } from 'sonner';
import { getCategoryWithSubcategories, getWorkers, supabase } from '@/lib/supabase';
import { getUserActiveBookings } from '@/lib/supabase/worker-bookings';
import { NIGERIA_STATES, getCitiesForState } from '@/data/nigeria-locations';
import WorkerBookingRequestSheetV2 from '@/components/WorkerBookingRequestSheetV2';
import BookingNegotiationChat from '@/components/BookingNegotiationChat';
import WorkerPublicProfile from '@/components/WorkerPublicProfile';
import { WORKER_OCCUPATION_LABELS } from '@/types';
import type { Profile, ServiceCategory } from '@/types';

type Category = ServiceCategory & { subcategories: any[] };
type Props = {
  userCity?: string | null;
  profile?: Profile | null;
  onNavigate?: (page: string) => void;
  preSelectedCategory?: string | null;
};

type WorkStatus = {
  id: string;
  worker_id: string;
  media_type: 'image' | 'video';
  storage_path: string;
  caption: string | null;
  verified_job: boolean;
  expires_at: string;
  created_at: string;
  url?: string;
};

export default function DirectoryV2({ userCity, profile, onNavigate, preSelectedCategory }: Props) {
  const [workers, setWorkers] = useState<Profile[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [statuses, setStatuses] = useState<WorkStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [specialty, setSpecialty] = useState('');
  const [state, setState] = useState('');
  const [city, setCity] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [bookingWorker, setBookingWorker] = useState<Profile | null>(null);
  const [viewWorker, setViewWorker] = useState<Profile | null>(null);
  const [story, setStory] = useState<{ status: WorkStatus; worker: Profile } | null>(null);
  const [active, setActive] = useState<Set<string>>(new Set());
  const [chat, setChat] = useState<{ conversationId: string; bookingId: string } | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      const [{ workers: rows, error }, { categories: cats }] = await Promise.all([
        getWorkers(),
        getCategoryWithSubcategories().catch(() => ({ categories: [] } as any)),
      ]);
      if (!live) return;
      if (error) toast.error(error.message);
      setWorkers(rows || []);
      setCategories((cats || []) as Category[]);
      setLoading(false);
    })();
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    let live = true;
    void (async () => {
      const { data, error } = await supabase
        .from('worker_showcase_posts')
        .select('id,worker_id,media_type,storage_path,caption,verified_job,expires_at,created_at')
        .eq('kind', 'story')
        .is('deleted_at', null)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(30);
      if (!live || error) return;
      const enriched = await Promise.all(
        (data || []).map(async (row: any) => {
          const { data: signed } = await supabase.storage.from('worker-showcase').createSignedUrl(row.storage_path, 3600);
          return { ...row, url: signed?.signedUrl || '' } as WorkStatus;
        }),
      );
      if (live) setStatuses(enriched);
    })();
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!profile?.user_id) return;
    void getUserActiveBookings(profile.user_id).then(({ bookings }) =>
      setActive(new Set((bookings || []).map((row: any) => row.worker_id))),
    );
  }, [profile?.user_id]);

  useEffect(() => {
    if (!preSelectedCategory || !categories.length) return;
    const direct = categories.find((item) => item.name === preSelectedCategory);
    if (direct) {
      setCategory(direct.name);
      setSpecialty('');
      return;
    }
    const parent = categories.find((item) =>
      (item.subcategories || []).some((sub: any) => sub.name === preSelectedCategory),
    );
    if (parent) {
      setCategory(parent.name);
      setSpecialty(preSelectedCategory);
    }
  }, [preSelectedCategory, categories]);

  const selected = useMemo(() => categories.find((item) => item.name === category) || null, [categories, category]);
  const cities = useMemo(() => getCitiesForState(state), [state]);

  const liveWorkers = useMemo(
    () => workers.filter((worker) => worker.worker_status === 'verified' && worker.worker_verified === true && worker.available !== false),
    [workers],
  );

  const latestStatusByWorker = useMemo(() => {
    const map = new Map<string, WorkStatus>();
    statuses.forEach((status) => {
      if (!map.has(status.worker_id)) map.set(status.worker_id, status);
    });
    return map;
  }, [statuses]);

  const statusWorkers = useMemo(
    () => liveWorkers
      .map((worker) => ({ worker, status: latestStatusByWorker.get(worker.user_id) }))
      .filter((entry): entry is { worker: Profile; status: WorkStatus } => Boolean(entry.status)),
    [liveWorkers, latestStatusByWorker],
  );

  const shown = useMemo(
    () => liveWorkers
      .filter((worker) => {
        const hay = [
          worker.full_name || worker.username || '',
          worker.worker_occupation || '',
          worker.worker_bio || '',
          worker.city || '',
          worker.state || '',
          ...((worker.worker_skills as string[]) || []),
        ].join(' ').toLowerCase();
        const query = search.trim().toLowerCase();
        if (query && !hay.includes(query)) return false;
        if (category && ![(worker.worker_occupation || ''), ...((worker.worker_skills as string[]) || [])].join(' ').toLowerCase().includes(category.toLowerCase())) return false;
        if (specialty && !((worker.worker_skills as string[]) || []).some((skill) => skill.toLowerCase() === specialty.toLowerCase())) return false;
        if (state && String(worker.state || '').toLowerCase() !== state.toLowerCase() && !getCitiesForState(state).includes(worker.city || '')) return false;
        if (city && String(worker.city || worker.local_government || '').toLowerCase() !== city.toLowerCase()) return false;
        return true;
      })
      .sort((a, b) => {
        if (userCity) {
          const aLocal = String(a.city || a.local_government || '').toLowerCase() === userCity.toLowerCase();
          const bLocal = String(b.city || b.local_government || '').toLowerCase() === userCity.toLowerCase();
          if (aLocal !== bLocal) return aLocal ? -1 : 1;
        }
        const rating = Number(b.rating || 0) - Number(a.rating || 0);
        return rating || String(a.full_name || a.username || '').localeCompare(String(b.full_name || b.username || ''));
      }),
    [liveWorkers, search, category, specialty, state, city, userCity],
  );

  function clear() {
    setSearch('');
    setCategory('');
    setSpecialty('');
    setState('');
    setCity('');
  }

  function created(workerId: string, conversationId: string, bookingId: string) {
    setBookingWorker(null);
    setActive((current) => new Set(current).add(workerId));
    setChat({ conversationId, bookingId });
  }

  if (chat && profile) {
    return (
      <BookingNegotiationChat
        conversationId={chat.conversationId}
        bookingId={chat.bookingId}
        profile={profile}
        isWorker={false}
        onClose={() => setChat(null)}
      />
    );
  }

  if (viewWorker) {
    return (
      <>
        <WorkerPublicProfile
          worker={viewWorker}
          onBack={() => setViewWorker(null)}
          bookingActive={active.has(viewWorker.user_id)}
          onOpenBooking={() => onNavigate?.('my_bookings')}
          onBook={() => profile ? setBookingWorker(viewWorker) : toast.info('Please sign in to request a professional')}
        />
        {bookingWorker && profile && (
          <WorkerBookingRequestSheetV2
            worker={bookingWorker}
            profile={profile}
            onClose={() => setBookingWorker(null)}
            onCreated={(conversationId, bookingId) => created(bookingWorker.user_id, conversationId, bookingId)}
          />
        )}
      </>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-[#0A0A0F] pb-24 text-white">
      <Toaster position="top-center" richColors />
      <header className="border-b border-white/[.06] bg-[#0B0E15] px-4 py-5 sm:px-6">
        <div className="mx-auto max-w-7xl">
          <div className="flex items-center gap-3">
            <button onClick={() => onNavigate?.('home')} className="grid h-10 w-10 place-items-center rounded-xl border border-white/[.07] bg-white/[.03] text-[#9CA1B0]">←</button>
            <div>
              <p className="text-[9px] font-bold tracking-[.2em] text-violet-300">LOCAL SERVICES</p>
              <h1 className="mt-1 text-xl font-bold sm:text-2xl">Find a verified professional</h1>
            </div>
          </div>
          <p className="mt-3 max-w-2xl text-[11px] leading-relaxed text-[#74798A]">
            Search by work, specialty and location. Watch fresh Work Status updates, then open a professional profile to inspect Portfolio work and customer reputation before sending a request.
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-5 sm:px-6">
        {statusWorkers.length > 0 && (
          <section className="mb-5">
            <div className="mb-3 flex items-end justify-between gap-3">
              <div>
                <p className="text-[9px] font-bold uppercase tracking-[.16em] text-violet-300">WORK STATUS</p>
                <h2 className="mt-1 text-sm font-bold">See what professionals are working on now</h2>
              </div>
              <span className="text-[9px] text-[#666D7E]">24-hour updates</span>
            </div>
            <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
              {statusWorkers.map(({ worker, status }) => (
                <button key={worker.user_id} onClick={() => setStory({ worker, status })} className="w-24 shrink-0 text-left">
                  <div className="rounded-[26px] bg-gradient-to-br from-violet-300 via-blue-500 to-cyan-400 p-[2px]">
                    <StatusMedia status={status} className="h-32 w-full rounded-3xl bg-[#090C12] object-cover" />
                  </div>
                  <p className="mt-1 truncate text-[9px] font-semibold text-[#C6CAD4]">{worker.full_name || worker.username || 'Professional'}</p>
                  <p className="truncate text-[8px] text-[#686F80]">{status.caption || 'Work Status'}</p>
                </button>
              ))}
            </div>
          </section>
        )}

        <div className="mb-4 flex gap-2">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search plumber, electrician, skill or name"
            className="h-12 min-w-0 flex-1 rounded-2xl border border-white/[.08] bg-[#151922] px-4 text-sm outline-none focus:border-violet-500/30"
          />
          <button onClick={() => setFiltersOpen(true)} className="h-12 rounded-2xl border border-white/[.08] bg-[#151922] px-4 text-xs font-semibold lg:hidden">Filters</button>
        </div>

        <div className="grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
          <aside className="hidden lg:block">
            <div className="sticky top-4 rounded-3xl border border-white/[.07] bg-[#10141C] p-4">
              <FilterBody
                categories={categories}
                selected={selected}
                category={category}
                setCategory={(value) => { setCategory(value); setSpecialty(''); }}
                specialty={specialty}
                setSpecialty={setSpecialty}
                state={state}
                setState={(value) => { setState(value); setCity(''); }}
                city={city}
                setCity={setCity}
                cities={cities}
                clear={clear}
              />
            </div>
          </aside>

          <section>
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-[10px] text-[#697080]">{loading ? 'Finding verified professionals…' : `${shown.length} verified professional${shown.length === 1 ? '' : 's'}`}</p>
              {(category || specialty || state || city) && <button onClick={clear} className="text-[10px] font-semibold text-violet-300">Clear filters</button>}
            </div>

            {loading ? (
              <Empty text="Loading available professionals…" />
            ) : shown.length === 0 ? (
              <Empty text="No verified professional matches this search. Try a broader service or location." />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {shown.map((worker) => (
                  <WorkerCard
                    key={worker.user_id}
                    worker={worker}
                    status={latestStatusByWorker.get(worker.user_id)}
                    active={active.has(worker.user_id)}
                    onStatus={(status) => setStory({ worker, status })}
                    onProfile={() => setViewWorker(worker)}
                    onBook={() => profile ? setBookingWorker(worker) : toast.info('Please sign in to request a professional')}
                    onOpen={() => onNavigate?.('my_bookings')}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      </main>

      {filtersOpen && (
        <>
          <button className="fixed inset-0 z-[70] bg-black/65 lg:hidden" onClick={() => setFiltersOpen(false)} aria-label="Close filters" />
          <div className="fixed inset-x-0 bottom-0 z-[71] max-h-[82dvh] overflow-y-auto rounded-t-3xl border-t border-white/[.08] bg-[#0E1219] p-4 pb-[max(1rem,env(safe-area-inset-bottom))] lg:hidden">
            <div className="mb-4 flex items-center justify-between">
              <div><p className="text-[9px] font-bold tracking-[.16em] text-violet-300">FILTER LOCAL SERVICES</p><h2 className="mt-1 text-base font-bold">Choose what you need</h2></div>
              <button onClick={() => setFiltersOpen(false)} className="grid h-10 w-10 place-items-center rounded-full bg-white/[.06]">×</button>
            </div>
            <FilterBody
              categories={categories}
              selected={selected}
              category={category}
              setCategory={(value) => { setCategory(value); setSpecialty(''); }}
              specialty={specialty}
              setSpecialty={setSpecialty}
              state={state}
              setState={(value) => { setState(value); setCity(''); }}
              city={city}
              setCity={setCity}
              cities={cities}
              clear={clear}
            />
            <button onClick={() => setFiltersOpen(false)} className="mt-4 h-12 w-full rounded-2xl bg-violet-500 text-xs font-semibold text-white">Show {shown.length} result{shown.length === 1 ? '' : 's'}</button>
          </div>
        </>
      )}

      {story && (
        <div className="fixed inset-0 z-[95] bg-black/95" onClick={() => setStory(null)}>
          <div className="mx-auto flex h-full max-w-md flex-col justify-center p-4" onClick={(event) => event.stopPropagation()}>
            <div className="mb-3 flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center overflow-hidden rounded-full bg-violet-500 text-xs font-bold">
                {story.worker.avatar_url ? <img src={story.worker.avatar_url} alt="" className="h-full w-full object-cover" /> : (story.worker.full_name || story.worker.username || 'W')[0].toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold">{story.worker.full_name || story.worker.username || 'Professional'}</p>
                <p className="mt-0.5 text-[9px] text-violet-300">Work Status · disappears after 24 hours</p>
              </div>
              <button onClick={() => setStory(null)} className="grid h-10 w-10 place-items-center rounded-full bg-white/10">×</button>
            </div>
            <StatusMedia status={story.status} controls className="max-h-[68dvh] w-full rounded-3xl bg-black object-contain" />
            {story.status.caption && <p className="mt-3 rounded-2xl bg-white/[.06] p-4 text-[11px] leading-relaxed text-[#D0D3DA]">{story.status.caption}</p>}
            <button onClick={() => { setViewWorker(story.worker); setStory(null); }} className="mt-3 h-12 w-full rounded-2xl bg-violet-500 text-xs font-semibold text-white">View professional profile</button>
          </div>
        </div>
      )}

      {bookingWorker && profile && (
        <WorkerBookingRequestSheetV2
          worker={bookingWorker}
          profile={profile}
          onClose={() => setBookingWorker(null)}
          onCreated={(conversationId, bookingId) => created(bookingWorker.user_id, conversationId, bookingId)}
        />
      )}
    </div>
  );
}

function FilterBody({
  categories, selected, category, setCategory, specialty, setSpecialty,
  state, setState, city, setCity, cities, clear,
}: {
  categories: Category[];
  selected: Category | null;
  category: string;
  setCategory: (value: string) => void;
  specialty: string;
  setSpecialty: (value: string) => void;
  state: string;
  setState: (value: string) => void;
  city: string;
  setCity: (value: string) => void;
  cities: string[];
  clear: () => void;
}) {
  return (
    <div className="space-y-5">
      <section>
        <p className="mb-2 text-[9px] font-semibold uppercase tracking-[.14em] text-[#666D7E]">Service</p>
        <div className="space-y-1">
          <FilterOption active={!category} label="All services" onClick={() => setCategory('')} />
          {categories.map((item) => <FilterOption key={item.id} active={category === item.name} label={item.name} onClick={() => setCategory(item.name)} />)}
        </div>
      </section>
      {selected && (selected.subcategories || []).length > 0 && (
        <section>
          <p className="mb-2 text-[9px] font-semibold uppercase tracking-[.14em] text-[#666D7E]">Exact service</p>
          <select value={specialty} onChange={(event) => setSpecialty(event.target.value)} className="h-11 w-full rounded-xl border border-white/[.08] bg-[#171B24] px-3 text-xs">
            <option value="">Any {selected.name}</option>
            {selected.subcategories.map((sub: any) => <option key={sub.id || sub.name} value={sub.name}>{sub.name}</option>)}
          </select>
        </section>
      )}
      <section>
        <p className="mb-2 text-[9px] font-semibold uppercase tracking-[.14em] text-[#666D7E]">Location</p>
        <select value={state} onChange={(event) => setState(event.target.value)} className="h-11 w-full rounded-xl border border-white/[.08] bg-[#171B24] px-3 text-xs">
          <option value="">Any state</option>
          {NIGERIA_STATES.map((item) => <option key={item.state} value={item.state}>{item.state}</option>)}
        </select>
        {state && (
          <select value={city} onChange={(event) => setCity(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-white/[.08] bg-[#171B24] px-3 text-xs">
            <option value="">All LGAs in {state}</option>
            {cities.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        )}
      </section>
      <button onClick={clear} className="w-full rounded-xl border border-white/[.07] py-2.5 text-[10px] font-semibold text-[#858B9A]">Reset filters</button>
    </div>
  );
}

function FilterOption({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return <button onClick={onClick} className={`flex min-h-10 w-full items-center rounded-xl px-3 text-left text-[10px] font-semibold ${active ? 'bg-violet-500 text-white' : 'bg-white/[.025] text-[#9298A7] hover:bg-white/[.05]'}`}>{label}</button>;
}

function WorkerCard({
  worker, status, active, onStatus, onProfile, onBook, onOpen,
}: {
  worker: Profile;
  status?: WorkStatus;
  active: boolean;
  onStatus: (status: WorkStatus) => void;
  onProfile: () => void;
  onBook: () => void;
  onOpen: () => void;
}) {
  const occupation = WORKER_OCCUPATION_LABELS[worker.worker_occupation || ''] || worker.worker_occupation || 'Service professional';
  const skills = (worker.worker_skills as string[]) || [];
  return (
    <article className="rounded-3xl border border-white/[.07] bg-[#11141C] p-4">
      <div className="flex items-start gap-3">
        <button onClick={() => status ? onStatus(status) : onProfile()} className={`shrink-0 rounded-[18px] ${status ? 'bg-gradient-to-br from-violet-300 via-blue-500 to-cyan-400 p-[2px]' : ''}`} aria-label={status ? 'Open Work Status' : 'Open professional profile'}>
          <div className="grid h-14 w-14 place-items-center overflow-hidden rounded-2xl bg-gradient-to-br from-violet-500 to-blue-600 text-lg font-bold">
            {worker.avatar_url ? <img src={worker.avatar_url} alt="" className="h-full w-full object-cover" /> : (worker.full_name || worker.username || 'W')[0].toUpperCase()}
          </div>
        </button>
        <button onClick={onProfile} className="min-w-0 flex-1 text-left">
          <div className="flex items-center gap-2">
            <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{worker.full_name || worker.username || 'Professional'}</h2>
            <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-[7px] font-bold text-emerald-300">VERIFIED</span>
          </div>
          <p className="mt-1 truncate text-[10px] text-[#8A8F9E]">{occupation}</p>
          <p className="mt-1 truncate text-[9px] text-[#606575]">{[worker.city || worker.local_government, worker.state].filter(Boolean).join(', ') || 'Location not shown'}</p>
          {Number(worker.rating || 0) > 0 && <p className="mt-2 text-[9px] font-semibold text-amber-300">★ {Number(worker.rating).toFixed(1)} · {Number(worker.review_count || 0)} reviews</p>}
        </button>
      </div>
      {status && <button onClick={() => onStatus(status)} className="mt-3 flex w-full items-center justify-between rounded-xl border border-violet-500/15 bg-violet-500/[.05] px-3 py-2 text-left"><span className="text-[9px] font-semibold text-violet-300">● Work Status live</span><span className="text-[9px] text-[#72798A]">Watch →</span></button>}
      {skills.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{skills.slice(0, 4).map((skill) => <span key={skill} className="rounded-lg border border-white/[.06] px-2 py-1 text-[8px] text-[#858A99]">{skill}</span>)}</div>}
      {worker.worker_price && <p className="mt-3 text-xs font-semibold text-emerald-300">From ₦{Number(worker.worker_price).toLocaleString()}</p>}
      <button onClick={onProfile} className="mt-3 text-[9px] font-semibold text-violet-300">View Portfolio, reviews & profile →</button>
      <button onClick={active ? onOpen : onBook} className={`mt-4 h-11 w-full rounded-2xl text-[10px] font-semibold ${active ? 'border border-amber-500/15 bg-amber-500/[.06] text-amber-300' : 'bg-violet-500 text-white'}`}>{active ? 'Booking in progress · View' : 'Request professional'}</button>
    </article>
  );
}

function StatusMedia({ status, className, controls = false }: { status: WorkStatus; className: string; controls?: boolean }) {
  if (status.media_type === 'video') return <video src={status.url} className={className} controls={controls} playsInline muted={!controls} preload="metadata" />;
  return <img src={status.url} alt="Worker Work Status" className={className} />;
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-3xl border border-dashed border-white/[.08] px-6 py-14 text-center text-[11px] text-[#666C7D]">{text}</div>;
}
