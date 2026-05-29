// ─── ROLE SYSTEM ───────────────────────────────────
// USER    = student, tenant, regular user (all same account type)
// CREATOR = platform creator / owner
// ADMIN   = full admin access
// STAFF   = limited admin access
// WORKER  = service provider (electrician, plumber, etc.)

export type UserRole = 'user' | 'creator' | 'creator_admin' | 'director' | 'state_admin' | 'admin' | 'assistant_state_admin' | 'staff' | 'worker';

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
  // ── MAINTENANCE ───────────────────────────────────
  maintenance_exempt: boolean;     // Can login during maintenance mode (for testing)
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

export type Page = 'loading' | 'login' | 'setup' | 'worker_setup' | 'dashboard' | 'creator' | 'admin' | 'state_admin' | 'assistant_state_admin' | 'staff_dashboard';

export type ListingStatus = 'available' | 'reserved' | 'closed' | 'pending_approval' | 'rejected';

export const LISTING_STATUS_LABELS: Record<ListingStatus, string> = {
  available: 'Available',
  reserved: 'Reserved',
  closed: 'Closed',
  pending_approval: 'Pending Approval',
  rejected: 'Rejected',
};

export const LISTING_STATUS_COLORS: Record<ListingStatus, string> = {
  available: 'bg-green-500/10 text-green-400 border-green-500/20',
  reserved: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  closed: 'bg-gray-500/10 text-gray-400 border-gray-500/20',
  pending_approval: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  rejected: 'bg-red-500/10 text-red-400 border-red-500/20',
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
  property_type: 'studio_apartment' | 'self_contain' | null;  // null = standard bedroom-based
  bedrooms: number;
  bathrooms: number;
  availability_status: 'available' | 'reserved' | 'closed';
  owner_id: string | null;
  chat_agent_id: string | null;  // Staff/Admin who handles enquiries for this listing
  created_at: string;
  updated_at: string;
  // ── RESERVATION FIELDS ────────────────────────────
  status: ListingStatus;
  reserved_by: string | null;
  reservation_expiry: string | null;
  reservation_fee_paid: boolean;
  chat_unlocked: boolean;
  // ── APPROVAL FIELDS ───────────────────────────────
  submitted_by_role?: UserRole | null;
  approved_by?: string | null;
  approved_at?: string | null;
  rejection_reason?: string | null;
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
  // ── BACKGROUND SEARCH FIELDS ──────────────────────
  search_status: 'idle' | 'active' | 'expired' | 'stopped';
  search_started_at: string | null;
  search_expires_at: string | null;
  search_match_count: number;
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

// Saved match result from background search — persisted across sessions
export interface SavedRoommateMatch {
  id: string;
  searcher_id: string;      // the user who initiated the search
  matched_user_id: string;  // the matched roommate
  match_score: number;
  status: 'new' | 'viewed' | 'accepted' | 'declined';
  matched_profile?: {
    username: string | null;
    gender: string | null;
    city: string | null;
    state: string | null;
    bio: string | null;
    school: string | null;
  };
  created_at: string;
}

// ─── PHASE 4 ADMIN TYPES ───────────────────────────

// ─── ROLE HIERARCHY ────────────────────────────────
// Higher number = more power. Used for permission checks.
// Approval chain: Staff → Head of Staff → Assistant Admin → Admin → Director → Creator
export const ROLE_RANK: Record<UserRole, number> = {
  user: 0,
  worker: 0,          // same level as user
  staff: 1,           // posts need Head of Staff approval
  admin: 2,           // Head of Staff — approves staff posts, posts need Asst Admin approval
  assistant_state_admin: 3, // Assistant Admin — approves HOS posts, posts need Admin approval
  state_admin: 4,     // Admin — approves Asst Admin posts, posts need Director approval
  director: 4.5,      // Director — approves Admin posts, posts need Creator approval
  creator: 5,         // highest — approves Director posts, auto-approved for own posts
  creator_admin: 5,   // legacy alias for creator
};

// ─── ROLE DISPLAY LABELS ───────────────────────────
// User-friendly names shown in UI. Internal role keys stay the same.
export const ROLE_LABELS: Record<UserRole, string> = {
  user: 'User',
  worker: 'Worker',
  staff: 'Staff',
  admin: 'Head of Staff',
  assistant_state_admin: 'Assistant Admin',
  state_admin: 'Admin',
  director: 'Director',
  creator: 'Creator',
  creator_admin: 'Creator',
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
  listing_id: string | null;  // Which listing this conversation is about
  status: 'pending' | 'active' | 'closed';  // pending=initial enquiry, active=unlocked, closed=resolved
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

// --- NEW ANNOUNCEMENT SYSTEM v2 ---

export type AnnouncementTargetType = 'all_users' | 'all_workers' | 'verified_workers' | 'admins' | 'specific_user' | 'staff_only' | 'head_of_staff_only' | 'admin_only' | 'assistant_admin_only';

export interface Announcement {
  id: number;
  title: string;
  message: string;
  created_by: string;
  sender_name: string;
  sender_role: string;
  target_type: AnnouncementTargetType;
  target_state?: string | null;
  target_lga?: string | null;
  recipient_count: number;
  read_count: number;
  created_at: string;
}

export interface AnnouncementRecipient {
  id: number;
  announcement_id: number;
  user_id: string;
  read_status: boolean;
  delivered_at: string;
}

// Legacy aliases for backward compatibility
export type OfficialMessage = Announcement;
export type OfficialMessageRecipient = AnnouncementRecipient;

// ─── HOTEL TYPES ───────────────────────────────────

export type HotelStatus = 'active' | 'inactive';

export interface Hotel {
  hotel_id: number;
  name: string;
  description: string | null;
  state: string;
  city: string;
  area: string | null;
  address: string | null;
  images: string[];
  amenities: string[];
  owner_id: string;
  status: HotelStatus;
  rating: number;
  review_count: number;
  featured: boolean;
  created_at: string;
  updated_at: string;
}

export interface HotelRoom {
  room_id: number;
  hotel_id: number;
  room_type: string;
  description: string | null;
  price_per_night: number;
  max_guests: number;
  bed_type: string | null;
  images: string[];
  amenities: string[];
  total_rooms: number;
  created_at: string;
  updated_at: string;
}

export type HotelBookingStatus = 'pending' | 'confirmed' | 'cancelled' | 'completed';

export interface HotelBooking {
  booking_id: number;
  hotel_id: number;
  room_id: number;
  user_id: string;
  check_in: string;
  check_out: string;
  guest_count: number;
  total_nights: number;
  total_price: number;
  status: HotelBookingStatus;
  guest_name: string | null;
  guest_phone: string | null;
  special_requests: string | null;
  created_at: string;
  updated_at: string;
}

export interface HotelReview {
  review_id: number;
  hotel_id: number;
  user_id: string;
  rating: number;
  comment: string | null;
  created_at: string;
}

// Hotel amenity options
export const HOTEL_AMENITIES = [
  'WiFi', 'AC', 'Swimming Pool', 'Gym', 'Restaurant', 'Bar', 'Parking',
  '24/7 Power', 'Security', 'Laundry', 'Room Service', 'Conference Room',
  'Elevator', 'SPA', 'Airport Shuttle', 'Kitchenette',
] as const;

export const ROOM_TYPES = [
  'Standard', 'Deluxe', 'Suite', 'Executive', 'Presidential', 'Single', 'Twin',
] as const;

export const BED_TYPES = [
  'King', 'Queen', 'Twin', 'Single', 'Double', 'Bunk',
] as const;
