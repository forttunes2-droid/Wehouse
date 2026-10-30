begin;
-- Account readiness is the normal verified payout bank, not a direct Paystack
-- subaccount. Collection and release remain governed by Payment Protection.
create or replace function private.long_let_settlement_account(p_listing_id uuid) returns uuid
language sql stable security definer set search_path='' as $fn$
 select b.id from public.bank_accounts b join public.listings l on l.id=p_listing_id
 where b.user_id=coalesce(l.partner_id,l.owner_id) and b.is_default and b.is_active
  and b.verified_at is not null
 order by b.id limit 1;
$fn$;
revoke all on function private.long_let_settlement_account(uuid) from public,anon,authenticated;
commit;
