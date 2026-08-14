import { useEffect, useMemo, useState } from 'react';
import { Toaster, toast } from 'sonner';
import { getCategoryWithSubcategories, getWorkers } from '@/lib/supabase';
import { getUserActiveBookings } from '@/lib/supabase/worker-bookings';
import { NIGERIA_STATES, getCitiesForState } from '@/data/nigeria-locations';
import WorkerBookingRequestSheetV2 from '@/components/WorkerBookingRequestSheetV2';
import BookingNegotiationChat from '@/components/BookingNegotiationChat';
import { WORKER_OCCUPATION_LABELS } from '@/types';
import type { Profile, ServiceCategory } from '@/types';

type Category = ServiceCategory & { subcategories: any[] };
type Props = {
  userCity?: string | null;
  profile?: Profile | null;
  onNavigate?: (page: string) => void;
  preSelectedCategory?: string | null;
};

export default function DirectoryV2({ userCity, profile, onNavigate, preSelectedCategory }: Props) {
  const [workers, setWorkers] = useState<Profile[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [specialty, setSpecialty] = useState('');
  const [state, setState] = useState('');
  const [city, setCity] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [bookingWorker, setBookingWorker] = useState<Profile | null>(null);
  const [active, setActive] = useState<Set<string>>(new Set());
  const [chat, setChat] = useState<{ conversationId: string; bookingId: string } | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [{ workers: rows, error }, { categories: categoryRows }] = await Promise.all([
        getWorkers(),
        getCategoryWithSubcategories().catch(() => ({ categories: [] } as any)),
      ]);
      if (!alive) return;
      if (error) toast.error(error.message);
      setWorkers(rows || []);
      setCategories((categoryRows || []) as Category[]);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!profile?.user_id) return;
    void getUserActiveBookings(profile.user_id).then(({ bookings }) => {
      setActive(new Set((bookings || []).map((row: any) => row.worker_id)));
    });
  }, [profile?.user_id]);

  useEffect(() => {
    if (!preSelectedCategory || !categories.length) return;
    const direct = categories.find((item) => item.name === preSelectedCategory);
    if (direct) {
      setCategory(direct.name);
      setSpecialty('');
      return;
    }
    const parent = categories.find((item) => (item.subcategories || []).some((sub: any) => sub.name === preSelectedCategory));
    if (parent) {
      setCategory(parent.name);
      setSpecialty(preSelectedCategory);
    }
  }, [preSelectedCategory, categories]);

  const selectedCategory = useMemo(
    () => categories.find((item) => item.name === category) || null,
    [categories, category],
  );
  const cities = useMemo(() => getCitiesForState(state), [state]);

  const shown = useMemo(() => workers
    .filter((worker) => worker.worker_status === 'verified' && worker.worker_verified === true && worker.available !== false)
    .filter((worker) => {
      const query = search.trim().toLowerCase();
      const skills = (worker.worker_skills as string[]) || [];
      const searchable = [
        worker.full_name || worker.username || '',
        worker.worker_occupation || '',
        worker.worker_bio || '',
        worker.city || '',
        worker.state || '',
        ...skills,
      ].join(' ').toLowerCase();
      if (query && !searchable.includes(query)) return false;
      if (category && ![worker.worker_occupation || '', ...skills].join(' ').toLowerCase().includes(category.toLowerCase())) return false;
      if (specialty && !skills.some((skill) => skill.toLowerCase() === specialty.toLowerCase())) return false;
      if (state && String(worker.state || '').toLowerCase() !== state.toLowerCase() && !getCitiesForState(state).includes(worker.city || '')) return false;
      if (city && String(worker.city || '').toLowerCase() !== city.toLowerCase()) return false;
      return true;
    })
    .sort((a, b) => {
      if (userCity) {
        const aLocal = String(a.city || '').toLowerCase() === userCity.toLowerCase();
        const bLocal = String(b.city || '').toLowerCase() === userCity.toLowerCase();
        if (aLocal !== bLocal) return aLocal ? -1 : 1;
      }
      const ratingDifference = Number(b.rating || 0) - Number(a.rating || 0);
      if (ratingDifference !== 0) return ratingDifference;
      return String(a.full_name || a.username || '').localeCompare(String(b.full_name || b.username || ''));
    }), [workers, search, category, specialty, state, city, userCity]);

  const filterCount = Number(Boolean(category || specialty)) + Number(Boolean(state || city));
  const serviceLabel = specialty || category || 'All services';
  const locationLabel = city || state || (userCity ? `Near ${userCity}` : 'Any location');

  function clear() {
    setSearch('');
    setCategory('');
    setSpecialty('');
    setState('');
    setCity('');
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

  return (
    <div className="min-h-[100dvh] overflow-x-hidden bg-[#080A0F] pb-24 text-white">
      <Toaster position="top-center" richColors />

      <header className="border-b border-white/[.06] bg-[#0B0E15] px-4 py-5 sm:px-6">
        <div className="mx-auto max-w-7xl">
          <div className="flex items-center gap-3">
            <button
              onClick={() => onNavigate?.('home')}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-white/[.07] bg-white/[.03] text-[#9CA1B0]"
              aria-label="Back"
            >
              ←
            </button>
            <div className="min-w-0">
              <p className="text-[9px] font-bold tracking-[.2em] text-blue-400">LOCAL SERVICES</p>
              <h1 className="mt-1 text-xl font-bold sm:text-2xl">Find a verified professional</h1>
            </div>
          </div>
          <p className="mt-3 max-w-2xl text-[11px] leading-relaxed text-[#74798A]">
            Search by service and location. Only Workers who completed payment, the Worker test, professional evidence, external identity verification and final WeHouse approval can appear here.
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-4 px-4 py-5 sm:px-6">
        <section className="rounded-3xl border border-white/[.07] bg-[#10131B] p-4 sm:p-5">
          <div className="flex gap-2">
            <div className="relative min-w-0 flex-1">
              <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#5D6475]">⌕</span>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search plumber, electrician, cleaning…"
                className="h-12 w-full rounded-2xl border border-white/[.08] bg-[#171A23] pl-10 pr-4 text-sm outline-none focus:border-blue-500/35"
              />
            </div>
            <button
              onClick={() => setFiltersOpen(true)}
              className="flex h-12 shrink-0 items-center gap-2 rounded-2xl border border-white/[.08] bg-[#171A23] px-4 text-xs font-semibold text-[#A4A9B6] lg:hidden"
            >
              <span>Filters</span>
              {filterCount > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-blue-500 px-1 text-[9px] text-white">{filterCount}</span>}
            </button>
          </div>

          <div className="mt-3 flex flex-wrap gap-2 text-[9px]">
            <SummaryPill label="Service" value={serviceLabel} />
            <SummaryPill label="Location" value={locationLabel} />
            {(search || category || specialty || state || city) && (
              <button onClick={clear} className="rounded-full border border-white/[.07] px-3 py-1.5 font-semibold text-blue-300">Reset all</button>
            )}
          </div>
        </section>

        <div className="lg:grid lg:grid-cols-[290px_minmax(0,1fr)] lg:items-start lg:gap-5">
          <aside className="hidden lg:sticky lg:top-20 lg:block">
            <div className="rounded-3xl border border-white/[.07] bg-[#10131B] p-4">
              <FilterPanel
                categories={categories}
                category={category}
                specialty={specialty}
                state={state}
                city={city}
                setCategory={setCategory}
                setSpecialty={setSpecialty}
                setState={setState}
                setCity={setCity}
              />
            </div>
          </aside>

          <section className="min-w-0 space-y-3">
            <div className="flex items-end justify-between gap-3 px-1">
              <div>
                <p className="text-sm font-semibold">Available professionals</p>
                <p className="mt-1 text-[10px] text-[#666C7D]">
                  {loading ? 'Finding professionals…' : `${shown.length} verified and available`}
                </p>
              </div>
              {userCity && !city && !state && <span className="rounded-full border border-emerald-500/15 bg-emerald-500/[.05] px-2.5 py-1 text-[8px] font-semibold text-emerald-300">LOCAL FIRST</span>}
            </div>

            {loading ? (
              <Empty text="Loading available professionals…" />
            ) : shown.length === 0 ? (
              <Empty text="No approved available professional matches this search. Change the service or location filter." />
            ) : (
              <div className="grid min-w-0 gap-3 md:grid-cols-2 2xl:grid-cols-3">
                {shown.map((worker) => (
                  <ProfessionalCard
                    key={worker.user_id}
                    worker={worker}
                    active={active.has(worker.user_id)}
                    onBook={() => profile ? setBookingWorker(worker) : toast.info('Please log in to request a professional')}
                    onOpen={() => onNavigate?.('my_bookings')}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      </main>

      {filtersOpen && (
        <div className="fixed inset-0 z-[80] lg:hidden">
          <button
            aria-label="Close filters"
            onClick={() => setFiltersOpen(false)}
            className="absolute inset-0 bg-black/65"
          />
          <section className="absolute inset-x-0 bottom-0 max-h-[88dvh] overflow-hidden rounded-t-[2rem] border-t border-white/[.08] bg-[#0D1118] shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/[.06] px-4 py-4">
              <div>
                <p className="text-[9px] font-bold tracking-[.18em] text-blue-400">FILTER PROFESSIONALS</p>
                <p className="mt-1 text-sm font-semibold">Service & location</p>
              </div>
              <button onClick={() => setFiltersOpen(false)} className="grid h-10 w-10 place-items-center rounded-xl border border-white/[.07] bg-white/[.03]">×</button>
            </div>
            <div className="max-h-[calc(88dvh-8.5rem)] overflow-y-auto px-4 py-4">
              <FilterPanel
                categories={categories}
                category={category}
                specialty={specialty}
                state={state}
                city={city}
                setCategory={setCategory}
                setSpecialty={setSpecialty}
                setState={setState}
                setCity={setCity}
              />
            </div>
            <div className="flex gap-2 border-t border-white/[.06] bg-[#0D1118] px-4 py-3 pb-[calc(.75rem+env(safe-area-inset-bottom))]">
              <button onClick={clear} className="h-12 flex-1 rounded-2xl border border-white/[.08] text-xs font-semibold text-[#959BAA]">Reset</button>
              <button onClick={() => setFiltersOpen(false)} className="h-12 flex-[1.5] rounded-2xl bg-blue-500 text-xs font-semibold">Show {shown.length}</button>
            </div>
          </section>
        </div>
      )}

      {bookingWorker && profile && (
        <WorkerBookingRequestSheetV2
          worker={bookingWorker}
          profile={profile}
          onClose={() => setBookingWorker(null)}
          onCreated={(conversationId, bookingId) => {
            const workerId = bookingWorker.user_id;
            setBookingWorker(null);
            setActive((current) => new Set(current).add(workerId));
            setChat({ conversationId, bookingId });
          }}
        />
      )}
    </div>
  );
}

function FilterPanel({
  categories,
  category,
  specialty,
  state,
  city,
  setCategory,
  setSpecialty,
  setState,
  setCity,
}: {
  categories: Category[];
  category: string;
  specialty: string;
  state: string;
  city: string;
  setCategory: (value: string) => void;
  setSpecialty: (value: string) => void;
  setState: (value: string) => void;
  setCity: (value: string) => void;
}) {
  const [serviceSearch, setServiceSearch] = useState('');
  const selected = categories.find((item) => item.name === category) || null;
  const cities = getCitiesForState(state);
  const query = serviceSearch.trim().toLowerCase();
  const visibleCategories = categories.filter((item) => {
    if (!query) return true;
    return item.name.toLowerCase().includes(query) || (item.subcategories || []).some((sub: any) => String(sub.name || '').toLowerCase().includes(query));
  });

  return (
    <div className="space-y-5">
      <section>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[9px] font-bold uppercase tracking-[.16em] text-[#6B7282]">SERVICE</p>
            <p className="mt-1 text-[10px] text-[#8A91A0]">Choose one category, then an exact service if needed.</p>
          </div>
          {(category || specialty) && <button onClick={() => { setCategory(''); setSpecialty(''); }} className="text-[9px] font-semibold text-blue-300">Clear</button>}
        </div>

        <input
          value={serviceSearch}
          onChange={(event) => setServiceSearch(event.target.value)}
          placeholder="Search services"
          className="mt-3 h-11 w-full rounded-xl border border-white/[.08] bg-[#171A23] px-3 text-xs outline-none focus:border-blue-500/30"
        />

        <div className="mt-3 space-y-1.5">
          {!query && (
            <ChoiceRow
              title="All services"
              detail="Show every approved professional"
              active={!category}
              onClick={() => { setCategory(''); setSpecialty(''); }}
            />
          )}
          {visibleCategories.map((item) => {
            const isSelected = category === item.name;
            return (
              <div key={item.id}>
                <ChoiceRow
                  title={item.name}
                  detail={`${(item.subcategories || []).length} service${(item.subcategories || []).length === 1 ? '' : 's'}`}
                  active={isSelected && !specialty}
                  onClick={() => {
                    setCategory(item.name);
                    setSpecialty('');
                  }}
                />
                {isSelected && (item.subcategories || []).length > 0 && (
                  <div className="ml-3 mt-1.5 space-y-1 border-l border-white/[.07] pl-3">
                    {(item.subcategories || []).map((sub: any) => (
                      <button
                        key={sub.id || sub.name}
                        onClick={() => setSpecialty(sub.name)}
                        className={`flex min-h-10 w-full items-center justify-between rounded-xl px-3 text-left text-[10px] font-medium ${
                          specialty === sub.name ? 'bg-blue-500/12 text-blue-200' : 'text-[#838999] hover:bg-white/[.03]'
                        }`}
                      >
                        <span>{sub.name}</span>
                        {specialty === sub.name && <span>✓</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {visibleCategories.length === 0 && (
            <div className="rounded-xl border border-dashed border-white/[.08] px-3 py-5 text-center text-[10px] text-[#676E7E]">No service matches that search.</div>
          )}
        </div>
      </section>

      <div className="h-px bg-white/[.06]" />

      <section>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[9px] font-bold uppercase tracking-[.16em] text-[#6B7282]">LOCATION</p>
            <p className="mt-1 text-[10px] text-[#8A91A0]">Filter by State and Local Government.</p>
          </div>
          {(state || city) && <button onClick={() => { setState(''); setCity(''); }} className="text-[9px] font-semibold text-blue-300">Clear</button>}
        </div>

        <label className="mt-3 block">
          <span className="mb-1.5 block text-[9px] text-[#696F7F]">State</span>
          <select
            value={state}
            onChange={(event) => { setState(event.target.value); setCity(''); }}
            className="h-11 w-full rounded-xl border border-white/[.08] bg-[#171A23] px-3 text-xs outline-none"
          >
            <option value="">Any State</option>
            {NIGERIA_STATES.map((item) => <option key={item.state} value={item.state}>{item.state}</option>)}
          </select>
        </label>

        <label className="mt-3 block">
          <span className="mb-1.5 block text-[9px] text-[#696F7F]">Local Government</span>
          <select
            value={city}
            disabled={!state}
            onChange={(event) => setCity(event.target.value)}
            className="h-11 w-full rounded-xl border border-white/[.08] bg-[#171A23] px-3 text-xs outline-none disabled:opacity-45"
          >
            <option value="">{state ? `All in ${state}` : 'Choose a State first'}</option>
            {cities.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
      </section>
    </div>
  );
}

function ChoiceRow({ title, detail, active, onClick }: { title: string; detail: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex min-h-12 w-full items-center gap-3 rounded-xl border px-3 text-left ${
        active ? 'border-blue-500/25 bg-blue-500/[.08]' : 'border-white/[.06] bg-white/[.018] hover:bg-white/[.03]'
      }`}
    >
      <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-lg border text-[9px] ${active ? 'border-blue-400 bg-blue-500 text-white' : 'border-white/[.09] text-[#626A7A]'}`}>{active ? '✓' : '•'}</span>
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-[11px] font-semibold ${active ? 'text-blue-100' : 'text-[#B1B6C2]'}`}>{title}</span>
        <span className="mt-0.5 block truncate text-[9px] text-[#656C7C]">{detail}</span>
      </span>
    </button>
  );
}

function ProfessionalCard({ worker, active, onBook, onOpen }: { worker: Profile; active: boolean; onBook: () => void; onOpen: () => void }) {
  const occupation = WORKER_OCCUPATION_LABELS[worker.worker_occupation || ''] || worker.worker_occupation || 'Service professional';
  const skills = (worker.worker_skills as string[]) || [];
  const rating = Number(worker.rating || 0);
  const reviews = Number(worker.review_count || 0);

  return (
    <article className="min-w-0 rounded-3xl border border-white/[.07] bg-[#11141C] p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <div className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 text-lg font-bold">
          {worker.avatar_url ? <img src={worker.avatar_url} alt="" className="h-full w-full object-cover" /> : (worker.full_name || worker.username || 'W')[0].toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{worker.full_name || worker.username || 'Professional'}</h2>
            <span className="shrink-0 rounded-full border border-blue-400/15 bg-blue-500/10 px-2 py-1 text-[8px] font-bold text-blue-300">VERIFIED</span>
          </div>
          <p className="mt-1 truncate text-[10px] text-[#8A8F9E]">{occupation}</p>
          <p className="mt-1 truncate text-[9px] text-[#606575]">{[worker.city, worker.state].filter(Boolean).join(', ') || 'Location not shown'}</p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-[9px]">
        {rating > 0 && <span className="rounded-full border border-white/[.06] px-2 py-1 text-[#A4A9B7]">★ {rating.toFixed(1)}{reviews > 0 ? ` · ${reviews}` : ''}</span>}
        <span className="rounded-full border border-emerald-500/15 bg-emerald-500/[.05] px-2 py-1 text-emerald-300">Available</span>
      </div>

      {skills.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {skills.slice(0, 4).map((skill) => <span key={skill} className="rounded-lg border border-white/[.06] px-2 py-1 text-[9px] text-[#858A99]">{skill}</span>)}
          {skills.length > 4 && <span className="rounded-lg border border-white/[.06] px-2 py-1 text-[9px] text-[#656B7A]">+{skills.length - 4}</span>}
        </div>
      )}

      {worker.worker_bio && <p className="mt-3 line-clamp-3 text-[10px] leading-relaxed text-[#727889]">{worker.worker_bio}</p>}
      {worker.worker_price && <p className="mt-3 text-xs font-semibold text-emerald-300">From ₦{Number(worker.worker_price).toLocaleString()}</p>}

      <button
        onClick={active ? onOpen : onBook}
        className={`mt-4 h-11 w-full rounded-2xl text-[11px] font-semibold ${
          active ? 'border border-amber-500/15 bg-amber-500/[.06] text-amber-300' : 'bg-blue-500 text-white'
        }`}
      >
        {active ? 'Booking in progress · View' : 'Request professional'}
      </button>
    </article>
  );
}

function SummaryPill({ label, value }: { label: string; value: string }) {
  return <span className="max-w-full truncate rounded-full border border-white/[.07] bg-white/[.02] px-3 py-1.5 text-[#7D8494]"><span className="text-[#5D6474]">{label}:</span> <span className="font-semibold text-[#9DA3B1]">{value}</span></span>;
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-3xl border border-dashed border-white/[.08] px-6 py-14 text-center text-[11px] text-[#666C7D]">{text}</div>;
}
