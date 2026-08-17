BEGIN;

CREATE OR REPLACE FUNCTION public.is_current_creator()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=public
AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.profiles p
    WHERE p.auth_id=auth.uid()::text
      AND p.role='creator'
      AND COALESCE(p.deleted,false)=false
      AND COALESCE(p.suspended,false)=false
      AND COALESCE(p.banned,false)=false
  );
$$;
REVOKE ALL ON FUNCTION public.is_current_creator() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.is_current_creator() TO authenticated;

CREATE TABLE IF NOT EXISTS public.secrets(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  value text NOT NULL DEFAULT '',
  description text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);

INSERT INTO public.secrets(key,value,description,updated_at)
SELECT key,COALESCE(value,''),
       CASE key
         WHEN 'paystack_secret_key' THEN 'Paystack server-side secret key'
         WHEN 'flutterwave_secret_key' THEN 'Flutterwave server-side secret key'
         WHEN 'openai_api_key' THEN 'OpenAI server-side API key'
         ELSE 'Server-side secret'
       END,
       now()
FROM public.platform_settings
WHERE key IN ('paystack_secret_key','flutterwave_secret_key','openai_api_key')
ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=now();

DELETE FROM public.platform_settings
WHERE key IN ('paystack_secret_key','flutterwave_secret_key','openai_api_key');

ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT policyname FROM pg_policies
           WHERE schemaname='public' AND tablename='platform_settings'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.platform_settings',r.policyname);
  END LOOP;
END $$;
CREATE POLICY platform_settings_read_safe ON public.platform_settings
FOR SELECT TO anon,authenticated USING(is_active=true);
CREATE POLICY platform_settings_creator_insert ON public.platform_settings
FOR INSERT TO authenticated WITH CHECK(public.is_current_creator());
CREATE POLICY platform_settings_creator_update ON public.platform_settings
FOR UPDATE TO authenticated USING(public.is_current_creator()) WITH CHECK(public.is_current_creator());
CREATE POLICY platform_settings_creator_delete ON public.platform_settings
FOR DELETE TO authenticated USING(public.is_current_creator());

ALTER TABLE public.secrets ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT policyname FROM pg_policies
           WHERE schemaname='public' AND tablename='secrets'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.secrets',r.policyname);
  END LOOP;
END $$;
CREATE POLICY secrets_creator_only ON public.secrets
FOR ALL TO authenticated USING(public.is_current_creator()) WITH CHECK(public.is_current_creator());

CREATE OR REPLACE FUNCTION public.get_secret_v2(p_key text)
RETURNS TABLE(key text,value text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
BEGIN
  IF NOT public.is_current_creator() THEN RAISE EXCEPTION 'Creator account required'; END IF;
  RETURN QUERY SELECT s.key,s.value FROM public.secrets s WHERE s.key=p_key;
END;
$$;
CREATE OR REPLACE FUNCTION public.set_secret_v2(p_key text,p_value text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
BEGIN
  IF NOT public.is_current_creator() THEN RAISE EXCEPTION 'Creator account required'; END IF;
  IF NULLIF(BTRIM(COALESCE(p_key,'')),'') IS NULL THEN RAISE EXCEPTION 'Secret key is required'; END IF;
  INSERT INTO public.secrets(key,value,updated_at,updated_by)
  VALUES(BTRIM(p_key),COALESCE(p_value,''),now(),auth.uid()::text)
  ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=now(),updated_by=auth.uid()::text;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.get_secret_v2(text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.set_secret_v2(text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_secret_v2(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_secret_v2(text,text) TO authenticated;

ALTER TABLE public.service_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_subcategories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.property_types ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tablename,policyname FROM pg_policies
           WHERE schemaname='public'
             AND tablename IN ('service_categories','service_subcategories','property_types')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I',r.policyname,r.tablename);
  END LOOP;
END $$;
CREATE POLICY service_categories_read ON public.service_categories
FOR SELECT TO anon,authenticated USING(true);
CREATE POLICY service_categories_creator_write ON public.service_categories
FOR ALL TO authenticated USING(public.is_current_creator()) WITH CHECK(public.is_current_creator());
CREATE POLICY service_subcategories_read ON public.service_subcategories
FOR SELECT TO anon,authenticated USING(true);
CREATE POLICY service_subcategories_creator_write ON public.service_subcategories
FOR ALL TO authenticated USING(public.is_current_creator()) WITH CHECK(public.is_current_creator());
CREATE POLICY property_types_read ON public.property_types
FOR SELECT TO anon,authenticated USING(true);
CREATE POLICY property_types_creator_write ON public.property_types
FOR ALL TO authenticated USING(public.is_current_creator()) WITH CHECK(public.is_current_creator());

COMMIT;
