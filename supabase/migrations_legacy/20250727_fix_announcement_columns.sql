-- ═══════════════════════════════════════════════════════════════
-- MIGRATION 3: FIX ANNOUNCEMENT TABLE COLUMNS (2025-07-27)
--
-- PROBLEM: Code expects columns 'content' and 'sender_id'.
-- DB actually has 'message' and 'created_by'.
-- Every announcement was saved with empty content.
--
-- FIX: Rename columns to match the code.
-- ═══════════════════════════════════════════════════════════════

DO $$
BEGIN
    -- Rename message → content (only if old exists and new doesn't)
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'announcements' AND column_name = 'message'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'announcements' AND column_name = 'content'
    ) THEN
        ALTER TABLE public.announcements RENAME COLUMN message TO content;
    END IF;
    
    -- Rename created_by → sender_id (only if old exists and new doesn't)
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'announcements' AND column_name = 'created_by'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'announcements' AND column_name = 'sender_id'
    ) THEN
        ALTER TABLE public.announcements RENAME COLUMN created_by TO sender_id;
    END IF;
END $$;

-- Verify: run this separately to confirm
-- SELECT column_name FROM information_schema.columns 
-- WHERE table_name = 'announcements' ORDER BY ordinal_position;
