BEGIN;

-- The tenancy scheduler upserts by (rent_plan_id,target_year,installment_number).
-- A partial unique index cannot be inferred by ON CONFLICT unless the same
-- predicate is supplied. A normal unique index is correct here because legacy
-- NULL target/installment rows remain allowed (PostgreSQL treats NULLs as
-- distinct), while scheduled rows are protected from duplicates.
DROP INDEX IF EXISTS public.rent_plan_contributions_schedule_unique;
CREATE UNIQUE INDEX rent_plan_contributions_schedule_unique
ON public.rent_plan_contributions(rent_plan_id,target_year,installment_number);

COMMIT;
