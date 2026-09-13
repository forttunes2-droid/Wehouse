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
      setHotels(((hotelResult.hotels || []) as SavedHotel[]).filter((hotel) => ids.has(Number(hotel.hotel_id))));
      setLoading(false);
    }
    void load();
    return () => { active = false; };
  }, [profile.user_id, savedIds]);

  async function removeHotel(hotelId: number) {
    if (busyHotel !== null) return;
    setBusyHotel(hotelId);
    const { error } = await unsaveHotel(hotelId);
    setBusyHotel(null);
    if (error) return toast.error(error.message || 'Hotel could not be removed from Saved');
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
            <p className="mt-1 max-w-xl text-[10px] leading-relaxed text-[#777A8C]">Homes and hotels you saved for later. Saving is private and never starts a booking.</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-9 px-4 py-5 sm:px-5 lg:px-8">
        {loading ? (
          <div className="grid min-h-56 place-items-center"><div className="h-7 w-7 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" /></div>
        ) : (
          <>
            <section>
              <div className="mb-3"><h2 className="text-sm font-semibold">Saved apartments</h2><p className="mt-1 text-[9px] text-[#707687]">Tap the heart again to remove an apartment from Saved.</p></div>
              {listings.length === 0 ? (
                <Empty title="No saved apartments" text="Use the heart on an apartment to keep it here." action="Browse apartments" onAction={() => onNavigate('search')} />
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {listings.map((listing) => (
                    <ListingCard key={listing.id} listing={listing} onClick={() => onNavigate('detail', listing.id)} isSaved onToggleSave={(event) => { event.preventDefault(); event.stopPropagation(); onToggleSave(listing.id); }} />
                  ))}
                </div>
              )}
            </section>

            <section>
              <div className="mb-3"><h2 className="text-sm font-semibold">Saved hotels</h2><p className="mt-1 text-[9px] text-[#707687]">Saved hotels are separate from Follow Search alerts.</p></div>
              {hotels.length === 0 ? (
                <Empty title="No saved hotels" text="Use the heart on a hotel to keep it here." action="Browse hotels" onAction={() => onNavigate('hotels')} />
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
  const roomTypes = hotel.hotel_rooms?.length || 0;
  return (
    <article className="flex items-center gap-3 py-4">
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <div className="h-20 w-24 shrink-0 overflow-hidden rounded-xl bg-[#171B24]">
          {hotel.images?.[0] ? <img src={hotel.images[0]} alt="" loading="lazy" className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center text-[8px] text-[#666D7E]">No photo</div>}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold">{hotel.name}</h3>
          <p className="mt-1 truncate text-[9px] text-[#707687]">{[hotel.area, hotel.city, hotel.state].filter(Boolean).join(', ')}</p>
          <p className="mt-2 text-[9px] text-violet-300">{roomTypes ? `${roomTypes} room ${roomTypes === 1 ? 'type' : 'types'} · choose inside` : 'View hotel details'}</p>
        </div>
      </button>
      <button type="button" disabled={busy} onClick={(event) => { event.preventDefault(); event.stopPropagation(); onRemove(); }} aria-label={`Remove ${hotel.name} from Saved`} className="grid h-10 w-10 shrink-0 place-items-center text-violet-300 active:scale-95 disabled:opacity-40">
        <Heart filled />
      </button>
    </article>
  );
}

function Empty({ title, text, action, onAction }: { title: string; text: string; action: string; onAction: () => void }) {
  return <div className="border-y border-dashed border-white/[.07] py-10 text-center"><p className="text-xs font-semibold">{title}</p><p className="mt-2 text-[9px] text-[#707687]">{text}</p><button type="button" onClick={onAction} className="mt-4 rounded-full border border-violet-500/20 px-4 py-2.5 text-[10px] font-semibold text-violet-300">{action}</button></div>;
}

function Heart({ filled = false }: { filled?: boolean }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78Z"/></svg>;
}
