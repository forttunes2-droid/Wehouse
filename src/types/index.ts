// ─── ROLE SYSTEM ───────────────────────────────────
// USER    = student, tenant, regular user (all same account type)
// CREATOR = platform creator / owner
// ADMIN   = full admin access
// STAFF   = limited admin access
// WORKER  = service provider (electrician, plumber, etc.)

export type UserRole = 'user' | 'creator' | 'creator_admin' | 'admin' | 'staff' | 'worker' | 'property_partner';

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
  // ── PREMIUM REMOVED ──────────────────────────────
  // No user-facing premium. Revenue from reservations, hotels, workers only.
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

export type Page = 'loading' | 'login' | 'setup' | 'worker_setup' | 'dashboard' | 'creator' | 'admin' | 'staff_dashboard' | 'property_partner';

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
  property_type: PropertyType | null;  // 'apartment' (short_let/long_stay) or 'hotel'
  sub_type: ApartmentSubType | null;    // 'short_let' or 'long_stay' (for apartments only)
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
// Simple chain: Staff → Admin → Creator
export const ROLE_RANK: Record<UserRole, number> = {
  user: 0,
  worker: 0,
  property_partner: 0,
  staff: 1,
  admin: 3,
  creator: 5,
  creator_admin: 5,
};

// ─── ROLE DISPLAY LABELS ───────────────────────────
export const ROLE_LABELS: Record<UserRole, string> = {
  user: 'User',
  worker: 'Worker',
  staff: 'Staff',
  admin: 'Admin',
  creator: 'Creator',
  creator_admin: 'Creator',
  property_partner: 'Property Partner',
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

export type AnnouncementTargetType = 'all_users' | 'all_workers' | 'verified_workers' | 'admins' | 'specific_user' | 'staff_only' | 'admin_only' | 'partners_only';

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

// ═══════════════════════════════════════════════════════════════
// CTO MASTER SCHEMA — NEW TYPES
// ═══════════════════════════════════════════════════════════════

// ─── STAFF PERMISSIONS ──────────────────────────────────────
// Permission groups that creator assigns to staff members.
// These determine which modules appear on the unified Staff Dashboard.

export type StaffPermission = 'operations' | 'finance' | 'support' | 'verification' | 'field_officer' | 'admin';

export const STAFF_PERMISSION_LABELS: Record<StaffPermission, string> = {
  operations: 'Operations',
  finance: 'Finance',
  support: 'Customer Support',
  verification: 'Worker Verification',
  field_officer: 'Field Officer',
  admin: 'Admin',
};

export const STAFF_PERMISSION_ICONS: Record<StaffPermission, string> = {
  operations: 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM9 22V12h6v10',
  finance: 'M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
  support: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  verification: 'M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 0 0 1.24-.12 3.42 3.42 0 0 0 2.604-2.604 3.42 3.42 0 0 0 .12-1.24A3.42 3.42 0 0 1 14.4 2.01 3.42 3.42 0 0 1 17 3.388a3.42 3.42 0 0 0 1.24.12 3.42 3.42 0 0 0 2.604-2.604 3.42 3.42 0 0 0 .12-1.24 3.42 3.42 0 0 1 3.388-3.388 3.42 3.42 0 0 1 2.568 1.932 3.42 3.42 0 0 0 2.604 2.604 3.42 3.42 0 0 0 1.24.12M9 12a3 3 0 1 1 6 0 3 3 0 0 1-6 0',
  field_officer: 'M17.657 16.657L13.414 20.9a1.998 1.998 0 0 1-2.827 0l-4.244-4.243a8 8 0 1 1 11.314 0zM15 11a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  admin: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
};

export interface StaffPermissionRecord {
  id: string;
  staff_id: string;
  permission: StaffPermission;
  granted_by: string;
  granted_at: string;
  revoked_at: string | null;
  is_active: boolean;
}

// ═══════════════════════════════════════════════════════════════
// UNIFIED PROPERTY PARTNER SYSTEM
// Replaces: PropertyOwner, Hotel types. One system for all accommodation.
// ═══════════════════════════════════════════════════════════════

// Property types: Apartment (Short Let or Long Stay) or Hotel
// Short Let = daily/weekly rental | Long Stay = monthly/yearly rental
export type PropertyType = 'apartment' | 'hotel';
export type ApartmentSubType = 'short_let' | 'long_stay';

export const PROPERTY_TYPE_LABELS: Record<PropertyType, string> = {
  apartment: 'Apartment',
  hotel: 'Hotel',
};

export const PROPERTY_TYPE_ICONS: Record<PropertyType, string> = {
  apartment: '🏢',
  hotel: '🏨',
};

export const APARTMENT_SUB_LABELS: Record<ApartmentSubType, string> = {
  short_let: 'Short Let',
  long_stay: 'Long Stay',
};

// ═══════════════════════════════════════════════════════════════
// WEHOUSE FEE STRUCTURE — Fair & Transparent
// ═══════════════════════════════════════════════════════════════

export const WEHOUSE_FEES = {
  // Worker bookings: user pays a small booking fee, worker pays commission
  WORKER_BOOKING_FEE_USER: 300,          // N300 per booking (user pays)
  WORKER_COMMISSION_PERCENT: 12.5,        // 12.5% of job value (worker pays)

  // Property rentals: WeHouse takes commission from rent
  RENTAL_COMMISSION_PERCENT: 10,          // 10% of annual rent (from landlord)
  RESERVATION_FEE: 5000,                  // N5,000 to reserve a property for 72hrs

  // Hotel bookings
  HOTEL_BOOKING_COMMISSION_PERCENT: 15,   // 15% of booking value

  // Late payment / penalty fees
  LATE_PAYMENT_FEE_PERCENT: 5,            // 5% late fee on overdue installments
} as const;

// ═══════════════════════════════════════════════════════════════
// RENTAL PLANS — Multi-year payment options
// ═══════════════════════════════════════════════════════════════

export type RentalDuration = 1 | 2 | 3;

export interface RentalPlan {
  durationYears: RentalDuration;
  label: string;
  description: string;
  paymentStructure: string;
}

export const RENTAL_PLANS: RentalPlan[] = [
  {
    durationYears: 1,
    label: '1 Year',
    description: 'Pay full year upfront',
    paymentStructure: 'full_upfront',
  },
  {
    durationYears: 2,
    label: '2 Years',
    description: 'Year 1 upfront, Year 2 split monthly',
    paymentStructure: 'first_upfront_rest_monthly',
  },
  {
    durationYears: 3,
    label: '3 Years',
    description: 'Year 1 upfront, Years 2-3 split monthly',
    paymentStructure: 'first_upfront_rest_monthly',
  },
];

// Calculate payment breakdown for a rental plan
export function calculateRentalPayments(annualRent: number, durationYears: RentalDuration) {
  const wehouseCommission = Math.round(annualRent * (WEHOUSE_FEES.RENTAL_COMMISSION_PERCENT / 100));
  const netAnnualRent = annualRent - wehouseCommission;

  if (durationYears === 1) {
    return {
      totalRent: annualRent,
      wehouseCommission: wehouseCommission,
      landlordReceives: netAnnualRent,
      year1Upfront: annualRent,
      monthlyInstallments: [] as { month: number; amount: number }[],
      reservationFee: WEHOUSE_FEES.RESERVATION_FEE,
    };
  }

  // For 2+ years: Year 1 upfront, rest split monthly
  const year1Upfront = annualRent;
  const remainingYears = durationYears - 1;
  const remainingTotal = annualRent * remainingYears;
  const monthlyAmount = Math.round(remainingTotal / (remainingYears * 12));
  const installments: { month: number; amount: number }[] = [];
  for (let m = 1; m <= remainingYears * 12; m++) {
    installments.push({ month: m, amount: monthlyAmount });
  }

  return {
    totalRent: annualRent * durationYears,
    wehouseCommission: wehouseCommission * durationYears,
    landlordReceives: netAnnualRent * durationYears,
    year1Upfront,
    monthlyInstallments: installments,
    reservationFee: WEHOUSE_FEES.RESERVATION_FEE,
  };
}

// ═══════════════════════════════════════════════════════════════
// WORKER ESCROW SYSTEM
// ═══════════════════════════════════════════════════════════════

export type WorkerBookingStatus = 'pending_payment' | 'paid_escrow' | 'worker_assigned' | 'in_progress' | 'completed_pending_approval' | 'approved_released' | 'disputed' | 'cancelled' | 'refunded';

export interface WorkerBooking {
  id: string;
  booking_code: string;
  user_id: string;
  worker_id: string;
  service_type: string;
  description: string;
  address: string;
  scheduled_date: string | null;
  agreed_amount: number;              // What user pays
  wehouse_fee: number;                // N300 booking fee
  worker_commission: number;          // 12.5% of job value
  worker_receives: number;            // agreed_amount - worker_commission
  status: WorkerBookingStatus;
  paystack_reference: string | null;
  user_approved: boolean;
  worker_approved: boolean;
  user_rating: number | null;
  user_review: string | null;
  worker_rating: number | null;
  worker_review: string | null;
  dispute_reason: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export const WORKER_BOOKING_STATUS_LABELS: Record<WorkerBookingStatus, string> = {
  pending_payment: 'Pending Payment',
  paid_escrow: 'Paid — In Escrow',
  worker_assigned: 'Worker Assigned',
  in_progress: 'Work In Progress',
  completed_pending_approval: 'Done — Awaiting Your Approval',
  approved_released: 'Completed & Paid',
  disputed: 'Under Dispute',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
};

export const WORKER_BOOKING_STATUS_COLORS: Record<WorkerBookingStatus, string> = {
  pending_payment: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  paid_escrow: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  worker_assigned: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  in_progress: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
  completed_pending_approval: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  approved_released: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  disputed: 'bg-red-500/10 text-red-400 border-red-500/20',
  cancelled: 'bg-gray-500/10 text-gray-400 border-gray-500/20',
  refunded: 'bg-gray-500/10 text-gray-400 border-gray-500/20',
};

// ═══════════════════════════════════════════════════════════════

export type PropertyStatus = 'pending_inspection' | 'under_inspection' | 'pending_agreement' | 'pending_approval' | 'approved' | 'rejected' | 'active' | 'inactive' | 'suspended';

export interface PropertyPartner {
  id: string;
  profile_id: string;
  partner_code: string;
  status: 'active' | 'suspended' | 'pending_verification';
  commission_rate: number;
  bank_name: string | null;
  bank_account_number: string | null;
  bank_account_name: string | null;
  tax_id: string | null;
  verification_notes: string | null;
  verified_by: string | null;
  verified_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Property {
  id: string;
  property_code: string;
  partner_id: string;
  title: string;
  description: string | null;
  property_type: PropertyType;
  address: string;
  city: string;
  state: string;
  latitude: number | null;
  longitude: number | null;
  images: string[];
  videos: string[];
  documents: string[];
  status: PropertyStatus;
  amenities: string[];
  house_rules: string | null;
  cancellation_policy: string | null;
  check_in_time: string;
  check_out_time: string;
  rating: number;
  review_count: number;
  created_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PropertyUnit {
  id: string;
  unit_code: string;
  property_id: string;
  unit_name: string;
  unit_type: string | null;
  description: string | null;
  max_guests: number;
  bedrooms: number;
  bathrooms: number;
  base_price: number;
  cleaning_fee: number;
  service_fee: number;
  total_quantity: number;
  available_quantity: number;
  images: string[];
  amenities: string[];
  bed_types: string[];
  status: 'active' | 'maintenance' | 'inactive';
  maintenance_note: string | null;
  created_at: string;
  updated_at: string;
}

export interface UnifiedBooking {
  id: string;
  booking_code: string;
  customer_id: string;
  property_id: string;
  unit_id: string;
  check_in: string;
  check_out: string;
  nights: number;
  guest_name: string | null;
  guest_email: string | null;
  guest_phone: string | null;
  guest_count: number;
  special_requests: string | null;
  unit_price: number;
  subtotal: number;
  cleaning_fee: number;
  service_fee: number;
  total_amount: number;
  payment_status: string;
  payment_method: string | null;
  payment_reference: string | null;
  paid_at: string | null;
  commission_rate: number;
  commission_amount: number;
  partner_payout: number;
  status: string;
  cancelled_at: string | null;
  cancelled_by: string | null;
  cancellation_reason: string | null;
  refund_amount: number;
  created_at: string;
  updated_at: string;
}

// ─── LEGACY: PROPERTY OWNER (keeping for backward compat) ───

export interface PropertyOwner {
  id: string;
  owner_code: string;
  full_name: string;
  email: string | null;
  phone: string;
  address: string | null;
  state: string | null;
  city: string | null;
  bank_name: string | null;
  bank_account_number: string | null;
  bank_account_name: string | null;
  tax_id: string | null;
  commission_rate: number;
  status: 'active' | 'inactive' | 'suspended';
  notes: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface OwnerProperty {
  id: string;
  owner_id: string;
  listing_id: string;
  contract_start_date: string | null;
  contract_end_date: string | null;
  monthly_rent: number | null;
  payout_day: number;
  is_primary_owner: boolean;
  ownership_percentage: number;
  created_at: string;
}

export type ContractType = 'rental' | 'management' | 'partnership';
export type ContractStatus = 'draft' | 'active' | 'expired' | 'terminated';

export interface OwnerContract {
  id: string;
  owner_id: string;
  contract_code: string;
  contract_type: ContractType;
  start_date: string;
  end_date: string | null;
  commission_rate: number;
  terms: string | null;
  document_url: string | null;
  status: ContractStatus;
  terminated_by: string | null;
  terminated_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

// ─── SUPPORT TICKETS ────────────────────────────────────────

export type TicketType = 'booking_issue' | 'refund_request' | 'complaint' | 'account_help' | 'payment_issue' | 'general';
export type TicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed' | 'escalated';
export type TicketPriority = 'low' | 'medium' | 'high' | 'urgent';

export const TICKET_TYPE_LABELS: Record<TicketType, string> = {
  booking_issue: 'Booking Issue',
  refund_request: 'Refund Request',
  complaint: 'Complaint',
  account_help: 'Account Help',
  payment_issue: 'Payment Issue',
  general: 'General',
};

export const TICKET_STATUS_COLORS: Record<TicketStatus, string> = {
  open: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  in_progress: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  resolved: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  closed: 'bg-gray-500/10 text-gray-400 border-gray-500/20',
  escalated: 'bg-red-500/10 text-red-400 border-red-500/20',
};

export const TICKET_PRIORITY_COLORS: Record<TicketPriority, string> = {
  low: 'text-gray-400',
  medium: 'text-blue-400',
  high: 'text-amber-400',
  urgent: 'text-red-400',
};

export interface SupportTicket {
  id: string;
  ticket_code: string;
  customer_id: string;
  customer_email: string;
  customer_phone: string | null;
  type: TicketType;
  subject: string;
  description: string;
  status: TicketStatus;
  priority: TicketPriority;
  assigned_to: string | null;
  resolution_notes: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  listing_id: string | null;
  reservation_id: string | null;
  created_at: string;
  updated_at: string;
}

// ─── INSPECTIONS ────────────────────────────────────────────

export type InspectionStatus = 'scheduled' | 'in_progress' | 'completed' | 'cancelled' | 're_inspection_required';
export type ConditionRating = 'excellent' | 'good' | 'fair' | 'poor';
export type SecurityLevel = 'high' | 'medium' | 'low';

export interface Inspection {
  id: string;
  inspection_code: string;
  listing_id: string;
  field_officer_id: string;
  status: InspectionStatus;
  scheduled_date: string | null;
  completed_at: string | null;
  overall_condition: ConditionRating | null;
  property_cleanliness: ConditionRating | null;
  security_level: SecurityLevel | null;
  amenities_verified: boolean;
  photos_match_listing: boolean;
  price_verified: boolean;
  landlord_present: boolean;
  notes: string | null;
  report: string | null;
  photo_urls: string[];
  document_urls: string[];
  gps_latitude: number | null;
  gps_longitude: number | null;
  created_at: string;
  updated_at: string;
}

// ─── COMMISSION RULES ───────────────────────────────────────

export type CommissionRuleType = 'reservation_fee' | 'listing_commission' | 'hotel_booking_fee' | 'worker_subscription' | 'owner_commission' | 'late_fee' | 'cancellation_fee';

export interface CommissionRule {
  id: string;
  name: string;
  rule_type: CommissionRuleType;
  percentage: number | null;
  flat_amount: number | null;
  min_amount: number | null;
  max_amount: number | null;
  currency: string;
  is_active: boolean;
  applies_to: 'all' | 'new' | 'existing' | null;
  description: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// ─── PAYOUTS ────────────────────────────────────────────────

export type PayoutStatus = 'pending' | 'processing' | 'paid' | 'failed' | 'cancelled';

export interface Payout {
  id: string;
  payout_code: string;
  owner_id: string;
  owner_property_id: string | null;
  amount: number;
  commission_amount: number;
  gross_amount: number;
  period_start: string;
  period_end: string;
  status: PayoutStatus;
  payment_method: string | null;
  paid_at: string | null;
  paid_by: string | null;
  transaction_reference: string | null;
  notes: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

// ─── BOOKING PAYMENTS ───────────────────────────────────────

export type BookingPaymentType = 'reservation' | 'hotel_booking' | 'worker_subscription';
export type BookingPaymentStatus = 'pending' | 'completed' | 'failed' | 'refunded' | 'partially_refunded';

export interface BookingPayment {
  id: string;
  payment_reference: string;
  user_id: string;
  type: BookingPaymentType;
  listing_id: string | null;
  hotel_booking_id: number | null;
  amount: number;
  commission_amount: number;
  net_amount: number;
  currency: string;
  status: BookingPaymentStatus;
  payment_method: string | null;
  paystack_reference: string | null;
  refund_amount: number;
  refund_reason: string | null;
  refund_processed_at: string | null;
  refund_processed_by: string | null;
  metadata: Record<string, any>;
  created_at: string;
  updated_at: string;
}

// ─── STAFF ACTIVITY LOG ─────────────────────────────────────

export type StaffActivityModule = 'operations' | 'finance' | 'support' | 'verification' | 'field_officer' | 'admin' | 'general';

export interface StaffActivityLog {
  id: string;
  staff_id: string;
  action: string;
  module: StaffActivityModule;
  target_type: string | null;
  target_id: string | null;
  details: Record<string, any>;
  ip_address: string | null;
  created_at: string;
}
