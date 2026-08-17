CREATE EXTENSION IF NOT EXISTS btree_gist;
DROP INDEX IF EXISTS public.reservations_one_live_hold_per_listing;
CREATE UNIQUE INDEX reservations_one_live_long_stay_per_listing ON public.reservations(listing_id) WHERE COALESCE(stay_type,'long_stay')<>'short_let' AND status IN ('payment_pending','reserved','inspection_pending','ready_for_move_in','occupied');
ALTER TABLE public.reservations DROP CONSTRAINT IF EXISTS reservations_no_overlapping_short_stays;
ALTER TABLE public.reservations ADD CONSTRAINT reservations_no_overlapping_short_stays EXCLUDE USING gist (listing_id WITH =,daterange(stay_check_in,stay_check_out,'[)') WITH &&) WHERE (stay_type='short_let' AND status IN ('payment_pending','reserved','inspection_pending','ready_for_move_in','occupied'));
