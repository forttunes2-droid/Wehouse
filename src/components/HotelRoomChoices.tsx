import { useId } from 'react';
import type { HotelRatePlan, HotelRoom } from '@/types';
import PropertyMediaCarousel from '@/components/PropertyMediaCarousel';
import ShowcaseMediaThumbnail from '@/components/ShowcaseMediaThumbnail';
import { formatMoney } from "@/lib/regional";

type Props = { rooms: HotelRoom[]; roomId?: number; rateId?: number; nights: number; onRoom: (room: HotelRoom) => void; onRate: (rate: HotelRatePlan) => void };
const money = (value: number) => `${formatMoney(value)}`;
const meals = { room_only: 'Room only', breakfast: 'Breakfast included', half_board: 'Breakfast + one meal', full_board: 'All daily meals', all_inclusive: 'All inclusive' };
const timing = { pay_now: 'Pay now', before_arrival: 'Pay before arrival', at_property: 'Pay at property' };

/** One room, its media and its offers stay together. Selection changes no booking,
 * price, cancellation policy or payment state; the parent owns those choices. */
export default function HotelRoomChoices({ rooms, roomId, rateId, nights, onRoom, onRate }: Props) {
  const id = useId();
  return <section id="hotel-room-options" className="scroll-mt-4" aria-label="Room choices">
    <h2 className="mb-4 text-lg font-semibold">Choose a room</h2>
    {!rooms.length ? <p className="border-y border-[var(--wh-border-subtle)] py-5 text-sm text-[var(--wh-text-secondary)]">No rooms are currently available.</p> : <div className="space-y-4">
      {rooms.map(room => {
        const active = roomId === room.room_id;
        const rates = (room.rate_plans || []).filter(rate => rate.active);
        const prices = rates.map(rate => Number(rate.price_per_night)).filter(price => Number.isFinite(price) && price > 0);
        const starting = prices.length ? Math.min(...prices) : null;
        const images = (room.images || []).filter(Boolean);
        const panelId = `${id}-${room.room_id}`;
        return <article key={room.room_id} data-room-choice={room.room_id} className={`rounded-2xl border bg-[var(--wh-surface)] p-4 ${active ? 'border-violet-500/35' : 'border-[var(--wh-border-subtle)]'}`}>
          <button type="button" aria-expanded={active} aria-controls={panelId} onClick={() => onRoom(room)} className="flex min-h-24 w-full items-start gap-3 text-left">
            <span className="grid h-24 w-24 shrink-0 place-items-center overflow-hidden rounded-xl bg-[var(--wh-interactive)] text-[var(--wh-text-secondary)]">{images[0] ? <ShowcaseMediaThumbnail src={images[0]} mediaType="image" alt={`${room.room_type} room`} /> : <svg aria-hidden="true" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 18v-7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v7M3 14h18M5 9V5h14v4M8 9V7m8 2V7M3 18v2m18-2v2" /></svg>}</span>
            <span className="min-w-0 flex-1"><span className="block break-words text-base font-semibold">{room.room_type}</span><span className="mt-1 block text-sm leading-6 text-[var(--wh-text-secondary)]">{[room.bed_type, room.max_guests ? `Up to ${room.max_guests} guests` : null].filter(Boolean).join(' · ')}</span>{starting !== null && <span className="mt-2 block text-sm"><strong className="font-semibold">From {money(starting)}</strong><span className="text-[var(--wh-text-secondary)]"> / night</span></span>}</span>
            <span className="pt-1 text-sm text-[var(--wh-accent-text)]" aria-hidden="true">{active ? '✓' : '⌄'}</span>
          </button>
          {active && <div id={panelId} className="pt-4">
            {images.length ? <div className="overflow-hidden rounded-xl"><PropertyMediaCarousel images={images} title={room.room_type} /></div> : <p className="text-sm text-[var(--wh-text-secondary)]">Room photos are not available.</p>}
            {room.description && <p className="mt-4 text-sm leading-6 text-[var(--wh-text-secondary)]">{room.description}</p>}
            {!!room.amenities?.length && <p className="mt-3 text-sm leading-6 text-[var(--wh-text-secondary)]">{room.amenities.join(' · ')}</p>}
            <div id="hotel-package-options" className="mt-5 scroll-mt-4">
              <h3 className="text-base font-semibold">Choose a package</h3>
              {!rates.length ? <p className="py-4 text-sm text-[var(--wh-text-secondary)]">No packages are available for this room.</p> : <div className="mt-3 grid gap-3 sm:grid-cols-2" role="group" aria-label={`${room.room_type} packages`}>
                {rates.map(rate => {
                  const selected = rate.rate_plan_id === rateId;
                  const nightly = Number(rate.price_per_night);
                  const valid = Number.isFinite(nightly) && nightly > 0;
                  const refundable = rate.refundable && Number.isFinite(rate.cancellation_hours) && Number(rate.cancellation_hours) >= 0;
                  return <button type="button" key={rate.rate_plan_id} aria-pressed={selected} disabled={!valid} onClick={() => onRate(rate)} className={`w-full rounded-xl border p-4 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:opacity-50 ${selected ? 'border-violet-500/50 bg-violet-500/[.06]' : 'border-[var(--wh-border-subtle)] bg-[var(--wh-bg)]'}`}>
                    <span className="flex flex-wrap items-start justify-between gap-3"><span className="min-w-0 flex-1 break-words text-sm font-semibold">{rate.name}</span><span className="min-w-0 max-w-full break-words text-right text-sm font-semibold">{valid ? money(nightly * (nights > 0 ? nights : 1)) : 'Price unavailable'}<span className="block text-xs font-normal text-[var(--wh-text-secondary)]">{nights > 0 ? `for ${nights} night${nights === 1 ? '' : 's'}` : 'per night'}</span></span></span>
                    {String(rate.name||'').trim().toLowerCase() !== meals[rate.meal_plan]?.toLowerCase() && <span className="mt-3 block text-sm leading-6 text-[var(--wh-text-secondary)]">{meals[rate.meal_plan] || 'Meal details unavailable'}</span>}
                    <span className="block text-sm leading-6 text-[var(--wh-text-secondary)]">{!rate.refundable ? 'Non-refundable' : refundable ? `Refundable · cancel at least ${rate.cancellation_hours} hours before check-in` : 'Refundable · review the cancellation terms'}</span>
                    <span className="block text-sm leading-6 text-[var(--wh-text-secondary)]">{timing[rate.payment_timing] || 'Review payment terms'}</span>
                    {!!rate.included_features?.length && <span className="mt-2 block text-sm leading-6 text-[var(--wh-text-secondary)]">{rate.included_features.join(' · ')}</span>}
                    {selected && <span className="mt-3 block text-xs font-semibold text-[var(--wh-accent-text)]">Selected</span>}
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
