-- Fix: is_staff_or_creator was checking user_id (custom text) against auth.uid() (UUID)
-- Must check auth_id column which stores the actual Supabase auth UUID

CREATE OR REPLACE FUNCTION public.is_staff_or_creator(uid text)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE auth_id = uid
      AND role IN ('staff','admin','state_admin','assistant_state_admin','director','creator','creator_admin')
  );
$$;
