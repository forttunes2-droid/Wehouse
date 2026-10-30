-- Staff Reviews Table: Users rate staff members after bookings
-- Ratings are averaged and displayed on staff profiles

CREATE TABLE IF NOT EXISTS staff_reviews (
  review_id SERIAL PRIMARY KEY,
  reviewer_id TEXT NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  staff_id TEXT NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  booking_id INTEGER REFERENCES hotel_bookings(booking_id) ON DELETE SET NULL,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_staff_reviews_staff ON staff_reviews(staff_id);
CREATE INDEX IF NOT EXISTS idx_staff_reviews_reviewer ON staff_reviews(reviewer_id);
CREATE INDEX IF NOT EXISTS idx_staff_reviews_booking ON staff_reviews(booking_id);

-- Row Level Security
ALTER TABLE staff_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff_reviews_select" ON staff_reviews
  FOR SELECT USING (true);

CREATE POLICY "staff_reviews_insert_own" ON staff_reviews
  FOR INSERT WITH CHECK (reviewer_id = (auth.uid())::text);

CREATE POLICY "staff_reviews_delete_own" ON staff_reviews
  FOR DELETE USING (reviewer_id = (auth.uid())::text);

-- Function to get average rating for a staff member
CREATE OR REPLACE FUNCTION get_staff_rating(staff_user_id TEXT)
RETURNS TABLE(avg_rating NUMERIC, review_count BIGINT) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ROUND(AVG(rating)::numeric, 1) as avg_rating,
    COUNT(*) as review_count
  FROM staff_reviews
  WHERE staff_id = staff_user_id;
END;
$$ LANGUAGE plpgsql;

SELECT 'Staff reviews table created!' as status;
