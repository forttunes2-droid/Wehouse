export interface Profile {
  id: string;
  auth_id: string;
  email: string;
  username: string | null;
  role: 'user' | 'creator_admin';
  user_id: string;
  profile_complete: boolean;
  created_at: string;
  updated_at: string;
}

export type Page = 'loading' | 'login' | 'setup' | 'dashboard' | 'creator';

export interface Listing {
  id: string;
  listing_id: string;
  title: string;
  description: string | null;
  price: number;
  currency: string;
  state: string | null;
  city: string | null;
  address: string | null;
  images: string[];
  bedrooms: number;
  bathrooms: number;
  availability_status: 'available' | 'reserved' | 'occupied' | 'hidden';
  owner_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface SavedListing {
  id: string;
  user_id: string;
  listing_id: string;
  created_at: string;
}

export interface RoommatePreferences {
  id: string;
  user_id: string;
  auth_id: string;
  gender: 'male' | 'female';
  gender_preference: 'male' | 'female' | 'no_preference';
  budget_min: number;
  budget_max: number;
  study_level: string;
  noise_level: 'quiet' | 'moderate' | 'loud';
  cleanliness: 'neat' | 'moderate' | 'relaxed';
  sleep_time: string;
  visitors: 'rarely' | 'sometimes' | 'often';
  stay_duration: string;
  area_preference: string;
  bio: string;
  active: boolean;
  created_at: string;
}

export interface RoommateMatch {
  id: string;
  user_a_id: string;
  user_b_id: string;
  match_score: number;
  match_level: 'low' | 'medium' | 'high';
  status: 'pending' | 'accepted' | 'declined';
  created_at: string;
}

// ─── PHASE 4 ADMIN TYPES ───────────────────────────

export interface UserActivity {
  id: string;
  user_id: string;
  auth_id: string | null;
  action_type: string;
  details: Record<string, any>;
  created_at: string;
}

export interface ListingReport {
  id: string;
  reporter_id: string;
  listing_id: string;
  reason: string;
  status: 'pending' | 'resolved' | 'dismissed';
  resolved_by: string | null;
  created_at: string;
  resolved_at: string | null;
}

export interface AdminAuditLog {
  id: string;
  admin_id: string;
  admin_email: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  details: string | null;
  created_at: string;
}

export interface Notification {
  id: string;
  recipient_id: string;
  type: string;
  title: string;
  message: string | null;
  read: boolean;
  related_id: string | null;
  created_at: string;
}

export interface SystemSetting {
  id: string;
  key: string;
  value: string | null;
  updated_by: string | null;
  updated_at: string;
}
