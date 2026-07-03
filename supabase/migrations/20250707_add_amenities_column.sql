-- Add missing amenities column to inspection_requests
ALTER TABLE inspection_requests ADD COLUMN IF NOT amenities TEXT[] DEFAULT '{}';
