-- The canonical lifecycle migration briefly added a second index equivalent
-- to hotels_one_per_inspection_idx. Preserve the established index only.
drop index if exists public.hotels_one_per_inspection_request_idx;
