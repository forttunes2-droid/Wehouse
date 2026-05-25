// ─── ROLE SYSTEM ───────────────────────────────────
// USER    = student, tenant, regular user (all same account type)
// CREATOR = platform creator / owner
// ADMIN   = full admin access
// STAFF   = limited admin access
// WORKER  = FUTURE — service provider (electrician, plumber, etc.)
//           Architecture prepared. No UI built yet.

export type UserRole = 'user' | 'creator' | 'admin' | 'staff' | 'worker';

// Future worker occupations — used when worker system is built
export const WORKER_OCCUPATIONS = [
  'electrician', 'plumber', 'cleaner', 'carpenter',
  'generator_repair', 'ac_technician', 'internet_installer',
  'moving_service', 'security', 'water_supply',
] as const;

export interface Profile {
  id: string;
  auth_id: string;
  email: string;
  username: string | null;
  role: UserRole;
  user_id: string;
  profile_complete: boolean;
  avatar_url: string | null;
  bio: string | null;
  phone: string | null;
  occupation: string | null;
  is_student: boolean;
  school: string | null;
  gender: string | null;
  budget_min: number;
  budget_max: number;
  preferred_location: string | null;
  email_verified: boolean;
  phone_verified: boolean;
  id_verified: boolean;
  is_online: boolean;
  last_seen: string | null;
  // Privacy settings
  privacy_profile_visible: boolean;
  privacy_search_visible: boolean;
  privacy_activity_visible: boolean;
  // ── WORKER ARCHITECTURE (future) ─────────────────
  worker_occupation: string | null;   // e.g. "electrician"
  worker_verified: boolean;            // approved by platform
  worker_bio: string | null;           // service description
  // ─────────────────────────────────────────────────
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

export interface Conversation {
  id: string;
  participant_a: string;
  participant_b: string;
  last_message: string | null;
  last_message_at: string;
  unread_a: number;
  unread_b: number;
  created_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  seen: boolean;
  created_at: string;
}

export interface Review {
  id: string;
  reviewer_id: string;
  reviewee_id: string;
  reviewee_type: string;
  rating: number;
  comment: string | null;
  created_at: string;
}

export interface RoomInterest {
  id: string;
  sender_id: string;
  receiver_id: string;
  status: 'pending' | 'accepted' | 'declined';
  message: string | null;
  created_at: string;
}
