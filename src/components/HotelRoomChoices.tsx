import { useId } from 'react';
import type { HotelRatePlan, HotelRoom } from '@/types';
import PropertyMediaCarousel from '@/components/PropertyMediaCarousel';
import ShowcaseMediaThumbnail from '@/components/ShowcaseMediaThumbnail';

type Props = { rooms: HotelRoom[]; roomId?: number; rateId?: number; nights: number; onRoom: (room: HotelRoom) => void; onRate: (rate: HotelRatePlan) => void };
const money = (value: number) => `₦${value.toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;
const meals = { room_only: 'Room only', breakfast: 'Breakfast included', half_board: 'Breakfast + one meal', full_board: 'All daily meals', all_inclusive: 'All inclusive' };
const timing = { pay_now: 'Pay now', before_arrival: 'Pay before arrival', at_property: 'Pay at property' };

/** One room, its media and its offers stay together. Selection changes no booking,
 * price, cancellation policy or payment state; the parent owns those choices. */
export default function HotelRoomChoices({ rooms, roomId, rateId, nights, onRoom, onRate }: Props) {
  const id = useId();
  return <section id="hotel-room-options" className="scroll-mt-4" aria-label="Room choices">
    <h2 className="mb-4 text-lg font-semibold">Choose a room</h2>
    {!rooms.length ? <p className="border-y border-white/10 py-5 text-sm text-[#A7ADBA]">No rooms are currently available.</p> : <div className="divide-y divide-white/10 border-y border-white/10">
      {rooms.map(room => {
        const active = roomId === room.room_id;
        const rates = (room.rate_plans || []).filter(rate => rate.active);
        const prices = rates.map(rate => Number(rate.price_per_night)).filter(price => Number.isFinite(price) && price > 0);
        const starting = prices.length ? Math.min(...prices) : null;
        const images = (room.images || []).filter(Boolean);
        const panelId = `${id}-${room.room_id}`;
        return <article key={room.room_id} data-room-choice={room.room_id} className="py-4">
          <button type="button" aria-expanded={active} aria-controls={panelId} onClick={() => onRoom(room)} className="flex min-h-24 w-full items-start gap-3 text-left">
            {images[0] && <span className="block h-24 w-24 shrink-0 overflow-hidden rounded-xl"><ShowcaseMediaThumbnail src={images[0]} mediaType="image" alt={`${room.room_type} room`} /></span>}
            <span className="min-w-0 flex-1"><span className="block text-base font-semibold">{room.room_type}</span><span className="mt-1 block text-sm leading-6 text-[#A7ADBA]">{[room.bed_type, room.max_guests ? `Up to ${room.max_guests} guests` : null].filter(Boolean).join(' · ')}</span>{starting !== null && <span className="mt-2 block text-sm"><strong className="font-semibold">From {money(starting)}</strong><span className="text-[#A7ADBA]"> / night</span></span>}</span>
            <span className="pt-1 text-sm text-violet-300" aria-hidden="true">{active ? '✓' : '⌄'}</span>
          </button>
          {active && <div id={panelId} className="pt-4">
            {images.length ? <div className="overflow-hidden rounded-xl"><PropertyMediaCarousel images={images} title={room.room_type} /></div> : <p className="text-sm text-[#A7ADBA]">Room photos are not available.</p>}
            {room.description && <p className="mt-4 text-sm leading-6 text-[#BCC2CF]">{room.description}</p>}
            {!!room.amenities?.length && <p className="mt-3 text-sm leading-6 text-[#A7ADBA]">{room.amenities.join(' · ')}</p>}
            <div id="hotel-package-options" className="mt-5 scroll-mt-4">
              <h3 className="text-base font-semibold">Choose a package</h3>
              {!rates.length ? <p className="py-4 text-sm text-[#A7ADBA]">No packages are available for this room.</p> : <div className="mt-3 space-y-3" role="group" aria-label={`${room.room_type} packages`}>
                {rates.map(rate => {
                  const selected = rate.rate_plan_id === rateId;
                  const nightly = Number(rate.price_per_night);
                  const valid = Number.isFinite(nightly) && nightly > 0;
                  const refundable = rate.refundable && Number.isFinite(rate.cancellation_hours) && Number(rate.cancellation_hours) >= 0;
                  return <button type="button" key={rate.rate_plan_id} aria-pressed={selected} disabled={!valid} onClick={() => onRate(rate)} className={`w-full rounded-xl border p-4 text-left focus-visible:ring-2 focus-visible:ring-violet-300 disabled:opacity-50 ${selected ? 'border-violet-400 bg-violet-500/[.07]' : 'border-white/10 bg-transparent'}`}>
                    <span className="flex flex-wrap items-start justify-between gap-3"><span className="min-w-0 flex-1 text-sm font-semibold">{rate.name}</span><span className="text-right text-sm font-semibold">{valid ? money(nightly * (nights > 0 ? nights : 1)) : 'Price unavailable'}<span className="block text-xs font-normal text-[#A7ADBA]">{nights > 0 ? `for ${nights} night${nights === 1 ? '' : 's'}` : 'per night'}</span></span></span>
                    <span className="mt-3 block text-sm leading-6 text-[#BCC2CF]">{meals[rate.meal_plan] || 'Meal details unavailable'}</span>
                    <span className="block text-sm leading-6 text-[#BCC2CF]">{!rate.refundable ? 'Non-refundable' : refundable ? `Refundable · cancel at least ${rate.cancellation_hours} hours before check-in` : 'Refundable · review the cancellation terms'}</span>
                    <span className="block text-sm leading-6 text-[#A7ADBA]">{timing[rate.payment_timing] || 'Review payment terms'}</span>
                    {!!rate.included_features?.length && <span className="mt-2 block text-sm leading-6 text-[#BCC2CF]">{rate.included_features.join(' · ')}</span>}
                    {selected && <span className="mt-3 block text-xs font-semibold text-violet-300">Selected</span>}
                  </button>;
                })}
              </div>}
            </div>
          </div>}
        </article>;
      })}
    </div>}
  </section>;
}
