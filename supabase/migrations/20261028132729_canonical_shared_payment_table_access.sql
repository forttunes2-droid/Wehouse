-- Shared housing is the compatibility projection of the same payment group.
-- Its current callers use scoped SECURITY DEFINER commands. The payment-init
-- service still reads members with service_role, which is unchanged here.
-- Prevent future browser code from treating either table family as an alternate
-- checkout/participant writer or bypassing the field-safe group projection.
revoke all on table public.shared_housing_groups, public.shared_housing_members,
 public.shared_payment_groups, public.shared_payment_members from public,anon,authenticated;

-- The retired generic payment generation is private by RLS and has no active
-- browser or Edge consumer. Retain its records, but remove obsolete browser
-- grants rather than leaving another apparent payment interface.
revoke all on table public.payments from public,anon,authenticated;
