-- Paid home and hotel placements should be visible to guests in the same
-- public discovery surfaces as the underlying listings. The function itself
-- still requires authentication for Worker placements and checks eligibility.
grant execute on function public.get_sponsored_discovery(text,text,text,text,integer) to anon;
