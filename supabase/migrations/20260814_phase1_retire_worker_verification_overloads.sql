BEGIN;

-- Retire pre-external-KYC Worker verification RPC signatures. The active
-- frontend compatibility flow is the 13-argument professional-profile RPC;
-- government identity will be handed to the external provider in Phase 4.
REVOKE ALL ON FUNCTION public.save_my_worker_verification(
  text,text,text,text,text,text,text[],text,text,text,text,text,integer,uuid,uuid
) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.save_my_worker_verification(
  text,text,text,text,text,text,text[],text,text,text,text,text,text,integer,uuid,uuid
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.save_my_worker_verification(
  text,text,text,text,text,text,text[],text,text,text,text,text,integer,uuid,uuid
) TO service_role;

GRANT EXECUTE ON FUNCTION public.save_my_worker_verification(
  text,text,text,text,text,text,text[],text,text,text,text,text,text,integer,uuid,uuid
) TO service_role;

COMMIT;
