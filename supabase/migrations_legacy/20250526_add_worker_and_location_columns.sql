-- Migration: Add worker fields and location columns to profiles table
-- These columns are required for the worker system and location-aware features

-- Location columns (shared between users, listings, and workers)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS country TEXT DEFAULT NULL;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS state TEXT DEFAULT NULL;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS city TEXT DEFAULT NULL;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS area TEXT DEFAULT NULL;

-- Worker-specific columns
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS full_name TEXT DEFAULT NULL;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS worker_occupation TEXT DEFAULT NULL;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS worker_bio TEXT DEFAULT NULL;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS worker_status TEXT DEFAULT NULL;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS worker_verified BOOLEAN DEFAULT FALSE;

-- Ensure existing worker entries have proper defaults
UPDATE profiles SET worker_verified = FALSE WHERE worker_verified IS NULL;
