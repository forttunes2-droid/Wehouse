-- Phase 8: canonical higher-institution catalog for student profiles.
-- Scope is intentionally limited to Universities, Polytechnics and Colleges.

CREATE TABLE IF NOT EXISTS public.registered_institutions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_name text NOT NULL,
  institution_type text NOT NULL CHECK (institution_type IN ('university','polytechnic','college')),
  state text NOT NULL,
  local_government text,
  regulator text NOT NULL CHECK (regulator IN ('NUC','NBTE','NCCE')),
  aliases text[] NOT NULL DEFAULT '{}',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS registered_institutions_name_state_unique
  ON public.registered_institutions (lower(canonical_name), lower(state));
CREATE INDEX IF NOT EXISTS registered_institutions_state_type_idx
  ON public.registered_institutions (state, institution_type)
  WHERE is_active=true;

ALTER TABLE public.registered_institutions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS registered_institutions_read_active ON public.registered_institutions;
CREATE POLICY registered_institutions_read_active
ON public.registered_institutions
FOR SELECT
TO authenticated
USING (is_active=true);

REVOKE INSERT, UPDATE, DELETE ON public.registered_institutions FROM anon, authenticated;
GRANT SELECT ON public.registered_institutions TO authenticated;

INSERT INTO public.registered_institutions
  (canonical_name,institution_type,state,local_government,regulator,aliases)
VALUES
  ('Federal University, Lafia, Nasarawa State','university','Nasarawa','Lafia','NUC',ARRAY['Federal University Lafia','FULAFIA','FUL Lafia']),
  ('Nasarawa State University Keffi','university','Nasarawa','Keffi','NUC',ARRAY['Nasarawa State University, Keffi','NSUK']),
  ('Bingham University, New Karu','university','Nasarawa','Karu','NUC',ARRAY['Bingham University']),
  ('Ave Maria University, Piyanko, Nasarawa State','university','Nasarawa',NULL,'NUC',ARRAY['Ave Maria University']),
  ('Mewar International University, Masaka, Nasarawa State','university','Nasarawa','Karu','NUC',ARRAY['Mewar International University','MIU']),
  ('Phoenix University, Agwada, Nasarawa State','university','Nasarawa','Kokona','NUC',ARRAY['Phoenix University']),
  ('Federal Polytechnic, Nasarawa','polytechnic','Nasarawa','Nasarawa','NBTE',ARRAY['Federal Polytechnic Nasarawa','FEDPONAS']),
  ('Isa Mustapha Agwai I Polytechnic, Lafia','polytechnic','Nasarawa','Lafia','NBTE',ARRAY['IMAP','IMAP Polytechnic','Isa Mustapha Agwai Polytechnic','Nasarawa State Polytechnic']),
  ('College of Education Akwanga','college','Nasarawa','Akwanga','NCCE',ARRAY['College of Education, Akwanga','COE Akwanga']),
  ('Federal College Of Education (Technical), Keana','college','Nasarawa','Keana','NCCE',ARRAY['Federal College of Education Technical Keana','FCE Technical Keana']),
  ('Hill COE, Gwanje, Akwanga','college','Nasarawa','Akwanga','NCCE',ARRAY['Hill College of Education Gwanje Akwanga']),
  ('Innovative College of Education, Karu','college','Nasarawa','Karu','NCCE',ARRAY['Innovative COE Karu']),
  ('Metro COE, Adogi-Lafia','college','Nasarawa','Lafia','NCCE',ARRAY['Metro College of Education Adogi Lafia'])
ON CONFLICT DO NOTHING;

COMMENT ON TABLE public.registered_institutions IS
  'Canonical regulator-grounded Nigerian Universities, Polytechnics and Colleges used by student profile selection.';
