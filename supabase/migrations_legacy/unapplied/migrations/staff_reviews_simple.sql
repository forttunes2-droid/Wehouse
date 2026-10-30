CREATE TABLE staff_reviews (
  review_id SERIAL PRIMARY KEY,
  reviewer_id TEXT NOT NULL,
  staff_id TEXT NOT NULL,
  booking_id INTEGER,
  rating INTEGER NOT NULL,
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_staff_reviews_staff ON staff_reviews(staff_id);

ALTER TABLE staff_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY staff_reviews_select ON staff_reviews FOR SELECT USING (true);

CREATE POLICY staff_reviews_insert_own ON staff_reviews FOR INSERT WITH CHECK (reviewer_id = (auth.uid())::text);

SELECT 'done' as status;
