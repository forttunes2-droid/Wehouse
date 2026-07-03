-- BLOCK 2: Add file columns to messages table
-- Allows file attachments in chat

ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS file_url TEXT;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS file_name TEXT;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS file_type TEXT;
