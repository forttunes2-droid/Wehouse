import { useState, useEffect, useMemo } from 'react';
import { getAllListings, supabase } from '@/lib/supabase';
import ListingCard from '@/components/ListingCard';
import type { Listing, Profile } from '@/types';

interface Review {
  id: number;
  reviewer_name: string;
  reviewer_avatar: string | null;
  rating: number;
  comment: string | null;
  created_at: string;
  hotel_name?: string;
}

interface HomeProps {
  profile: Profile;
  onNavigate: (page: string, listingId?: string) => void;
  savedIds: Set<string>;
  onToggleSave: (listingId: string) => void;
  isAdmin?: boolean;
  onGoToNewListing?: () => void;
}

// ─── ANIMATED COUNTER ────────────────────────────────────
function AnimatedCounter({ target, duration = 2000 }: { target: number; duration?: number }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let start = 0;
    const step = Math.max(1, Math.floor(target / (duration / 16)));
    const timer = setInterval(() => {
      start += step;
      if (start >= target) { setCount(target); clearInterval(timer); }
      else setCount(start);
    }, 16);
    return () => clearInterval(timer);
  }, [target, duration]);
  return <span>{count.toLocaleString()}</span>;
}



// ─── HOW IT WORKS ────────────────────────────────────────
const HOW_STEPS = [
  { step: '01', title: 'Search', desc: 'Browse verified listings across Nigeria', icon: '🔍' },
  { step: '02', title: 'Connect', desc: 'Chat with our verified staff for help', icon: '💬' },
  { step: '03', title: 'Move In', desc: 'Secure your home with verified bookings', icon: '🏠' },
];

// ─── CITY IMAGES MAP ─────────────────────────────────────
const CITY_BG: Record<string, string> = {
  'Lagos': '/hero-cityscape.jpg',
  'Abuja': '/hero-luxury.jpg',
  'Ibadan': '/hero-interior.jpg',
  'Port Harcourt': '/hero-roommate.jpg',
};

