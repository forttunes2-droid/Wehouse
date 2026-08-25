export type NavPage =
  // ── Primary customer navigation ──
  | 'search'
  | 'saved'
  | 'messages'
  | 'profile'
  // ── Internal customer routes ──
  | 'roommate'
  | 'activity'
  | 'detail'
  | 'chat'
  | 'profile_edit'
  | 'account'
  | 'privacy'
  | 'security'
  | 'my_bookings'
  | 'my_reservations'
  | 'payment_return'
  // ── Canonical role workspaces ──
  | 'creator'
  | 'admin'
  | 'staff_dashboard'
  | 'worker_dashboard'
  | 'property_partner'
  // ── Role workflow subpages ──
  | 'new_listing'
  | 'worker_setup'
  | 'worker_discovery'
  | 'worker_categories'
  | 'worker_verification'
  // ── Hotel workflow ──
  | 'hotels'
  | 'hotel_detail'
  | 'hotel_booking'
  | 'hotel_reservation'
  // ── Public pages (no login required) ──
  | 'privacy_policy'
  | 'terms_of_service';
