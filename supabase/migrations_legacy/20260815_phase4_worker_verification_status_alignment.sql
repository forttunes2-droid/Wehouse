BEGIN;

ALTER TABLE public.worker_verifications
  DROP CONSTRAINT IF EXISTS worker_verifications_status_check;

ALTER TABLE public.worker_verifications
  ADD CONSTRAINT worker_verifications_status_check
  CHECK (
    status IS NULL OR status = ANY (
      ARRAY[
        'draft'::text,
        'pending'::text,
        'verification_paid'::text,
        'evidence_ready'::text,
        'profile_under_review'::text,
        'verified'::text,
        'rejected'::text
      ]
    )
  );

COMMIT;
