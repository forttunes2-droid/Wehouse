-- cost_ngn is the sole stored business input. Keep the older read name as a
-- generated projection so it can never disagree or become a second writer.
-- No cost data is discarded: require equality before replacing a legacy column.
do $$
declare v_generated text;
begin
  select is_generated into v_generated from information_schema.columns
    where table_schema='public' and table_name='worker_pro_job_costs' and column_name='amount';
  if v_generated='NEVER' then
    if exists(select 1 from public.worker_pro_job_costs where amount is distinct from cost_ngn) then
      raise exception 'Job cost amounts differ; reconcile provenance before migrating';
    end if;
    alter table public.worker_pro_job_costs drop column amount;
  end if;
  if v_generated is distinct from 'ALWAYS' then
    alter table public.worker_pro_job_costs
      add column amount numeric generated always as (cost_ngn) stored;
  end if;
end $$;
alter table public.worker_pro_job_costs drop constraint if exists worker_pro_job_costs_canonical_range;
alter table public.worker_pro_job_costs add constraint worker_pro_job_costs_canonical_range
  check(cost_ngn>=0 and cost_ngn<=10000000 and cost_ngn=round(cost_ngn,2));
comment on column public.worker_pro_job_costs.cost_ngn is 'Canonical job cost; all commands write this column.';
comment on column public.worker_pro_job_costs.amount is 'Read compatibility projection of cost_ngn; generated and never independently writable.';
notify pgrst, 'reload schema';
