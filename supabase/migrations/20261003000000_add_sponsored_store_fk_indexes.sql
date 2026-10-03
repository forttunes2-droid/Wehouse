-- Cover the two currently unindexed foreign keys identified by the production
-- Supabase performance advisor. These indexes support referential checks and
-- future owner/account lookups without changing application behavior.
create index if not exists sponsored_store_products_updated_by_idx
  on public.sponsored_store_products(updated_by);

create index if not exists sponsored_store_transactions_account_user_id_idx
  on public.sponsored_store_transactions(account_user_id);
