BEGIN;
REVOKE ALL ON FUNCTION public.get_my_staff_worker_reviews(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_staff_worker_reviews(text) TO authenticated, service_role;
COMMIT;
