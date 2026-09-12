-- Payout account changes are economic-routing mutations. A client timeout must not
-- turn an in-flight change into a second independent mutation.

create table if not exists public.payout_account_change_requests (
  request_id uuid primary key,
  user_id text not null,
  bank_code text not null,
  bank_name text not null,
  account_number text not null,
  account_name text not null,
  recipient_code text,
  status text not null default 'processing'
    check (status in ('processing','uncertain','succeeded','failed')),
  bank_account_id uuid references public.bank_accounts(id) on delete set null,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists payout_account_change_requests_user_status_idx
  on public.payout_account_change_requests(user_id, status, updated_at desc);

alter table public.payout_account_change_requests enable row level security;
revoke all on table public.payout_account_change_requests from anon, authenticated;
grant select, insert, update on table public.payout_account_change_requests to service_role;

create or replace function public.set_default_payout_account_for_user(
  p_user_id text,
  p_account_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account public.bank_accounts%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role required';
  end if;

  -- Serialize default-account changes for this user so two requests cannot leave
  -- competing defaults or a momentarily missing default.
  perform 1
  from public.bank_accounts
  where user_id = p_user_id and is_active = true
  for update;

  select * into v_account
  from public.bank_accounts
  where id = p_account_id
    and user_id = p_user_id
    and is_active = true
    and verified_at is not null;

  if not found then
    raise exception 'verified payout account not found';
  end if;

  update public.bank_accounts
  set is_default = (id = p_account_id),
      updated_at = now()
  where user_id = p_user_id
    and is_active = true
    and is_default is distinct from (id = p_account_id);

  -- Keep the compatibility wallet mirror aligned until the legacy fields are
  -- formally retired. Withdrawals themselves read bank_accounts.
  update public.wallets
  set bank_name = v_account.bank_name,
      bank_account_number = v_account.account_number,
      bank_account_name = v_account.account_name,
      paystack_recipient_code = v_account.recipient_code,
      updated_at = now()
  where owner_id = p_user_id;

  return jsonb_build_object(
    'id', v_account.id,
    'user_id', v_account.user_id,
    'bank_code', v_account.bank_code,
    'bank_name', v_account.bank_name,
    'account_number', v_account.account_number,
    'account_name', v_account.account_name,
    'recipient_code', v_account.recipient_code,
    'verified_at', v_account.verified_at,
    'is_default', true,
    'is_active', v_account.is_active
  );
end;
$$;

revoke all on function public.set_default_payout_account_for_user(text, uuid) from public, anon, authenticated;
grant execute on function public.set_default_payout_account_for_user(text, uuid) to service_role;
