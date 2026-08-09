BEGIN;
-- Audited before removal: zero rows, no frontend references, no foreign-key dependants.
-- Canonical staff identity is profiles(role='staff'); module assignment is staff_permissions.
DROP TABLE IF EXISTS public.staff;
COMMIT;
