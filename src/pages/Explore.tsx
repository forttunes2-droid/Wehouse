import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase, getSavedListings } from '@/lib/supabase';
import { usePlatformSettings } from '@/hooks/usePlatformSettings';
import { Toaster, toast } from 'sonner';
import type { Profile } from '@/types';

interface ExploreProps {
  profile: Profile | null;
  savedIds: Set<string>;
  onToggleSave: (id: string) => void;
  onNavigate: (page: string, id?: string) => void;
}

type ExploreCategory = 'houses' | 'apartments' | 'hotels' | 'workers' | 'roommates';

const CATEGORIES: { id: ExploreCategory; label: string; icon: string }[] = [
  { id: 'houses', label: 'Houses', icon: '🏠' },
  { id: 'apartments', label: 'Apartments', icon: '🏢' },
  { id: 'hotels', label: 'Hotels', icon: '🏨' },
  { id: 'workers', label: 'Workers', icon: '🔧' },
  { id: 'roommates', label: 'Roommates', icon: '👥' },
];

// ─── UNIFIED EXPLORE PAGE ──────────────────────────────────
// The marketplace of WeHouse. One search, one page, all categories.
// ────────────────────────────────────────────────────────────

export default function Explore({ profile, savedIds, onToggleSave, onNavigate }: ExploreProps) {
  const [activeCategory, setActiveCategory] = useState<ExploreCategory>('houses');
  const [searchQuery, setSearchQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const { getNumber } = usePlatformSettings();
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Search / Load ──
  const performSearch = useCallback(async (query: string, category: ExploreCategory, pageNum: number, append: boolean) => {
    if (!profile?.user_id) return;
    setLoading(true);
    try {
      let data: any[] = [];
      const limit = 10;
      const offset = (pageNum - 1) * limit;

      switch (category) {
        case 'houses':
        case 'apartments': {
          const propertyType = category === 'apartments' ? 'apartment' : 'house';
          let q = supabase
            .from('listings')
            .select('id, title, price, property_type, bedrooms, bathrooms, city, state, images, availability_status, sub_type')
            .eq('property_type', propertyType)
            .eq('availability_status', 'available')
            .is('deleted_at', null)
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);
          if (query.trim()) {
            q = q.or(`title.ilike.%${query}%,city.ilike.%${query}%,state.ilike.%${query}%`);
          }
          const { data: listings } = await q;
          data = listings || [];
          break;
        }
        case 'hotels': {
          let q = supabase
            .from('hotels')
            .select('id, name, city, state, images, rating, review_count, base_price, amenities')
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);
          if (query.trim()) {
            q = q.or(`name.ilike.%${query}%,city.ilike.%${query}%`);
          }
          const { data: hotels } = await q;
          data = hotels || [];
          break;
        }
        case 'workers': {
          let q = supabase
            .from('profiles')
            .select('user_id, username, full_name, worker_occupation, worker_skills, worker_price, avatar_url, city, state, worker_status, worker_verified, worker_rating')
            .eq('role', 'worker')
            .eq('worker_status', 'verified')
            .is('deleted_at', null)
            .order('worker_rating', { ascending: false })
            .range(offset, offset + limit - 1);
          if (query.trim()) {
            q = q.or(`username.ilike.%${query}%,full_name.ilike.%${query}%,worker_occupation.ilike.%${query}%`);
          }
          const { data: workers } = await q;
          data = workers || [];
          break;
        }
        case 'roommates': {
          let q = supabase
            .from('roommate_profiles')
            .select('id, user_id, budget, gender, occupation, city, state, description, looking_for, move_in_date')
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);
          if (query.trim()) {
            q = q.or(`city.ilike.%${query}%,occupation.ilike.%${query}%`);
          }
          const { data: roommates } = await q;
          data = roommates || [];
          break;
        }
      }

      setHasMore(data.length === limit);
      if (append) {
        setResults(prev => [...prev, ...data]);
      } else {
        setResults(data);
      }
    } catch (e) {
      console.error('Explore search error:', e);
    } finally {
      setLoading(false);
    }
  }, [profile?.user_id]);

  // Load on category change or search
  useEffect(() => {
    setPage(1);
    performSearch(searchQuery, activeCategory, 1, false);
  }, [activeCategory, searchQuery, performSearch]);

  // Debounced search
  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => {
      setPage(1);
    }, 300);
  };

  const loadMore = () => {
    const next = page + 1;
    setPage(next);
    performSearch(searchQuery, activeCategory, next, true);
  };

  const reservationFee = getNumber('reservation_fee', 5000);

  return (
    <div className="min-h-[100dvh] bg-[#0A0A0F] pb-nav overflow-y-auto scrollable-content">
      <Toaster position="top-center" richColors theme="dark" />

      {/* Header */}
      <header className="sticky top-0 z-40 bg-[#0A0A0F]/95 backdrop-blur-md border-b border-white/[0.04]">
        <div className="px-4 pt-4 pb-3">
          <h1 className="text-lg font-bold text-white mb-3">Explore</h1>
          {/* Universal Search */}
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-[#5C5E72]" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder={`Search ${CATEGORIES.find(c => c.id === activeCategory)?.label.toLowerCase()}...`}
              className="w-full h-11 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm pl-10 pr-4 placeholder-[#5C5E72] focus:border-[#3B82F6]/50 focus:outline-none transition-colors"
            />
            {searchQuery && (
              <button onClick={() => { setSearchQuery(''); setPage(1); }} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#5C5E72] hover:text-white">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
              </button>
            )}
          </div>
        </div>

        {/* Category Chips */}
        <div className="flex gap-2 px-4 pb-3 overflow-x-auto scrollbar-hide">
          {CATEGORIES.map(cat => (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              className={`flex-shrink-0 flex items-center gap-1.5 h-9 px-3.5 rounded-xl text-xs font-semibold transition-all whitespace-nowrap ${
                activeCategory === cat.id
                  ? 'bg-gradient-to-r from-[#3B82F6] to-[#2563EB] text-white shadow-lg shadow-blue-500/20'
                  : 'bg-[#1A1A24] border border-[#2A2A3A] text-[#8A8B9C] hover:border-[#3B82F6]/30'
              }`}
            >
              <span>{cat.icon}</span>
              {cat.label}
            </button>
          ))}
        </div>
      </header>

      {/* Results */}
      <div className="px-4 py-4 space-y-3">
        {results.length === 0 && !loading && (
          <div className="text-center py-16">
            <div className="w-16 h-16 rounded-2xl bg-[#1A1A24] flex items-center justify-center mx-auto mb-4">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#5C5E72" strokeWidth="2"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
            </div>
            <p className="text-sm text-[#5C5E72]">
              {searchQuery ? `No ${activeCategory} found for "${searchQuery}"` : `No ${activeCategory} available yet`}
            </p>
          </div>
        )}

        {/* Houses / Apartments */}
        {(activeCategory === 'houses' || activeCategory === 'apartments') && results.map((listing: any) => (
          <button key={listing.id} onClick={() => onNavigate('detail', listing.id)} className="w-full text-left glass rounded-2xl overflow-hidden active:scale-[0.98] transition-transform">
            <div className="relative">
              {listing.images?.[0] ? (
                <img src={listing.images[0]} alt="" className="w-full h-48 object-cover" />
              ) : (
                <div className="w-full h-48 bg-[#1A1A24] flex items-center justify-center text-4xl">🏠</div>
              )}
              <div className="absolute top-3 right-3 flex gap-2">
                <span className="text-[10px] font-bold px-2 py-1 rounded-lg bg-black/60 text-white backdrop-blur-sm">{listing.property_type}</span>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); onToggleSave(listing.id); }}
                className="absolute bottom-3 right-3 w-8 h-8 rounded-full bg-black/60 backdrop-blur-sm flex items-center justify-center"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill={savedIds.has(listing.id) ? '#EF4444' : 'none'} stroke={savedIds.has(listing.id) ? '#EF4444' : 'white'} strokeWidth="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></svg>
              </button>
            </div>
            <div className="p-4">
              <h3 className="text-sm font-semibold text-white truncate">{listing.title || 'Untitled'}</h3>
              <p className="text-[11px] text-[#5C5E72] mt-0.5">{listing.city}, {listing.state}</p>
              <div className="flex items-center justify-between mt-2">
                <span className="text-sm font-bold text-[#3B82F6]">N{(listing.price || 0).toLocaleString()}</span>
                <div className="flex gap-3 text-[10px] text-[#5C5E72]">
                  {listing.bedrooms && <span>{listing.bedrooms} bed</span>}
                  {listing.bathrooms && <span>{listing.bathrooms} bath</span>}
                </div>
              </div>
            </div>
          </button>
        ))}

        {/* Hotels */}
        {activeCategory === 'hotels' && results.map((hotel: any) => (
          <button key={hotel.id} onClick={() => onNavigate('hotel_detail', String(hotel.id))} className="w-full text-left glass rounded-2xl overflow-hidden active:scale-[0.98] transition-transform">
            <div className="relative">
              {hotel.images?.[0] ? (
                <img src={hotel.images[0]} alt="" className="w-full h-48 object-cover" />
              ) : (
                <div className="w-full h-48 bg-[#1A1A24] flex items-center justify-center text-4xl">🏨</div>
              )}
              <div className="absolute top-3 right-3 flex gap-2">
                {hotel.rating && (
                  <span className="text-[10px] font-bold px-2 py-1 rounded-lg bg-black/60 text-amber-400 backdrop-blur-sm flex items-center gap-1">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="#F59E0B" stroke="none"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" /></svg>
                    {hotel.rating}
                  </span>
                )}
              </div>
            </div>
            <div className="p-4">
              <h3 className="text-sm font-semibold text-white">{hotel.name}</h3>
              <p className="text-[11px] text-[#5C5E72] mt-0.5">{hotel.city}, {hotel.state}</p>
              <div className="flex items-center justify-between mt-2">
                <span className="text-sm font-bold text-[#3B82F6]">N{(hotel.base_price || 0).toLocaleString()}<span className="text-[10px] text-[#5C5E72] font-normal">/night</span></span>
                {hotel.review_count ? <span className="text-[10px] text-[#5C5E72]">{hotel.review_count} reviews</span> : null}
              </div>
            </div>
          </button>
        ))}

        {/* Workers */}
        {activeCategory === 'workers' && results.map((worker: any) => (
          <button key={worker.user_id} onClick={() => onNavigate('worker_discovery')} className="w-full text-left glass rounded-2xl p-4 flex items-center gap-3 active:scale-[0.98] transition-transform">
            <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-[#3B82F6] to-[#2563EB] flex items-center justify-center text-white text-lg font-bold flex-shrink-0">
              {worker.avatar_url ? <img src={worker.avatar_url} alt="" className="w-full h-full rounded-xl object-cover" /> : (worker.full_name || worker.username || 'W').charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-white truncate">{worker.full_name || worker.username || 'Worker'}</h3>
                {worker.worker_verified && <svg width="12" height="12" viewBox="0 0 24 24" fill="#3B82F6" stroke="none"><path d="M9 12l2 2 4-4M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" /></svg>}
              </div>
              <p className="text-[11px] text-[#5C5E72] truncate">{worker.worker_occupation || 'Service Provider'}</p>
              <div className="flex items-center gap-3 mt-1">
                {worker.worker_price ? <span className="text-xs font-medium text-[#3B82F6]">N{Number(worker.worker_price).toLocaleString()}</span> : null}
                {worker.worker_rating ? <span className="text-[10px] text-amber-400 flex items-center gap-0.5"><svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" /></svg>{worker.worker_rating}</span> : null}
                <span className="text-[10px] text-[#5C5E72]">{worker.city || 'Nigeria'}</span>
              </div>
            </div>
          </button>
        ))}

        {/* Roommates */}
        {activeCategory === 'roommates' && results.map((rm: any) => (
          <button key={rm.id} onClick={() => onNavigate('roommate')} className="w-full text-left glass rounded-2xl p-4 active:scale-[0.98] transition-transform">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-pink-500 to-rose-700 flex items-center justify-center text-white text-sm font-bold">
                {(rm.occupation || 'R').charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-semibold text-white truncate">{rm.occupation || 'Looking for roommate'}</h3>
                <p className="text-[10px] text-[#5C5E72]">{rm.city}, {rm.state} · {rm.gender || 'Any gender'}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 text-[11px]">
              {rm.budget && <span className="text-[#3B82F6] font-medium">Budget: N{Number(rm.budget).toLocaleString()}</span>}
              {rm.looking_for && <span className="text-[#5C5E72]">Looking: {rm.looking_for}</span>}
            </div>
          </button>
        ))}

        {/* Loading */}
        {loading && (
          <div className="flex justify-center py-6">
            <div className="w-6 h-6 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {/* Load More */}
        {hasMore && results.length > 0 && !loading && (
          <button onClick={loadMore} className="w-full h-11 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-[#8A8B9C] text-sm font-medium hover:border-[#3B82F6]/30 transition-colors">
            Load More
          </button>
        )}
      </div>
    </div>
  );
}
