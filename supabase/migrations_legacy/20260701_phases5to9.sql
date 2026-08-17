-- Phases 5 to 9 Final Fixes
-- Worker System, Reviews, Notifications, UI, Audit

-- Phase 5: Worker enhancements
ALTER TABLE workers 
ADD COLUMN IF NOT EXISTS trust_score INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS worker_level TEXT DEFAULT 'beginner',
ADD COLUMN IF NOT EXISTS response_time INTERVAL,
ADD COLUMN IF NOT EXISTS total_bookings INT DEFAULT 0;

-- Phase 6: Prevent duplicate reviews
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_review 
ON reviews (user_id, target_id, target_type);

-- Phase 7: Notification types (already handled in code)

-- Phase 8 & 9: Cleanup + Security
-- Removed broken premium pages and buttons (in frontend code)

COMMENT ON DATABASE postgres IS 'WeHouse Full Stable Version - July 2026';