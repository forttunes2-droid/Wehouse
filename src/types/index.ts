// ─── ROLE SYSTEM ───────────────────────────────────
// USER    = student, tenant, regular user (all same account type)
// CREATOR = platform creator / owner
// ADMIN   = full admin access
// STAFF   = limited admin access
// WORKER  = service provider (electrician, plumber, etc.)

export type UserRole = 'user' | 'creator' | 'creator_admin' | 'state_admin' | 'admin' | 'assistant_admin' | 'staff' | 'worker';

export type WorkerStatus = 'pending' | 'verified' | 'suspended' | 'rejected';

export const WORKER_OCCUPATIONS = [
  'electrician', 'plumber', 'cleaner', 'carpenter',
  'generator_repair', 'ac_technician', 'internet_installer',
  'moving_service', 'security', 'water_supply', 'handyman',
] as const;

export const WORKER_OCCUPATION_LABELS: Record<string, string> = {
  electrician: 'Electrician',
  plumber: 'Plumber',
  cleaner: 'Cleaner',
  carpenter: 'Carpenter',
  generator_repair: 'Generator Repair',
  ac_technician: 'AC Technician',
  internet_installer: 'Internet Installer',
  moving_service: 'Moving Service',
  security: 'Security',
  water_supply: 'Water Supply',
  handyman: 'Handyman',
};

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
  preferred_location: string | null;
  // ── LOCATION ──────────────────────────────────────
  country: string | null;
  state: string | null;
  city: string | null;
  area: string | null;
  email_verified: boolean;
  phone_verified: boolean;
  id_verified: boolean;
  is_online: boolean;
  last_seen: string | null;
  // Privacy settings
  privacy_profile_visible: boolean;
  privacy_search_visible: boolean;
  privacy_activity_visible: boolean;
  // ── WORKER FIELDS ─────────────────────────────────
  worker_status: WorkerStatus | null;  // pending | verified | suspended | rejected
  worker_occupation: string | null;   // e.g. "electrician"
  worker_verified: boolean;            // approved by platform
  worker_bio: string | null;           // service description
  full_name: string | null;            // worker's real name
  // ─────────────────────────────────────────────────
  created_at: string;
  updated_at: string;
  // ── SOFT DELETE ───────────────────────────────────
  deleted: boolean;
  deleted_at: string | null;
  // ── ROLE + SCOPE ──────────────────────────────────
  assigned_state: string | null;  // Admin/Staff: assigned state
  assigned_lga: string | null;    // Admin/Staff: assigned LGA
  scope: 'global' | 'local' | null;  // global=creator, local=admin/staff
  created_by: string | null;      // Who created this account
  updated_by: string | null;      // Who last updated
}

export interface RoleChangeHistory {
  id: string;
  user_id: string;
  user_email: string;
  old_role: UserRole;
  new_role: UserRole;
  changed_by: string;
  changed_by_email: string;
  created_at: string;
}

export type Page = 'loading' | 'login' | 'setup' | 'worker_setup' | 'dashboard' | 'creator' | 'admin';

export type ListingStatus = 'available' | 'reserved' | 'viewed' | 'occupied' | 'closed';

export const LISTING_STATUS_LABELS: Record<ListingStatus, string> = {
  available: 'Available',
  reserved: 'Reserved',
  viewed: 'Viewed',
  occupied: 'Occupied',
  closed: 'Closed',
};

export const LISTING_STATUS_COLORS: Record<ListingStatus, string> = {
  available: 'bg-green-500/10 text-green-400 border-green-500/20',
  reserved: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  viewed: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  occupied: 'bg-red-500/10 text-red-400 border-red-500/20',
  closed: 'bg-gray-500/10 text-gray-400 border-gray-500/20',
};

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
  videos: string[];
  bedrooms: number;
  bathrooms: number;
  availability_status: 'available' | 'reserved' | 'occupied' | 'hidden';
  owner_id: string | null;
  created_at: string;
  updated_at: string;
  // ── RESERVATION FIELDS ────────────────────────────
  status: ListingStatus;
  reserved_by: string | null;
  reservation_expiry: string | null;
  reservation_fee_paid: boolean;
  chat_unlocked: boolean;
}

export interface Enquiry {
  id: string;
  listing_id: string;
  user_id: string;
  staff_id: string | null;
  message: string;
  reply: string | null;
  replied_at: string | null;
  status: 'pending' | 'replied' | 'closed';
  created_at: string;
}

export interface Reservation {
  id: string;
  listing_id: string;
  user_id: string;
  staff_id: string | null;
  status: 'pending' | 'confirmed' | 'expired' | 'cancelled';
  fee_paid: boolean;
  amount: number;
  currency: string;
  created_at: string;
  expires_at: string | null;
  paid_at: string | null;
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
  // ── STRUCTURED LOCATION ───────────────────────────
  preferred_state: string | null;
  preferred_lga: string | null;
  preferred_area: string | null;
  // ─────────────────────────────────────────────────
  bio: string;
  active: boolean;
  // ── SCHOOL FIELDS (Phase 5) ───────────────────────
  school_name: string | null;
  campus: string | null;
  faculty: string | null;
  department: string | null;
  level: string | null; // 100, 200, 300, 400, 500
  school_match: boolean;
  campus_match: boolean;
  // ─────────────────────────────────────────────────
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

// ─── ROLE HIERARCHY ────────────────────────────────
// Higher number = more power. Used for permission checks.
export const ROLE_RANK: Record<UserRole, number> = {
  user: 0,
  worker: 0,          // same level as user
  staff: 1,
  assistant_admin: 2, // helps local admin, same powers except announcements
  admin: 3,           // local admin — manages one LGA
  state_admin: 4,     // state admin — manages all in their state
  creator: 5,         // highest — manages entire platform
  creator_admin: 5,   // legacy alias for creator
};

export function roleRank(role: string): number {
  return ROLE_RANK[role as UserRole] ?? 0;
}

// ─── USER SESSION TRACKING ─────────────────────────
export interface UserSession {
  id: string;
  user_id: string;
  auth_id: string;
  device: string;       // e.g. "iPhone 14"
  browser: string;      // e.g. "Chrome 120"
  os: string;           // e.g. "iOS 17"
  ip_address: string | null;
  location: string | null;  // e.g. "Lagos, Nigeria"
  login_time: string;
  last_seen: string;
  logout_time: string | null;
  is_current: boolean;
  created_at: string;
}

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

// ─── OFFICIAL MESSAGES (Creator/Admin Broadcasts) ──

export interface OfficialMessage {
  id: number;
  sender_id: string;
  sender_role: 'creator' | 'state_admin' | 'admin';
  sender_name: string;
  content: string;
  sent_to_all: boolean;
  target_state?: string | null;
  target_lga?: string | null;
  created_at: string;
}

export interface OfficialMessageRecipient {
  id: number;
  message_id: number;
  recipient_id: string;
  read: boolean;
  created_at: string;
}
