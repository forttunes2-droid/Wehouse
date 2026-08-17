BEGIN;

-- Drop legacy checks before canonical values are normalized by the main
-- Phase-1 migration. Keeping the old checks during UPDATE would reject the
-- new Worker status vocabulary.
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_worker_status_check;

ALTER TABLE public.worker_verifications
  DROP CONSTRAINT IF EXISTS worker_verifications_status_check;

-- The corrected Worker review flow records explicit review states. The old
-- review-history check accepted only approved/rejected and would reject the
-- newer profile_under_review/verified audit events.
ALTER TABLE public.worker_verification_reviews
  DROP CONSTRAINT IF EXISTS worker_verification_reviews_action_check;

ALTER TABLE public.worker_verification_reviews
  ADD CONSTRAINT worker_verification_reviews_action_check
  CHECK (action IN ('profile_under_review','verified','rejected','approved'));

COMMIT;
