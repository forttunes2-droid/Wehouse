import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import ListingCard from '@/components/ListingCard';
import type { Listing, Profile } from '@/types';

interface SavedProps {
  profile: Profile;
  onNavigate: (page: string, listingId?: string) => void;
  savedIds: Set<string>;
  onToggleSave: (listingId: string) => void;
}

export default function Saved({ profile, onNavigate, savedIds, onToggleSave }: SavedProps) {
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      if (savedIds.size === 0) { setListings([]); setLoading(false); return; }
      const { data } = await supabase.from('listings').select('*').in('id', Array.from(savedIds)).eq('availability_status', 'available');
      setListings(data || []);
      setLoading(false);
    }
    load();
  }, [savedIds]);

  return (
    <div className="min-h-screen bg-transparent pb-24">
      <header className="bg-gradient-to-b from-[#12121A] to-[#0A0A0F] px-5 pt-6 pb-5">
        <h1 className="text-lg font-bold text-white">Saved Homes</h1>
        <p className="text-[10px] text-[#5C5E72] mt-0.5">@{profile.username}</p>
      </header>

      <div className="px-5 pt-4">
        {loading ? (
          <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" /></div>
        ) : listings.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-14 h-14 rounded-2xl bg-[#1A1A24] flex items-center justify-center mx-auto mb-3">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#5C5E72" strokeWidth="1.5"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" /></svg>
            </div>
            <p className="text-sm text-[#5C5E72]">No saved homes yet</p>
            <button onClick={() => onNavigate('home')} className="mt-2 text-xs text-[#3B82F6] font-medium">Browse homes</button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {listings.map(l => (
              <ListingCard key={l.id} listing={l} onClick={() => onNavigate('detail', l.id)} isSaved={true} onToggleSave={(e) => { e.stopPropagation(); onToggleSave(l.id); }} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
