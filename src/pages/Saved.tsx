import { useEffect, useState } from 'react';
import { getAllListings, getHotels } from '@/lib/supabase';
import ListingCard from '@/components/ListingCard';
import type { Hotel, Listing, Profile } from '@/types';
import { Toaster, toast } from 'sonner';
import BackButton from '@/components/BackButton';
import { getMySavedHotelIds, unsaveHotel } from '@/lib/supabase/saved-hotels';

interface SavedProps {
  profile: Profile;
  onNavigate: (page: string, listingId?: string) => void;
  savedIds: Set<string>;
  onToggleSave: (listingId: string) => void;
  onBack: () => void;
}

type SavedHotel = Hotel & {
  hotel_rooms?: Array<{ room_id: number; price_per_night: number; room_type: string }>;
};

export default function Saved({ profile, onNavigate, savedIds, onToggleSave, onBack }: SavedProps) {
  const [listings, setListings] = useState<Listing[]>([]);
  const [hotels, setHotels] = useState<SavedHotel[]>([]);
  const [savedHotelIds, setSavedHotelIds] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busyHotel, setBusyHotel] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      const [listingResult, hotelIdsResult, hotelResult] = await Promise.all([
        savedIds.size ? getAllListings() : Promise.resolve({ listings: [] as Listing[] }),
        getMySavedHotelIds(),
        getHotels(),
      ]);
      if (!active) return;
      const ids = new Set(hotelIdsResult.hotelIds);
      setListings((listingResult.listings || []).filter((listing) => savedIds.has(listing.id)));
      setSavedHotelIds(ids);
      setHotels(((hotelResult.hotels || []) as SavedHotel[]).filter((hotel) => ids.has(Number(hotel.hotel_id))));
      setLoading(false);
    }
    void load();
    return () => { active = false; };
  }, [profile.user_id, savedIds]);

  async function removeHotel(hotelId: number) {
    if (busyHotel) return;
    setBusyHotel(hotelId);
    const { error } = await unsaveHotel(hotelId);
    setBusyHotel(null);
    if (error) return toast.error(error.message || 'Hotel could not be removed from Saved');
    setSavedHotelIds((current) => {
      const next = new Set(current);
      next.delete(hotelId);
      return next;
    });
    setHotels((current) => current.filter((hotel) => Number(hotel.hotel_id) !== hotelId));
    toast.success('Hotel removed from Saved');
  }

  return (
    <div className="min-h-screen bg-[#090B10] pb-24 text-white">
      <Toaster position="top-center" richColors />
      <header className="sticky top-0 z-30 border-b border-white/[0.055] bg-[#090B10]/95 px-4 py-4 backdrop-blur-xl sm:px-5 lg:px-8">
        <div className="mx-auto flex max-w-5xl items-start gap-3">
          <BackButton onClick={onBack} />
          <div className="min-w-0">
            <p className="text-[9px] font-bold uppercase tracking-[.22em] text-violet-400">WEHOUSE · ACCOUNT</p>
            <h1 className="mt-1 text-xl font-bold">Saved</h1>
            <p className="mt-1 max-w-xl text-[10px] leading-relaxed text-[#777A8C]">Homes and hotels you bookmarked for later.</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-9 px-4 py-5 sm:px-5 lg:px-8">
        {loading ? (
          <div className="grid min-h-56 place-items-center"><div className="h-7 w-7 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" /></div>
        ) : (
          <>
            <section>
              <div className="mb-3"><h2 className="text-sm font-semibold">Saved apartments</h2><p className="mt-1 text-[9px] text-[#707687]">A bookmark only. Saving never starts a booking.</p></div>
              {listings.length === 0 ? (
                <Empty title="No saved apartments" text="Use the bookmark on an apartment to keep it here." action="Browse apartments" onAction={() => onNavigate('search')} />
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {listings.map((listing) => (
                    <ListingCard key={listing.id} listing={listing} onClick={() => onNavigate('detail', listing.id)} isSaved onToggleSave={(event) => { event.stopPropagation(); onToggleSave(listing.id); }} />
                  ))}
                </div>
              )}
            </section>

            <section>
              <div className="mb-3"><h2 className="text-sm font-semibold">Saved hotels</h2><p className="mt-1 text-[9px] text-[#707687]">Hotels you bookmarked. This is separate from following a search.</p></div>
              {hotels.length === 0 ? (
                <Empty title="No saved hotels" text="Use the bookmark on a hotel to keep it here." action="Browse hotels" onAction={() => onNavigate('hotels')} />
              ) : (
                <div className="divide-y divide-white/[.06] border-y border-white/[.06]">
                  {hotels.map((hotel) => (
                    <SavedHotelRow
                      key={hotel.hotel_id}
                      hotel={hotel}
                      busy={busyHotel === Number(hotel.hotel_id)}
                      onOpen={() => onNavigate('hotel_detail', String(hotel.hotel_id))}
                      onRemove={() => void removeHotel(Number(hotel.hotel_id))}
                    />
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function SavedHotelRow({ hotel, busy, onOpen, onRemove }: { hotel: SavedHotel; busy: boolean; onOpen: () => void; onRemove: () => void }) {
  const prices = (hotel.hotel_rooms || []).map((room) => Number(room.price_per_night || 0)).filter((price) => price > 0);
  const from = prices.length ? Math.min(...prices) : 0;
  return (
    <article className="flex items-center gap-3 py-4">
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <div className="h-20 w-24 shrink-0 overflow-hidden rounded-xl bg-[#171B24]">
          {hotel.images?.[0] ? <img src={hotel.images[0]} alt="" loading="lazy" className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center text-[8px] text-[#666D7E]">No photo</div>}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold">{hotel.name}</h3>
          <p className="mt-1 truncate text-[9px] text-[#707687]">{[hotel.area, hotel.city, hotel.state].filter(Boolean).join(', ')}</p>
          {from > 0 ? <p className="mt-2 text-[10px] font-semibold text-violet-200">From ₦{from.toLocaleString()} / night</p> : null}
        </div>
      </button>
      <button type="button" disabled={busy} onClick={onRemove} aria-label={`Remove ${hotel.name} from Saved`} className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-violet-500/20 text-violet-300 disabled:opacity-40">
        <Bookmark filled />
      </button>
    </article>
  );
}

function Empty({ title, text, action, onAction }: { title: string; text: string; action: string; onAction: () => void }) {
  return <div className="border-y border-dashed border-white/[.07] py-10 text-center"><p className="text-xs font-semibold">{title}</p><p className="mt-2 text-[9px] text-[#707687]">{text}</p><button type="button" onClick={onAction} className="mt-4 rounded-full border border-violet-500/20 px-4 py-2.5 text-[10px] font-semibold text-violet-300">{action}</button></div>;
}

function Bookmark({ filled = false }: { filled?: boolean }) {
  return <svg width="17" height="17" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 3.75A1.75 1.75 0 0 1 7.75 2h8.5A1.75 1.75 0 0 1 18 3.75V22l-6-3.75L6 22V3.75Z"/></svg>;
}