export default function Home({ profile, onNavigate, savedIds, onToggleSave, isAdmin, onGoToNewListing }: HomeProps) {
  const [listings, setListings] = useState<Listing[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [cityFilter, setCityFilter] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [{ listings: data }, { data: reviewData }] = await Promise.all([
          getAllListings(),
          supabase
            .from('hotel_reviews')
            .select('review_id, rating, comment, created_at, profiles(username, avatar_url), hotels(name)')
            .order('created_at', { ascending: false })
            .limit(6),
        ]);
        if (!cancelled) setListings(data || []);
        const mapped: Review[] = (reviewData || []).map((r: any) => ({
          id: r.review_id,
          reviewer_name: r.profiles?.username || 'User',
          reviewer_avatar: r.profiles?.avatar_url,
          rating: r.rating,
          comment: r.comment,
          created_at: r.created_at,
          hotel_name: r.hotels?.name,
        }));
        if (!cancelled) setReviews(mapped);
      } catch { 
        if (!cancelled) { setListings([]); setReviews([]); }
      }
      finally { if (!cancelled) setLoading(false); }
    }
    load();
    return () => { cancelled = true };
  }, []);

  const availableListings = useMemo(() => {
    return cityFilter ? listings.filter(l => l.city === cityFilter) : listings;
  }, [listings, cityFilter]);

  const featured = availableListings.filter(l => (l.images?.length || 0) > 0).slice(0, 10);
  const recent = availableListings.slice(0, 8);

  const popularCities = useMemo(() => {
    const cityCount: Record<string, number> = {};
    listings.forEach(l => { if (l.city) cityCount[l.city] = (cityCount[l.city] || 0) + 1; });
    return Object.entries(cityCount).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([city]) => city);
  }, [listings]);

  const totalListings = listings.length;
  const totalCities = popularCities.length;
  const availableCount = listings.filter(l => l.status === 'available').length;

  // Property types available — from ACTUAL listings
  const availableTypes = useMemo(() => {
    const counts: Record<string, number> = {};
    listings.forEach(l => {
      const type = l.property_type === 'hotel' ? 'hotel' : (l.sub_type || 'long_stay');
      counts[type] = (counts[type] || 0) + 1;
    });
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);
  }, [listings]);

  if (loading) return <HomeSkeleton />;

  return (
    <div className="min-h-screen bg-[#0A0A0F] pb-24 relative overflow-hidden">
      {/* ═══ FLOATING GRADIENT ORBS ═══ */}
      <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
        <div className="orb orb-1" />
        <div className="orb orb-2" />
        <div className="orb orb-3" />
      </div>

      {/* ═══ HERO SECTION ═══ */}
      <div className="relative h-[500px] overflow-hidden z-[1]">
        <img src="/hero-luxury.jpg" alt="Luxury apartments" className="w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-b from-[#0A0A0F]/60 via-[#0A0A0F]/40 to-[#0A0A0F]" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#0A0A0F]/80 via-transparent to-[#0A0A0F]/60" />

        <div className="absolute inset-0 flex flex-col justify-between p-5 pt-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#3B82F6] to-[#7C3AED] flex items-center justify-center shadow-lg shadow-blue-500/30">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
                  <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" />
                </svg>
              </div>
              <span className="text-base font-bold text-white tracking-wide">WeHouse</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-medium text-white/60 bg-white/10 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/[0.06]">
                {profile.city || 'Nigeria'}
              </span>
              {isAdmin && (
                <button onClick={onGoToNewListing} className="w-9 h-9 rounded-xl bg-gradient-to-r from-[#3B82F6] to-[#2563EB] flex items-center justify-center shadow-lg shadow-blue-500/30">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><path d="M12 5v14M5 12h14" /></svg>
                </button>
              )}
            </div>
          </div>

          <div className="mt-auto pb-4">
            <div className="inline-flex items-center gap-1.5 bg-[#3B82F6]/10 backdrop-blur-md border border-[#3B82F6]/20 rounded-full px-3 py-1 mb-3">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[10px] text-[#3B82F6] font-medium">{availableCount} properties available now</span>
            </div>
            <h1 className="text-3xl font-extrabold text-white leading-[1.1] mb-2">
              Find Your<br />
              <span className="bg-gradient-to-r from-[#3B82F6] via-[#7C3AED] to-[#EC4899] bg-clip-text text-transparent">Perfect Home</span>
            </h1>
            <p className="text-sm text-white/60 mb-5 max-w-[280px]">
              Houses, apartments & roommates across {totalCities > 0 ? totalCities : 'multiple'} cities in Nigeria
            </p>

            <button onClick={() => onNavigate('search')} className="w-full h-13 rounded-2xl bg-white/[0.08] backdrop-blur-xl border border-white/[0.08] flex items-center px-5 gap-3 text-white/40 text-sm hover:border-[#3B82F6]/30 hover:bg-white/[0.12] transition-all shadow-2xl">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
              <span>Search location, price, type...</span>
              <div className="ml-auto w-10 h-10 rounded-xl bg-gradient-to-r from-[#3B82F6] to-[#7C3AED] flex items-center justify-center flex-shrink-0">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
              </div>
            </button>
          </div>
        </div>
      </div>

      {/* ═══ STATS STRIP — REAL DATA ONLY ═══ */}
      {totalListings > 0 && (
        <div className="px-5 -mt-8 relative z-10">
          <div className="rounded-3xl bg-[#12121A]/80 backdrop-blur-xl border border-white/[0.06] p-5 flex items-center justify-around shadow-2xl">
            <div className="text-center">
              <p className="text-xl font-extrabold text-white"><AnimatedCounter target={totalListings} /></p>
              <p className="text-[10px] text-[#5C5E72] mt-0.5">Listings</p>
            </div>
            <div className="w-px h-10 bg-white/[0.06]" />
            <div className="text-center">
              <p className="text-xl font-extrabold text-white"><AnimatedCounter target={totalCities} /></p>
              <p className="text-[10px] text-[#5C5E72] mt-0.5">Cities</p>
            </div>
            <div className="w-px h-10 bg-white/[0.06]" />
            <div className="text-center">
              <p className="text-xl font-extrabold text-emerald-400"><AnimatedCounter target={availableCount} /></p>
              <p className="text-[10px] text-[#5C5E72] mt-0.5">Available</p>
            </div>
          </div>
        </div>
      )}

      {/* ═══ BROWSE BY TYPE — CLICKABLE, ACTUALLY FILTERS ═══ */}
      {availableTypes.length > 0 && (
        <section className="mt-10 px-5 relative z-[1]">
          <h2 className="text-lg font-bold text-white mb-4">Browse by Type</h2>
          <div className="flex flex-wrap gap-2">
            {availableTypes.map(([type, count]) => (
              <button
                key={type}
                onClick={() => {
                  sessionStorage.setItem('search_property_type', type);
                  onNavigate('search');
                }}
                className="inline-flex items-center gap-1.5 h-9 px-4 rounded-full bg-[#12121A]/60 border border-white/[0.04] text-[11px] text-[#CBCBD7] hover:border-[#3B82F6]/40 hover:bg-[#3B82F6]/10 hover:text-white transition-all active:scale-95"
              >
                <span className="font-semibold">{type.charAt(0).toUpperCase() + type.slice(1)}</span>
                <span className="text-[#5C5E72]">({count})</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* ═══ POPULAR CITIES ═══ */}
      {popularCities.length > 0 && (
        <section className="mt-10 relative z-[1]">
          <div className="flex items-center justify-between px-5 mb-4">
            <h2 className="text-lg font-bold text-white">Popular Cities</h2>
            <button onClick={() => onNavigate('search')} className="text-[11px] text-[#3B82F6] font-semibold">View all</button>
          </div>
          <div className="flex gap-3 overflow-x-auto scrollbar-hide px-5 pb-1">
            {popularCities.map((city) => {
              const count = listings.filter(l => l.city === city).length;
              const isActive = cityFilter === city;
              const bgImage = CITY_BG[city] || '/hero-interior.jpg';
              return (
                <button key={city} onClick={() => setCityFilter(isActive ? null : city)} className={`relative flex-shrink-0 w-[160px] h-[110px] rounded-2xl overflow-hidden group text-left transition-all ${isActive ? 'ring-2 ring-[#3B82F6]' : ''}`}>
                  <img src={bgImage} alt={city} className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110" loading="lazy" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />
                  <div className="absolute bottom-0 left-0 right-0 p-3">
                    <p className="text-xs font-bold text-white">{city}</p>
                    <p className="text-[9px] text-white/60">{count} listings</p>
                  </div>
                  {isActive && <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-[#3B82F6] flex items-center justify-center"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><path d="M5 13l4 4L19 7" /></svg></div>}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* ═══ CITY FILTER CHIPS ═══ */}
      {popularCities.length > 0 && (
        <section className="mt-4 px-5 relative z-[1]">
          <div className="flex gap-2 overflow-x-auto scrollbar-hide">
            <button onClick={() => setCityFilter(null)} className={`flex-shrink-0 h-9 px-4 rounded-full text-[11px] font-semibold transition-all ${cityFilter === null ? 'bg-gradient-to-r from-[#3B82F6] to-[#7C3AED] text-white shadow-lg shadow-blue-500/20' : 'bg-[#12121A]/60 border border-white/[0.04] text-[#8A8B9C] hover:border-[#3B82F6]/30'}`}>All</button>
            {popularCities.map(city => (
              <button key={city} onClick={() => setCityFilter(cityFilter === city ? null : city)} className={`flex-shrink-0 h-9 px-4 rounded-full text-[11px] font-semibold transition-all ${cityFilter === city ? 'bg-gradient-to-r from-[#3B82F6] to-[#7C3AED] text-white shadow-lg shadow-blue-500/20' : 'bg-[#12121A]/60 border border-white/[0.04] text-[#8A8B9C] hover:border-[#3B82F6]/30'}`}>{city}</button>
            ))}
          </div>
        </section>
      )}

      {/* ═══ FEATURED PROPERTIES ═══ */}
      {featured.length > 0 && (
        <section className="mt-10 relative z-[1]">
          <div className="flex items-center justify-between px-5 mb-4">
            <div>
              <h2 className="text-lg font-bold text-white">Featured Properties</h2>
              <p className="text-[10px] text-[#5C5E72] mt-0.5">Browse verified listings</p>
            </div>
            <button onClick={() => onNavigate('search')} className="text-[11px] text-[#3B82F6] font-semibold">See all</button>
          </div>
          <div className="flex gap-4 overflow-x-auto scrollbar-hide px-5 pb-1">
            {featured.map(l => (
              <div key={l.id} className="w-[280px] flex-shrink-0">
                <ListingCard listing={l} onClick={() => onNavigate('detail', l.id)} isSaved={savedIds.has(l.id)} onToggleSave={(e) => { e.stopPropagation(); onToggleSave(l.id); }} />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ═══ HOW IT WORKS ═══ */}
      <section className="mt-10 px-5 relative z-[1]">
        <div className="text-center mb-6">
          <h2 className="text-lg font-bold text-white">How It Works</h2>
          <p className="text-[10px] text-[#5C5E72] mt-1">Three simple steps to your new home</p>
        </div>
        <div className="space-y-3">
          {HOW_STEPS.map((s, i) => (
            <div key={i} className="flex items-center gap-4 rounded-2xl bg-[#12121A]/60 backdrop-blur border border-white/[0.04] p-4">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#3B82F6]/20 to-[#7C3AED]/20 flex items-center justify-center flex-shrink-0 text-xl">{s.icon}</div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[9px] font-bold text-[#3B82F6]">STEP {s.step}</span>
                </div>
                <p className="text-sm font-semibold text-white mt-0.5">{s.title}</p>
                <p className="text-[11px] text-[#5C5E72] mt-0.5">{s.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ═══ ROOMMATE CTA ═══ */}
      <section className="mt-10 px-5 relative z-[1]">
        <button
          onClick={() => onNavigate('roommate')}
          className="block w-full h-[180px] rounded-3xl overflow-hidden relative text-left cursor-pointer"
          type="button"
        >
          <img src="/hero-roommate.jpg" alt="Roommate" className="absolute inset-0 w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-r from-[#0A0A0F]/95 via-[#0A0A0F]/70 to-[#0A0A0F]/40" />
          <div className="absolute inset-0 flex flex-col justify-center p-6 pointer-events-none">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-xl bg-[#EC4899]/20 flex items-center justify-center">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#EC4899" strokeWidth="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
              </div>
              <span className="text-[10px] font-bold text-[#EC4899] uppercase tracking-wider">Roommate Match</span>
            </div>
            <p className="text-xl font-bold text-white leading-tight">Share Housing Costs</p>
            <p className="text-xs text-white/50 mt-1 max-w-[240px]">Find compatible roommates based on lifestyle, budget & location preferences</p>
            <div className="mt-3 flex items-center gap-1.5 text-[11px] text-[#EC4899] font-semibold">
              Get matched <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
            </div>
          </div>
        </button>
      </section>

      {/* ═══ REAL REVIEWS FROM USERS ═══ */}
      <section className="mt-12 px-5 relative z-[1]">
        <div className="text-center mb-5">
          <h2 className="text-lg font-bold text-white">What People Say</h2>
          <p className="text-[10px] text-[#5C5E72] mt-1">Real reviews from real users</p>
        </div>
        {reviews.length === 0 ? (
          <div className="rounded-3xl bg-[#12121A]/60 backdrop-blur border border-white/[0.04] p-8 text-center">
            <div className="w-14 h-14 rounded-full bg-[#1A1A24] flex items-center justify-center mx-auto mb-4">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#5C5E72" strokeWidth="1.5">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <p className="text-sm text-[#5C5E72] mb-1">No reviews yet</p>
            <p className="text-[10px] text-[#5C5E72]/70">Book a hotel and leave a review to see it here</p>
          </div>
        ) : (
          <div className="space-y-3">
            {reviews.map((r) => (
              <div key={r.id} className="rounded-2xl bg-[#12121A]/60 border border-white/[0.04] p-4">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#3B82F6] to-[#2563EB] flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
                    {r.reviewer_avatar ? <img src={r.reviewer_avatar} alt="" className="w-full h-full rounded-xl object-cover" /> : r.reviewer_name[0].toUpperCase()}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-white">@{r.reviewer_name}</p>
                    <div className="flex items-center gap-1">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <svg key={i} width="10" height="10" viewBox="0 0 24 24" fill={i < r.rating ? '#F59E0B' : 'none'} stroke={i < r.rating ? '#F59E0B' : '#5C5E72'} strokeWidth="2">
                          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                        </svg>
                      ))}
                    </div>
                  </div>
                  {r.hotel_name && <span className="ml-auto text-[9px] text-[#5C5E72]">{r.hotel_name}</span>}
                </div>
                {r.comment && <p className="text-xs text-[#CBCBD7] leading-relaxed">{r.comment}</p>}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ═══ RECENTLY ADDED ═══ */}
      {recent.length > 0 && (
        <section className="mt-10 px-5 relative z-[1]">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-bold text-white">Recently Added</h2>
              <p className="text-[10px] text-[#5C5E72] mt-0.5">Fresh on the market</p>
            </div>
            <button onClick={() => onNavigate('search')} className="text-[11px] text-[#3B82F6] font-semibold">See all</button>
          </div>
          <div className="grid grid-cols-2 gap-3.5">
            {recent.map(l => (
              <ListingCard key={l.id} listing={l} onClick={() => onNavigate('detail', l.id)} isSaved={savedIds.has(l.id)} onToggleSave={(e) => { e.stopPropagation(); onToggleSave(l.id); }} />
            ))}
          </div>
        </section>
      )}

      {/* ═══ TRUST BADGES ═══ */}
      <section className="mt-10 px-5 relative z-[1]">
        <div className="rounded-3xl bg-gradient-to-r from-[#12121A]/80 to-[#1A1A24]/80 backdrop-blur border border-white/[0.04] p-5">
          <div className="grid grid-cols-2 gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center flex-shrink-0">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#34D399" strokeWidth="2"><path d="M9 12l2 2 4-4m6 2a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" /></svg>
              </div>
              <div>
                <p className="text-xs font-semibold text-white">Verified</p>
                <p className="text-[9px] text-[#5C5E72]">All listings checked</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#3B82F6]/10 flex items-center justify-center flex-shrink-0">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
              </div>
              <div>
                <p className="text-xs font-semibold text-white">Secure</p>
                <p className="text-[9px] text-[#5C5E72]">Safe payments</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center flex-shrink-0">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" /></svg>
              </div>
              <div>
                <p className="text-xs font-semibold text-white">Fast</p>
                <p className="text-[9px] text-[#5C5E72]">Quick matching</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-purple-500/10 flex items-center justify-center flex-shrink-0">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#A855F7" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /></svg>
              </div>
              <div>
                <p className="text-xs font-semibold text-white">Support</p>
                <p className="text-[9px] text-[#5C5E72]">Staff-assisted</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ FOOTER CTA ═══ */}
      <section className="mt-10 px-5 pb-4 relative z-[1]">
        <div className="relative rounded-3xl overflow-hidden h-[200px]">
          <img src="/hero-cityscape.jpg" alt="Nigeria" className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#0A0A0F] via-[#0A0A0F]/70 to-[#0A0A0F]/40" />
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-5">
            <p className="text-lg font-bold text-white">Ready to find your home?</p>
            <p className="text-xs text-white/50 mt-1 mb-4">Our verified staff are here to help</p>
            <button onClick={() => onNavigate('search')} className="h-10 px-6 rounded-xl bg-gradient-to-r from-[#3B82F6] to-[#7C3AED] text-white text-xs font-semibold shadow-lg shadow-blue-500/30 hover:opacity-90 transition-opacity inline-flex items-center gap-2">
              Start Browsing
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
            </button>
          </div>
        </div>
        <p className="text-center text-[10px] text-[#5C5E72] mt-4">WeHouse Nigeria &copy; 2026 &middot; support@wehouse.com.ng</p>
      </section>

      {/* ═══ EMPTY STATE ═══ */}
      {listings.length === 0 && (
        <div className="text-center py-20 px-5 relative z-[1]">
          <div className="w-16 h-16 rounded-2xl bg-[#1A1A24] flex items-center justify-center mx-auto mb-4">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#5C5E72" strokeWidth="1.5"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></svg>
          </div>
          <p className="text-sm text-[#5C5E72]">No listings yet</p>
          {isAdmin && onGoToNewListing && (
            <button onClick={onGoToNewListing} className="mt-4 h-10 px-5 rounded-xl bg-gradient-to-r from-[#3B82F6] to-[#7C3AED] text-white text-xs font-semibold inline-flex items-center gap-2">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>Post First Listing
            </button>
          )}
        </div>
      )}

      {/* ═══ FAB ═══ */}
      {isAdmin && onGoToNewListing && listings.length > 0 && (
        <button onClick={onGoToNewListing} className="fixed bottom-20 right-5 w-14 h-14 rounded-full bg-gradient-to-r from-[#3B82F6] to-[#7C3AED] text-white flex items-center justify-center shadow-2xl shadow-blue-500/30 hover:scale-105 active:scale-95 transition-transform z-40" aria-label="Add listing">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
        </button>
      )}
    </div>
  );
}

// ─── SKELETON ────────────────────────────────────────────
function HomeSkeleton() {
  return (
    <div className="min-h-screen bg-[#0A0A0F] pb-24">
      <div className="h-[500px] w-full bg-[#12121A] shimmer" />
      <div className="px-5 mt-6 space-y-8">
        <div className="h-16 rounded-2xl bg-[#12121A] shimmer" />
        <div className="h-5 w-40 rounded shimmer" />
        <div className="grid grid-cols-3 gap-3">
          {[1,2,3,4,5,6].map(i => <div key={i} className="h-24 rounded-2xl bg-[#12121A] shimmer" />)}
        </div>
        <div className="h-5 w-32 rounded shimmer" />
        <div className="flex gap-3">
          {[1,2,3].map(i => <div key={i} className="w-[280px] h-[220px] rounded-2xl bg-[#12121A] shimmer flex-shrink-0" />)}
        </div>
        <div className="h-5 w-32 rounded shimmer" />
        <div className="grid grid-cols-2 gap-3">
          {[1,2,3,4].map(i => <div key={i} className="h-[200px] rounded-2xl bg-[#12121A] shimmer" />)}
        </div>
      </div>
    </div>
  );
}
