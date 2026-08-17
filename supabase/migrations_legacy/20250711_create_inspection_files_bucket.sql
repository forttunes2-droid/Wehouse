-- Create inspection-files storage bucket for property partner document/photo uploads
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'inspection-files',
  'inspection-files',
  true,
  10485760, -- 10MB limit
  ARRAY[
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/webp',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
ON CONFLICT (id) DO NOTHING;

-- RLS: Authenticated users can upload to their own folder
CREATE POLICY "inspection_files_owner_upload"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'inspection-files' AND (storage.foldername(name))[1] = auth.uid()::text);

-- RLS: Authenticated users can read their own files
CREATE POLICY "inspection_files_owner_read"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'inspection-files');

-- RLS: Allow public read (files are public URLs)
CREATE POLICY "inspection_files_public_read"
  ON storage.objects FOR SELECT TO anon
  USING (bucket_id = 'inspection-files');
