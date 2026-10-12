-- ═══════════════════════════════════════════════════════════
-- WeHouse Hotels — Database Setup
-- Run this in your Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════

-- ─── HOTELS ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hotels (
  hotel_id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  state TEXT NOT NULL,
  city TEXT NOT NULL,
  area TEXT,
  address TEXT,
  images TEXT[] DEFAULT '{}',
  amenities TEXT[] DEFAULT '{}',
  owner_id TEXT NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  rating DECIMAL(2,1) DEFAULT 0,
  review_count INT DEFAULT 0,
  featured BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ─── HOTEL ROOMS ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hotel_rooms (
  room_id SERIAL PRIMARY KEY,
  hotel_id INT NOT NULL REFERENCES hotels(hotel_id) ON DELETE CASCADE,
  room_type TEXT NOT NULL,
  description TEXT,
  price_per_night INT NOT NULL,
  max_guests INT DEFAULT 2,
  bed_type TEXT,
  images TEXT[] DEFAULT '{}',
  amenities TEXT[] DEFAULT '{}',
  total_rooms INT DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ─── HOTEL BOOKINGS ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS hotel_bookings (
  booking_id SERIAL PRIMARY KEY,
  hotel_id INT NOT NULL REFERENCES hotels(hotel_id) ON DELETE CASCADE,
  room_id INT NOT NULL REFERENCES hotel_rooms(room_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  check_in DATE NOT NULL,
  check_out DATE NOT NULL,
  guest_count INT DEFAULT 1,
  total_nights INT NOT NULL,
  total_price INT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'cancelled', 'completed')),
  guest_name TEXT,
  guest_phone TEXT,
  special_requests TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ─── HOTEL REVIEWS ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS hotel_reviews (
  review_id SERIAL PRIMARY KEY,
  hotel_id INT NOT NULL REFERENCES hotels(hotel_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  rating INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ─── INDEXES ─────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_hotels_state ON hotels(state);
CREATE INDEX IF NOT EXISTS idx_hotels_city ON hotels(city);
CREATE INDEX IF NOT EXISTS idx_hotels_status ON hotels(status);
CREATE INDEX IF NOT EXISTS idx_hotels_featured ON hotels(featured);
CREATE INDEX IF NOT EXISTS idx_hotel_rooms_hotel_id ON hotel_rooms(hotel_id);
CREATE INDEX IF NOT EXISTS idx_hotel_bookings_user_id ON hotel_bookings(user_id);
CREATE INDEX IF NOT EXISTS idx_hotel_bookings_hotel_id ON hotel_bookings(hotel_id);
CREATE INDEX IF NOT EXISTS idx_hotel_bookings_check_in ON hotel_bookings(check_in);
CREATE INDEX IF NOT EXISTS idx_hotel_reviews_hotel_id ON hotel_reviews(hotel_id);

-- ─── RLS POLICIES ────────────────────────────────────────
-- Open policies (matching existing pattern)
ALTER TABLE hotels ENABLE ROW LEVEL SECURITY;
ALTER TABLE hotel_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE hotel_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE hotel_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hotels_all" ON hotels FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "hotel_rooms_all" ON hotel_rooms FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "hotel_bookings_all" ON hotel_bookings FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "hotel_reviews_all" ON hotel_reviews FOR ALL USING (true) WITH CHECK (true);
