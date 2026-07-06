import { useState, useEffect } from 'react';
import { supabase, getServiceCategories, getServiceSubcategories, createServiceCategory, updateServiceCategory, deleteServiceCategory, createServiceSubcategory, updateServiceSubcategory, deleteServiceSubcategory } from '@/lib/supabase';
import type { Profile, ServiceCategory, ServiceSubcategory } from '@/types';
import { Toaster, toast } from 'sonner';

interface CreatorSettingsTabProps {
  profile: Profile;
}

interface Setting {
  id: string;
  key: string;
  value: string;
  label: string;
  description: string;
  category: string;
  data_type: string;
}

const SETTING_CATEGORIES = [
  { id: 'company', label: 'Company', icon: '🏢' },
  { id: 'finance', label: 'Financial', icon: '💰' },
  { id: 'payment', label: 'Payment', icon: '💳' },
  { id: 'property', label: 'Property', icon: '🏠' },
  { id: 'worker', label: 'Workers', icon: '🔧' },
  { id: 'booking', label: 'Booking', icon: '📅' },
  { id: 'support', label: 'Support', icon: '🎧' },
  { id: 'notification', label: 'Notifications', icon: '🔔' },
  { id: 'legal', label: 'Legal', icon: '⚖️' },
  { id: 'features', label: 'Toggles', icon: '🎚️' },
  { id: 'appearance', label: 'Appearance', icon: '🎨' },
  { id: 'security', label: 'Security', icon: '🔒' },
];

// ═══════════════════════════════════════════════════════════════
// FALLBACK DEFAULTS — All 127 settings so Creator can see them
// even before the database SQL is run.
// ═══════════════════════════════════════════════════════════════

const DEFAULT_SETTINGS: Setting[] = [
  // COMPANY (13)
  { id: '1', key: 'company_name', value: 'WeHouse Nigeria', category: 'company', label: 'Company Name', description: 'Legal company name', data_type: 'string' },
  { id: '2', key: 'company_short_name', value: 'WeHouse', category: 'company', label: 'Short Name', description: 'Display name', data_type: 'string' },
  { id: '3', key: 'company_slogan', value: 'Find Your Perfect Home', category: 'company', label: 'Slogan', description: 'Brand slogan', data_type: 'string' },
  { id: '4', key: 'company_website', value: 'https://wehouse.ng', category: 'company', label: 'Website URL', description: 'Official website', data_type: 'string' },
  { id: '5', key: 'company_email', value: 'support@wehouse.ng', category: 'company', label: 'Support Email', description: 'Primary support email', data_type: 'string' },
  { id: '6', key: 'company_phone', value: '', category: 'company', label: 'Support Phone', description: 'Primary support phone', data_type: 'string' },
  { id: '7', key: 'company_address', value: '', category: 'company', label: 'Office Address', description: 'Physical office address', data_type: 'string' },
  { id: '8', key: 'company_cac_number', value: '', category: 'company', label: 'CAC Registration', description: 'Corporate Affairs Commission number', data_type: 'string' },
  { id: '9', key: 'company_logo_url', value: '', category: 'company', label: 'Logo URL', description: 'Company logo image URL', data_type: 'string' },
  { id: '10', key: 'company_favicon_url', value: '', category: 'company', label: 'Favicon URL', description: 'Browser favicon URL', data_type: 'string' },
  { id: '11', key: 'company_whatsapp', value: '', category: 'company', label: 'WhatsApp Number', description: 'WhatsApp business number', data_type: 'string' },
  { id: '12', key: 'company_telegram', value: '', category: 'company', label: 'Telegram Username', description: 'Telegram support handle', data_type: 'string' },
  { id: '13', key: 'company_social_links', value: '{}', category: 'company', label: 'Social Media Links', description: 'JSON: {facebook, twitter, instagram, linkedin}', data_type: 'json' },

  // FINANCE (26)
  { id: '14', key: 'commission_rate_worker', value: '10', category: 'finance', label: 'Worker Commission (%)', description: 'Percentage taken from worker bookings', data_type: 'number' },
  { id: '15', key: 'commission_rate_partner', value: '8', category: 'finance', label: 'Partner Commission (%)', description: 'Percentage taken from property partner earnings', data_type: 'number' },
  { id: '16', key: 'commission_rate_hotel', value: '12', category: 'finance', label: 'Hotel Commission (%)', description: 'Percentage taken from hotel bookings', data_type: 'number' },
  { id: '17', key: 'commission_rate_listing', value: '5', category: 'finance', label: 'Listing Commission (%)', description: 'Percentage taken from property listings', data_type: 'number' },
  { id: '20', key: 'escrow_hold_days', value: '3', category: 'finance', label: 'Escrow Hold (Days)', description: 'Days to hold payment in escrow before release', data_type: 'number' },
  { id: '21', key: 'minimum_withdrawal', value: '1000', category: 'finance', label: 'Minimum Withdrawal (N)', description: 'Minimum amount for withdrawal requests', data_type: 'number' },
  { id: '22', key: 'withdrawal_fee', value: '50', category: 'finance', label: 'Withdrawal Fee (N)', description: 'Flat fee per withdrawal', data_type: 'number' },
  { id: '23', key: 'withdrawal_processing_days', value: '1-3', category: 'finance', label: 'Withdrawal Processing', description: 'Business days to process withdrawals', data_type: 'string' },
  { id: '24', key: 'refund_policy_days', value: '7', category: 'finance', label: 'Refund Window (Days)', description: 'Days within which refunds are allowed', data_type: 'number' },
  { id: '25', key: 'inspection_fee', value: '3000', category: 'finance', label: 'Inspection Fee (N)', description: 'Fee charged for property inspection requests', data_type: 'number' },
  { id: '26', key: 'late_cancellation_fee', value: '1000', category: 'finance', label: 'Late Cancellation Fee (N)', description: 'Fee for late booking cancellations', data_type: 'number' },
  { id: '27', key: 'withdrawal_daily_limit', value: '50000', category: 'finance', label: 'Daily Withdrawal Limit (N)', description: 'Maximum withdrawal amount per day', data_type: 'number' },
  { id: '28', key: 'withdrawal_weekly_limit', value: '200000', category: 'finance', label: 'Weekly Withdrawal Limit (N)', description: 'Maximum withdrawal amount per week', data_type: 'number' },
  { id: '29', key: 'withdrawal_monthly_limit', value: '500000', category: 'finance', label: 'Monthly Withdrawal Limit (N)', description: 'Maximum withdrawal amount per month', data_type: 'number' },
  { id: '30', key: 'escrow_auto_release', value: 'true', category: 'finance', label: 'Auto Release Escrow', description: 'Automatically release escrow after hold period', data_type: 'boolean' },
  { id: '31', key: 'escrow_dispute_window_days', value: '7', category: 'finance', label: 'Escrow Dispute Window (Days)', description: 'Days after completion to open a dispute', data_type: 'number' },
  { id: '32', key: 'security_deposit_refund_days', value: '14', category: 'finance', label: 'Security Deposit Refund (Days)', description: 'Days to refund security deposit after move-out', data_type: 'number' },
  { id: '33', key: 'reservation_fee', value: '5000', category: 'finance', label: 'Reservation Fee (N)', description: 'Fee to reserve a property for 72 hours', data_type: 'number' },
  { id: '34', key: 'late_payment_fee_percent', value: '5', category: 'finance', label: 'Late Payment Fee (%)', description: 'Fee on overdue installment payments', data_type: 'number' },
  { id: '35', key: 'currency_symbol', value: 'N', category: 'finance', label: 'Currency Symbol', description: 'Displayed currency symbol', data_type: 'string' },
  { id: '36', key: 'currency_code', value: 'NGN', category: 'finance', label: 'Currency Code', description: 'ISO currency code', data_type: 'string' },

  // PAYMENT (8)
  { id: '42', key: 'paystack_enabled', value: 'true', category: 'payment', label: 'Paystack Enabled', description: 'Enable Paystack payments', data_type: 'boolean' },
  { id: '43', key: 'paystack_public_key', value: '', category: 'payment', label: 'Paystack Public Key', description: 'Paystack public API key', data_type: 'string' },
  { id: '44', key: 'paystack_secret_key', value: '', category: 'payment', label: 'Paystack Secret Key', description: 'Paystack secret API key (encrypted)', data_type: 'string' },
  { id: '45', key: 'flutterwave_enabled', value: 'false', category: 'payment', label: 'Flutterwave Enabled', description: 'Enable Flutterwave payments', data_type: 'boolean' },
  { id: '46', key: 'flutterwave_public_key', value: '', category: 'payment', label: 'Flutterwave Public Key', description: 'Flutterwave public API key', data_type: 'string' },
  { id: '47', key: 'flutterwave_secret_key', value: '', category: 'payment', label: 'Flutterwave Secret Key', description: 'Flutterwave secret API key (encrypted)', data_type: 'string' },
  { id: '48', key: 'payment_test_mode', value: 'true', category: 'payment', label: 'Test Mode', description: 'Use test/sandbox mode for payments', data_type: 'boolean' },
  { id: '49', key: 'auto_payout_enabled', value: 'false', category: 'payment', label: 'Auto Payout', description: 'Automatically process payouts', data_type: 'boolean' },

  // PROPERTY (8)
  { id: '50', key: 'property_verification_required', value: 'true', category: 'property', label: 'Verification Required', description: 'Require verification before listing properties', data_type: 'boolean' },
  { id: '51', key: 'property_inspection_required', value: 'true', category: 'property', label: 'Inspection Required', description: 'Require inspection before approving listings', data_type: 'boolean' },
  { id: '52', key: 'max_listings_per_partner', value: '50', category: 'property', label: 'Max Listings Per Partner', description: 'Maximum properties a partner can list', data_type: 'number' },
  { id: '53', key: 'listing_approval_mode', value: 'manual', category: 'property', label: 'Listing Approval', description: 'manual or auto approval of listings', data_type: 'string' },
  { id: '54', key: 'property_photos_min', value: '3', category: 'property', label: 'Min Photos Required', description: 'Minimum photos per listing', data_type: 'number' },
  { id: '55', key: 'property_photos_max', value: '20', category: 'property', label: 'Max Photos Allowed', description: 'Maximum photos per listing', data_type: 'number' },
  { id: '56', key: 'featured_listing_price', value: '5000', category: 'property', label: 'Featured Listing Price (N)', description: 'Cost to feature a listing', data_type: 'number' },
  { id: '57', key: 'property_types_allowed', value: '["apartment","house","duplex","studio","self_contain","office","warehouse","land","hotel","hostel","lodge","resort"]', category: 'property', label: 'Allowed Property Types', description: 'JSON array of allowed property types', data_type: 'json' },

  // WORKER (9)
  { id: '58', key: 'worker_verification_required', value: 'true', category: 'worker', label: 'Verification Required', description: 'Workers must be verified before booking', data_type: 'boolean' },
  { id: '59', key: 'worker_id_verification_required', value: 'true', category: 'worker', label: 'ID Verification Required', description: 'Government ID required for workers', data_type: 'boolean' },
  { id: '60', key: 'worker_video_intro_required', value: 'true', category: 'worker', label: 'Video Intro Required', description: 'Require video introduction', data_type: 'boolean' },
  { id: '61', key: 'worker_approval_mode', value: 'manual', category: 'worker', label: 'Worker Approval', description: 'manual or auto approval of workers', data_type: 'string' },
  { id: '62', key: 'blue_badge_price', value: '5000', category: 'worker', label: 'Blue Badge Price (N)', description: 'Monthly cost for blue badge', data_type: 'number' },
  { id: '63', key: 'max_skills_per_worker', value: '5', category: 'worker', label: 'Max Skills', description: 'Maximum services a worker can offer', data_type: 'number' },
  { id: '64', key: 'worker_search_radius_default', value: '25', category: 'worker', label: 'Default Search Radius (km)', description: 'Default radius for worker search', data_type: 'number' },
  { id: '65', key: 'worker_categories', value: '["cleaning","plumbing","electrical","carpentry","painting","hvac","security","gardening","moving","appliance_repair"]', category: 'worker', label: 'Worker Categories', description: 'JSON array of service categories', data_type: 'json' },
  { id: '66', key: 'worker_status_flow', value: 'pending,approved_for_verification,verified', category: 'worker', label: 'Status Flow', description: 'Comma-separated worker status progression', data_type: 'string' },

  // BOOKING (8)
  { id: '67', key: 'booking_advance_hours', value: '24', category: 'booking', label: 'Min Advance Booking (hrs)', description: 'Minimum hours before booking start', data_type: 'number' },
  { id: '68', key: 'booking_max_duration_days', value: '365', category: 'booking', label: 'Max Booking Duration (days)', description: 'Maximum length of a booking', data_type: 'number' },
  { id: '69', key: 'booking_cancellation_hours', value: '48', category: 'booking', label: 'Cancellation Window (hrs)', description: 'Hours before booking when cancellation is free', data_type: 'number' },
  { id: '70', key: 'booking_reschedule_allowed', value: 'true', category: 'booking', label: 'Allow Reschedule', description: 'Users can reschedule bookings', data_type: 'boolean' },
  { id: '71', key: 'booking_max_reschedules', value: '2', category: 'booking', label: 'Max Reschedules', description: 'Maximum times a booking can be rescheduled', data_type: 'number' },
  { id: '72', key: 'negotiation_enabled', value: 'true', category: 'booking', label: 'Price Negotiation', description: 'Allow price negotiation on bookings', data_type: 'boolean' },
  { id: '73', key: 'instant_booking_enabled', value: 'true', category: 'booking', label: 'Instant Booking', description: 'Allow instant booking without approval', data_type: 'boolean' },
  { id: '74', key: 'booking_reminder_hours', value: '24', category: 'booking', label: 'Reminder (hrs before)', description: 'Send reminder before booking', data_type: 'number' },

  // SUPPORT (7)
  { id: '75', key: 'support_chat_enabled', value: 'true', category: 'support', label: 'Live Chat', description: 'Enable live chat support', data_type: 'boolean' },
  { id: '76', key: 'support_email_enabled', value: 'true', category: 'support', label: 'Email Support', description: 'Enable email support tickets', data_type: 'boolean' },
  { id: '77', key: 'support_phone_enabled', value: 'false', category: 'support', label: 'Phone Support', description: 'Enable phone support', data_type: 'boolean' },
  { id: '78', key: 'support_hours', value: 'Mon-Fri 9AM-6PM WAT', category: 'support', label: 'Support Hours', description: 'Customer support operating hours', data_type: 'string' },
  { id: '79', key: 'support_response_time_hours', value: '24', category: 'support', label: 'Response Time (hrs)', description: 'Maximum response time', data_type: 'number' },
  { id: '80', key: 'ticket_auto_close_days', value: '7', category: 'support', label: 'Auto Close Tickets (days)', description: 'Days before auto-closing resolved tickets', data_type: 'number' },
  { id: '81', key: 'escalation_enabled', value: 'true', category: 'support', label: 'Auto Escalation', description: 'Automatically escalate unresolved tickets', data_type: 'boolean' },

  // NOTIFICATION (9)
  { id: '82', key: 'email_notifications_enabled', value: 'true', category: 'notification', label: 'Email Notifications', description: 'Send email notifications', data_type: 'boolean' },
  { id: '83', key: 'push_notifications_enabled', value: 'true', category: 'notification', label: 'Push Notifications', description: 'Send push notifications', data_type: 'boolean' },
  { id: '84', key: 'sms_notifications_enabled', value: 'false', category: 'notification', label: 'SMS Notifications', description: 'Send SMS notifications', data_type: 'boolean' },
  { id: '85', key: 'notification_booking_confirm', value: 'true', category: 'notification', label: 'Booking Confirmations', description: 'Notify on booking confirmation', data_type: 'boolean' },
  { id: '86', key: 'notification_payment', value: 'true', category: 'notification', label: 'Payment Updates', description: 'Notify on payment events', data_type: 'boolean' },
  { id: '87', key: 'notification_messages', value: 'true', category: 'notification', label: 'New Messages', description: 'Notify on new messages', data_type: 'boolean' },
  { id: '88', key: 'notification_reviews', value: 'true', category: 'notification', label: 'Reviews', description: 'Notify on new reviews', data_type: 'boolean' },
  { id: '89', key: 'notification_promotions', value: 'false', category: 'notification', label: 'Promotions', description: 'Send promotional notifications', data_type: 'boolean' },
  { id: '90', key: 'digest_email_frequency', value: 'never', category: 'notification', label: 'Digest Email', description: 'never, daily, or weekly digest', data_type: 'string' },

  // LEGAL (9)
  { id: '91', key: 'terms_version', value: '1.0', category: 'legal', label: 'Terms Version', description: 'Current terms of service version', data_type: 'string' },
  { id: '92', key: 'privacy_version', value: '1.0', category: 'legal', label: 'Privacy Version', description: 'Current privacy policy version', data_type: 'string' },
  { id: '93', key: 'terms_last_updated', value: '', category: 'legal', label: 'Terms Last Updated', description: 'Date terms were last updated', data_type: 'string' },
  { id: '94', key: 'privacy_last_updated', value: '', category: 'legal', label: 'Privacy Last Updated', description: 'Date privacy policy was updated', data_type: 'string' },
  { id: '95', key: 'cookie_consent_required', value: 'true', category: 'legal', label: 'Cookie Consent', description: 'Require cookie consent banner', data_type: 'boolean' },
  { id: '96', key: 'gdpr_compliance_enabled', value: 'false', category: 'legal', label: 'GDPR Compliance', description: 'Enable GDPR compliance features', data_type: 'boolean' },
  { id: '97', key: 'minimum_age', value: '18', category: 'legal', label: 'Minimum Age', description: 'Minimum user age requirement', data_type: 'number' },
  { id: '98', key: 'dispute_resolution', value: 'arbitration', category: 'legal', label: 'Dispute Resolution', description: 'arbitration, mediation, or court', data_type: 'string' },
  { id: '99', key: 'refund_policy_text', value: '', category: 'legal', label: 'Refund Policy', description: 'Full refund policy text displayed to users', data_type: 'textarea' },

  // FEATURES (12)
  { id: '100', key: 'feature_hotels_enabled', value: 'true', category: 'features', label: 'Hotels Module', description: 'Enable hotel bookings', data_type: 'boolean' },
  { id: '101', key: 'feature_workers_enabled', value: 'true', category: 'features', label: 'Workers Module', description: 'Enable worker services', data_type: 'boolean' },
  { id: '102', key: 'feature_roommate_enabled', value: 'true', category: 'features', label: 'Roommate Module', description: 'Enable roommate matching', data_type: 'boolean' },
  { id: '103', key: 'feature_property_partners_enabled', value: 'true', category: 'features', label: 'Property Partners', description: 'Enable property partner program', data_type: 'boolean' },
  { id: '104', key: 'feature_blue_badge_enabled', value: 'true', category: 'features', label: 'Blue Badge', description: 'Enable blue badge subscription', data_type: 'boolean' },
  { id: '105', key: 'feature_negotiation_enabled', value: 'true', category: 'features', label: 'Price Negotiation', description: 'Enable price negotiation', data_type: 'boolean' },
  { id: '106', key: 'feature_inspections_enabled', value: 'true', category: 'features', label: 'Inspections', description: 'Enable property inspections', data_type: 'boolean' },
  { id: '107', key: 'feature_analytics_enabled', value: 'true', category: 'features', label: 'Analytics', description: 'Enable analytics dashboard', data_type: 'boolean' },
  { id: '108', key: 'feature_referral_enabled', value: 'false', category: 'features', label: 'Referral Program', description: 'Enable referral system', data_type: 'boolean' },
  { id: '109', key: 'feature_loyalty_enabled', value: 'false', category: 'features', label: 'Loyalty Program', description: 'Enable loyalty points', data_type: 'boolean' },
  { id: '110', key: 'maintenance_mode', value: 'false', category: 'features', label: 'Maintenance Mode', description: 'Put site in maintenance mode', data_type: 'boolean' },
  { id: '111', key: 'registration_open', value: 'true', category: 'features', label: 'Open Registration', description: 'Allow new user registration', data_type: 'boolean' },

  // APPEARANCE (5)
  { id: '112', key: 'theme_primary_color', value: '#3B82F6', category: 'appearance', label: 'Primary Color', description: 'Main brand color', data_type: 'string' },
  { id: '113', key: 'theme_secondary_color', value: '#8B5CF6', category: 'appearance', label: 'Secondary Color', description: 'Accent color', data_type: 'string' },
  { id: '114', key: 'theme_dark_mode_default', value: 'true', category: 'appearance', label: 'Dark Mode Default', description: 'Default to dark mode', data_type: 'boolean' },
  { id: '115', key: 'app_name', value: 'WeHouse', category: 'appearance', label: 'App Name', description: 'Displayed app name', data_type: 'string' },
  { id: '116', key: 'meta_description', value: 'Find your perfect home in Nigeria. Rent apartments, book hotels, hire verified workers.', category: 'appearance', label: 'Meta Description', description: 'SEO meta description', data_type: 'string' },

  // SECURITY (7)
  { id: '117', key: 'max_login_attempts', value: '5', category: 'security', label: 'Max Login Attempts', description: 'Failed attempts before lockout', data_type: 'number' },
  { id: '118', key: 'login_lockout_minutes', value: '30', category: 'security', label: 'Lockout Duration (min)', description: 'Minutes to lock account', data_type: 'number' },
  { id: '119', key: 'session_timeout_hours', value: '24', category: 'security', label: 'Session Timeout (hrs)', description: 'Hours before session expires', data_type: 'number' },
  { id: '120', key: 'password_min_length', value: '8', category: 'security', label: 'Min Password Length', description: 'Minimum password characters', data_type: 'number' },
  { id: '121', key: 'mfa_required_for_staff', value: 'false', category: 'security', label: 'MFA for Staff', description: 'Require MFA for staff accounts', data_type: 'boolean' },
  { id: '122', key: 'audit_log_retention_days', value: '90', category: 'security', label: 'Audit Log Retention', description: 'Days to keep audit logs', data_type: 'number' },
  { id: '123', key: 'data_backup_frequency', value: 'daily', category: 'security', label: 'Backup Frequency', description: 'How often to backup data', data_type: 'string' },
];

type SettingsView = 'settings' | 'categories' | 'property_types';

export default function CreatorSettingsTab({ profile }: CreatorSettingsTabProps) {
  const [view, setView] = useState<SettingsView>('settings');

  return (
    <div className="space-y-4">
      <Toaster position="top-center" richColors theme="dark" />

      {/* View Switcher */}
      <div className="flex gap-2">
        <button
          onClick={() => setView('settings')}
          className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
            view === 'settings'
              ? 'bg-[#3B82F6]/15 text-[#3B82F6] border border-[#3B82F6]/20'
              : 'bg-[#12121A] text-[#5C5E72] border border-[#1E1E2C] hover:text-white'
          }`}
        >
          Platform Settings
        </button>
        <button
          onClick={() => setView('categories')}
          className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
            view === 'categories'
              ? 'bg-[#3B82F6]/15 text-[#3B82F6] border border-[#3B82F6]/20'
              : 'bg-[#12121A] text-[#5C5E72] border border-[#1E1E2C] hover:text-white'
          }`}
        >
          Service Categories
        </button>
        <button
          onClick={() => setView('property_types')}
          className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
            view === 'property_types'
              ? 'bg-[#3B82F6]/15 text-[#3B82F6] border border-[#3B82F6]/20'
              : 'bg-[#12121A] text-[#5C5E72] border border-[#1E1E2C] hover:text-white'
          }`}
        >
          Property Types
        </button>
      </div>

      {view === 'settings' ? <PlatformSettings profile={profile} /> : view === 'categories' ? <CategoryManager profile={profile} /> : <PropertyTypeManager profile={profile} />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// PLATFORM SETTINGS
// ═══════════════════════════════════════════════════════════════

function PlatformSettings({ profile: _profile }: { profile: Profile }) {
  const [settings, setSettings] = useState<Setting[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState('company');
  const [search, setSearch] = useState('');

  useEffect(() => {
    loadSettings();
  }, []);

  async function loadSettings() {
    setLoading(true);
    const { data, error } = await supabase.rpc('get_platform_settings');
    if (error) {
      // Silently fall back to defaults — no toast, user doesn't need to know
      console.warn('[Settings] RPC error (using defaults):', error.message);
      setSettings(DEFAULT_SETTINGS);
      setLoading(false);
      return;
    }
    // Use DB data if available, otherwise fall back to defaults
    if (data && data.length > 0) {
      setSettings(data);
    } else {
      setSettings(DEFAULT_SETTINGS);
    }
    setLoading(false);
  }

  async function updateSetting(key: string, value: string) {
    setSaving(key);
    const { error } = await supabase.rpc('update_platform_setting', {
      p_key: key,
      p_value: value,
    });
    setSaving(null);
    if (error) {
      toast.error('Failed to save: ' + error.message);
      return;
    }
    setSettings(prev => prev.map(s => s.key === key ? { ...s, value } : s));
    toast.success('Saved');
  }

  const filteredSettings = search
    ? settings.filter(s =>
        s.label.toLowerCase().includes(search.toLowerCase()) ||
        s.key.toLowerCase().includes(search.toLowerCase()) ||
        s.description.toLowerCase().includes(search.toLowerCase())
      )
    : settings.filter(s => s.category === activeCategory);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-3 border-[#3B82F6] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h2 className="text-lg font-bold text-white">Platform Settings</h2>
        <p className="text-[11px] text-[#5C5E72]">Configure every aspect of WeHouse. No hardcoded values.</p>
      </div>

      {/* Search */}
      <div className="relative">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#5C5E72]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search settings..."
          className="w-full h-10 rounded-xl bg-[#12121A] border border-[#1E1E2C] text-white text-sm pl-10 pr-4 placeholder-[#3A3A4A] focus:border-[#3B82F6]/50 outline-none"
        />
        {search && (
          <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#5C5E72] text-xs">Clear</button>
        )}
      </div>

      {/* Category Tabs */}
      {!search && (
        <div className="flex gap-1.5 overflow-x-auto scrollbar-hide pb-1">
          {SETTING_CATEGORIES.map(cat => (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              className={`px-3 py-1.5 rounded-lg text-[10px] font-medium whitespace-nowrap transition-colors flex-shrink-0 ${
                activeCategory === cat.id
                  ? 'bg-[#3B82F6]/15 text-[#3B82F6]'
                  : 'bg-[#12121A] text-[#5C5E72] hover:text-white'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>
      )}

      {/* Settings List */}
      <div className="space-y-3">
        {filteredSettings.map(setting => (
          <SettingRow
            key={setting.key}
            setting={setting}
            saving={saving === setting.key}
            onUpdate={(value) => updateSetting(setting.key, value)}
          />
        ))}

        {filteredSettings.length === 0 && (
          <div className="text-center py-10">
            <p className="text-sm text-[#5C5E72]">{search ? 'No settings match your search' : 'No settings in this category'}</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Individual Setting Row ──────────────────────────

function SettingRow({ setting, saving, onUpdate }: { setting: Setting; saving: boolean; onUpdate: (v: string) => void }) {
  const [localValue, setLocalValue] = useState(setting.value || '');

  useEffect(() => {
    setLocalValue(setting.value || '');
  }, [setting.value]);

  function handleSave() {
    onUpdate(localValue);
  }

  function handleToggle() {
    const newVal = localValue === 'true' ? 'false' : 'true';
    setLocalValue(newVal);
    onUpdate(newVal);
  }

  return (
    <div className="glass rounded-xl p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-xs font-medium text-white">{setting.label}</p>
            {saving && <div className="w-3 h-3 border border-[#3B82F6] border-t-transparent rounded-full animate-spin" />}
          </div>
          <p className="text-[10px] text-[#5C5E72] mt-0.5">{setting.description}</p>
          <p className="text-[9px] text-[#3A3A4A] mt-0.5 font-mono">{setting.key}</p>
        </div>

        <div className="flex-shrink-0">
          {setting.data_type === 'boolean' ? (
            <ToggleSwitch enabled={localValue === 'true'} onToggle={handleToggle} />
          ) : setting.data_type === 'textarea' ? (
            <div className="w-48">
              <textarea
                value={localValue}
                onChange={(e) => setLocalValue(e.target.value)}
                onBlur={handleSave}
                rows={3}
                className="w-full rounded-lg bg-[#12121A] border border-[#1E1E2C] text-white text-[11px] px-3 py-2 placeholder-[#3A3A4A] focus:border-[#3B82F6]/50 outline-none resize-none"
              />
            </div>
          ) : setting.data_type === 'color' ? (
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={localValue || '#3B82F6'}
                onChange={(e) => { setLocalValue(e.target.value); onUpdate(e.target.value); }}
                className="w-8 h-8 rounded-lg border-0 cursor-pointer"
              />
              <span className="text-[10px] text-[#5C5E72] font-mono">{localValue}</span>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <input
                type={setting.data_type === 'number' || setting.data_type === 'percentage' ? 'number' : setting.data_type === 'email' ? 'email' : setting.data_type === 'url' ? 'url' : 'text'}
                value={localValue}
                onChange={(e) => setLocalValue(e.target.value)}
                onBlur={handleSave}
                placeholder={setting.data_type === 'percentage' ? '%' : '...'}
                className="w-32 h-8 rounded-lg bg-[#12121A] border border-[#1E1E2C] text-white text-[11px] px-3 focus:border-[#3B82F6]/50 outline-none"
              />
              {setting.data_type === 'percentage' && <span className="text-[10px] text-[#5C5E72]">%</span>}
              {setting.key.includes('_fee') && !setting.key.includes('_type') && <span className="text-[10px] text-[#5C5E72]">N</span>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// CATEGORY MANAGER
// ═══════════════════════════════════════════════════════════════

function CategoryManager({ profile: _profile }: { profile: Profile }) {
  const [categories, setCategories] = useState<ServiceCategory[]>([]);
  const [subcategories, setSubcategories] = useState<ServiceSubcategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [showHidden, setShowHidden] = useState(true);
  const [editingCat, setEditingCat] = useState<ServiceCategory | null>(null);
  const [editingSub, setEditingSub] = useState<ServiceSubcategory | null>(null);
  const [showCatForm, setShowCatForm] = useState(false);
  const [showSubForm, setShowSubForm] = useState(false);
  const [catForm, setCatForm] = useState({ name: '', icon: '', sort_order: 0 });
  const [subForm, setSubForm] = useState({ name: '', category_id: '', sort_order: 0 });
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    const [{ categories: cats }, { subcategories: subs }] = await Promise.all([
      getServiceCategories(true),
      getServiceSubcategories(undefined, true),
    ]);
    setCategories(cats || []);
    setSubcategories(subs || []);
    setLoading(false);
  }

  async function handleToggleActive(cat: ServiceCategory) {
    const { error } = await updateServiceCategory(cat.id, { is_active: !cat.is_active });
    if (error) {
      toast.error('Failed: ' + error.message);
      return;
    }
    setCategories(prev => prev.map(c => c.id === cat.id ? { ...c, is_active: !c.is_active } : c));
    toast.success(cat.is_active ? 'Category hidden' : 'Category activated');
  }

  async function handleToggleSubActive(sub: ServiceSubcategory) {
    const { error } = await updateServiceSubcategory(sub.id, { is_active: !sub.is_active });
    if (error) {
      toast.error('Failed: ' + error.message);
      return;
    }
    setSubcategories(prev => prev.map(s => s.id === sub.id ? { ...s, is_active: !s.is_active } : s));
    toast.success(sub.is_active ? 'Subcategory hidden' : 'Subcategory activated');
  }

  async function handleCreateCategory(e: React.FormEvent) {
    e.preventDefault();
    if (!catForm.name.trim()) { toast.error('Name is required'); return; }
    const { category, error } = await createServiceCategory(catForm.name.trim(), catForm.icon, catForm.sort_order);
    if (error) { toast.error('Failed: ' + error.message); return; }
    setCategories(prev => [...prev, category!]);
    setShowCatForm(false);
    setCatForm({ name: '', icon: '', sort_order: 0 });
    toast.success('Category created');
  }

  async function handleUpdateCategory(e: React.FormEvent) {
    e.preventDefault();
    if (!editingCat) return;
    const { error } = await updateServiceCategory(editingCat.id, {
      name: catForm.name.trim(),
      icon: catForm.icon,
      sort_order: catForm.sort_order,
    });
    if (error) { toast.error('Failed: ' + error.message); return; }
    setCategories(prev => prev.map(c => c.id === editingCat.id ? { ...c, name: catForm.name.trim(), icon: catForm.icon, sort_order: catForm.sort_order } : c));
    setEditingCat(null);
    setCatForm({ name: '', icon: '', sort_order: 0 });
    toast.success('Category updated');
  }

  async function handleDeleteCategory(id: string) {
    setDeleting(id);
    const { error } = await deleteServiceCategory(id);
    setDeleting(null);
    if (error) { toast.error('Failed: ' + error.message); return; }
    setCategories(prev => prev.filter(c => c.id !== id));
    setSubcategories(prev => prev.filter(s => s.category_id !== id));
    toast.success('Category deleted');
  }

  async function handleCreateSubcategory(e: React.FormEvent) {
    e.preventDefault();
    if (!subForm.name.trim() || !subForm.category_id) { toast.error('Name and category are required'); return; }
    const { subcategory, error } = await createServiceSubcategory(subForm.category_id, subForm.name.trim(), '', subForm.sort_order);
    if (error) { toast.error('Failed: ' + error.message); return; }
    setSubcategories(prev => [...prev, subcategory!]);
    setShowSubForm(false);
    setSubForm({ name: '', category_id: '', sort_order: 0 });
    toast.success('Subcategory created');
  }

  async function handleUpdateSubcategory(e: React.FormEvent) {
    e.preventDefault();
    if (!editingSub) return;
    const { error } = await updateServiceSubcategory(editingSub.id, {
      name: subForm.name.trim(),
      category_id: subForm.category_id,
      sort_order: subForm.sort_order,
    });
    if (error) { toast.error('Failed: ' + error.message); return; }
    setSubcategories(prev => prev.map(s => s.id === editingSub.id ? { ...s, name: subForm.name.trim(), category_id: subForm.category_id, sort_order: subForm.sort_order } : s));
    setEditingSub(null);
    setSubForm({ name: '', category_id: '', sort_order: 0 });
    toast.success('Subcategory updated');
  }

  async function handleDeleteSubcategory(id: string) {
    setDeleting(id);
    const { error } = await deleteServiceSubcategory(id);
    setDeleting(null);
    if (error) { toast.error('Failed: ' + error.message); return; }
    setSubcategories(prev => prev.filter(s => s.id !== id));
    toast.success('Subcategory deleted');
  }

  function startEditCat(cat: ServiceCategory) {
    setEditingCat(cat);
    setCatForm({ name: cat.name, icon: cat.icon || '', sort_order: cat.sort_order || 0 });
    setShowCatForm(true);
  }

  function startEditSub(sub: ServiceSubcategory) {
    setEditingSub(sub);
    setSubForm({ name: sub.name, category_id: sub.category_id, sort_order: sub.sort_order || 0 });
    setShowSubForm(true);
  }

  function openNewCat() {
    setEditingCat(null);
    setCatForm({ name: '', icon: '', sort_order: categories.length });
    setShowCatForm(true);
  }

  const visibleCategories = showHidden ? categories : categories.filter(c => c.is_active);
  const activeCount = categories.filter(c => c.is_active).length;
  const hiddenCount = categories.filter(c => !c.is_active).length;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-3 border-[#3B82F6] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-white">Service Categories</h2>
          <p className="text-[11px] text-[#5C5E72]">{activeCount} active · {hiddenCount} hidden · {subcategories.length} subcategories</p>
        </div>
        <div className="flex items-center gap-2">
          <ToggleSwitch enabled={showHidden} onToggle={() => setShowHidden(!showHidden)} />
          <span className="text-[10px] text-[#5C5E72]">Show hidden</span>
        </div>
      </div>

      {/* Add Category Button */}
      <div className="flex gap-2">
        <button onClick={openNewCat} className="px-3 py-2 rounded-xl bg-[#3B82F6]/15 text-[#3B82F6] text-xs font-semibold border border-[#3B82F6]/20 hover:bg-[#3B82F6]/25 transition-colors">
          + New Category
        </button>
      </div>

      {/* Category Form */}
      {showCatForm && (
        <form onSubmit={editingCat ? handleUpdateCategory : handleCreateCategory} className="glass rounded-xl p-4 space-y-3">
          <p className="text-xs font-semibold text-white">{editingCat ? 'Edit Category' : 'New Category'}</p>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-[10px] text-[#5C5E72] block mb-1">Name *</label>
              <input
                type="text"
                value={catForm.name}
                onChange={e => setCatForm(f => ({ ...f, name: e.target.value }))}
                className="w-full h-8 rounded-lg bg-[#12121A] border border-[#1E1E2C] text-white text-[11px] px-3 focus:border-[#3B82F6]/50 outline-none"
                placeholder="e.g. Plumbing"
              />
            </div>
            <div>
              <label className="text-[10px] text-[#5C5E72] block mb-1">Icon (emoji)</label>
              <input
                type="text"
                value={catForm.icon}
                onChange={e => setCatForm(f => ({ ...f, icon: e.target.value }))}
                className="w-full h-8 rounded-lg bg-[#12121A] border border-[#1E1E2C] text-white text-[11px] px-3 focus:border-[#3B82F6]/50 outline-none"
                placeholder="e.g. 🔧"
              />
            </div>
            <div>
              <label className="text-[10px] text-[#5C5E72] block mb-1">Sort Order</label>
              <input
                type="number"
                value={catForm.sort_order}
                onChange={e => setCatForm(f => ({ ...f, sort_order: parseInt(e.target.value) || 0 }))}
                className="w-full h-8 rounded-lg bg-[#12121A] border border-[#1E1E2C] text-white text-[11px] px-3 focus:border-[#3B82F6]/50 outline-none"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button type="submit" className="px-4 py-1.5 rounded-lg bg-[#3B82F6] text-white text-xs font-semibold hover:bg-[#2563EB] transition-colors">
              {editingCat ? 'Update' : 'Create'}
            </button>
            <button type="button" onClick={() => { setShowCatForm(false); setEditingCat(null); }} className="px-4 py-1.5 rounded-lg bg-[#12121A] text-[#5C5E72] text-xs hover:text-white transition-colors">
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Subcategory Form */}
      {showSubForm && (
        <form onSubmit={editingSub ? handleUpdateSubcategory : handleCreateSubcategory} className="glass rounded-xl p-4 space-y-3">
          <p className="text-xs font-semibold text-white">{editingSub ? 'Edit Subcategory' : 'New Subcategory'}</p>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-[10px] text-[#5C5E72] block mb-1">Name *</label>
              <input
                type="text"
                value={subForm.name}
                onChange={e => setSubForm(f => ({ ...f, name: e.target.value }))}
                className="w-full h-8 rounded-lg bg-[#12121A] border border-[#1E1E2C] text-white text-[11px] px-3 focus:border-[#3B82F6]/50 outline-none"
                placeholder="e.g. Pipe Repair"
              />
            </div>
            <div>
              <label className="text-[10px] text-[#5C5E72] block mb-1">Parent Category *</label>
              <select
                value={subForm.category_id}
                onChange={e => setSubForm(f => ({ ...f, category_id: e.target.value }))}
                className="w-full h-8 rounded-lg bg-[#12121A] border border-[#1E1E2C] text-white text-[11px] px-3 focus:border-[#3B82F6]/50 outline-none"
              >
                <option value="">Select...</option>
                {categories.map(c => (
                  <option key={c.id} value={c.id}>{c.name} {c.is_active ? '' : '(hidden)'}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-[#5C5E72] block mb-1">Sort Order</label>
              <input
                type="number"
                value={subForm.sort_order}
                onChange={e => setSubForm(f => ({ ...f, sort_order: parseInt(e.target.value) || 0 }))}
                className="w-full h-8 rounded-lg bg-[#12121A] border border-[#1E1E2C] text-white text-[11px] px-3 focus:border-[#3B82F6]/50 outline-none"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button type="submit" className="px-4 py-1.5 rounded-lg bg-[#3B82F6] text-white text-xs font-semibold hover:bg-[#2563EB] transition-colors">
              {editingSub ? 'Update' : 'Create'}
            </button>
            <button type="button" onClick={() => { setShowSubForm(false); setEditingSub(null); }} className="px-4 py-1.5 rounded-lg bg-[#12121A] text-[#5C5E72] text-xs hover:text-white transition-colors">
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Categories List */}
      <div className="space-y-3">
        {visibleCategories.map(cat => {
          const catSubs = subcategories.filter(s => s.category_id === cat.id);
          return (
            <div key={cat.id} className={`glass rounded-xl overflow-hidden ${!cat.is_active ? 'opacity-50' : ''}`}>
              {/* Category Header */}
              <div className="p-3.5 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <span className="text-xl">{cat.icon || '📦'}</span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-semibold text-white">{cat.name}</p>
                      {!cat.is_active && (
                        <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-400 font-medium">HIDDEN</span>
                      )}
                    </div>
                    <p className="text-[10px] text-[#5C5E72]">{catSubs.length} subcategories · Order: {cat.sort_order ?? 0}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button
                    onClick={() => handleToggleActive(cat)}
                    title={cat.is_active ? 'Hide category' : 'Show category'}
                    className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
                      cat.is_active
                        ? 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
                        : 'bg-red-500/10 text-red-400 hover:bg-red-500/20'
                    }`}
                  >
                    {cat.is_active ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
                    ) : (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></svg>
                    )}
                  </button>
                  <button onClick={() => startEditCat(cat)} className="w-8 h-8 rounded-lg bg-[#1A1A24] flex items-center justify-center text-[#5C5E72] hover:text-[#3B82F6] transition-colors" title="Edit">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                  </button>
                  <button
                    onClick={() => {
                      if (confirm(`Delete "${cat.name}"? This will also delete ${catSubs.length} subcategories.`)) {
                        handleDeleteCategory(cat.id);
                      }
                    }}
                    disabled={deleting === cat.id}
                    className="w-8 h-8 rounded-lg bg-[#1A1A24] flex items-center justify-center text-[#5C5E72] hover:text-red-400 transition-colors disabled:opacity-50"
                    title="Delete"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                  </button>
                </div>
              </div>

              {/* Subcategories */}
              <div className="border-t border-[#1E1E2C] px-3.5 py-2">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[9px] text-[#5C5E72] font-medium uppercase tracking-wider">Subcategories ({catSubs.length})</p>
                  <button
                    onClick={() => {
                      setEditingSub(null);
                      setSubForm({ name: '', category_id: cat.id, sort_order: catSubs.length });
                      setShowSubForm(true);
                    }}
                    className="text-[10px] px-2 py-0.5 rounded-md bg-[#3B82F6]/10 text-[#3B82F6] hover:bg-[#3B82F6]/20 transition-colors"
                  >
                    + Add Subcategory
                  </button>
                </div>
                {catSubs.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {catSubs.map(sub => (
                      <span
                        key={sub.id}
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] ${
                          sub.is_active
                            ? 'bg-[#3B82F6]/10 text-[#3B82F6] border border-[#3B82F6]/20'
                            : 'bg-red-500/5 text-red-400/60 border border-red-500/10 line-through'
                        }`}
                      >
                        {sub.name}
                        <button onClick={() => handleToggleSubActive(sub)} title={sub.is_active ? 'Hide' : 'Show'} className="hover:opacity-70">
                          {sub.is_active ? '👁' : '🚫'}
                        </button>
                        <button onClick={() => startEditSub(sub)} className="hover:opacity-70">✏️</button>
                        <button onClick={() => { if (confirm(`Delete "${sub.name}"?`)) handleDeleteSubcategory(sub.id); }} className="hover:opacity-70">🗑</button>
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-[10px] text-[#3A3A4A] italic">No subcategories yet. Click "+ Add Subcategory" to create one.</p>
                )}
              </div>
            </div>
          );
        })}

        {visibleCategories.length === 0 && (
          <div className="text-center py-10">
            <p className="text-sm text-[#5C5E72]">No categories found</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// PROPERTY TYPE MANAGER
// ═══════════════════════════════════════════════════════════════

function PropertyTypeManager({ profile: _profile }: { profile: Profile }) {
  const [types, setTypes] = useState<string[]>([]);
  const [subtypes, setSubtypes] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newType, setNewType] = useState('');
  const [newSubtype, setNewSubtype] = useState<Record<string, string>>({});

  const ICON_MAP: Record<string, string> = {
    apartment: '🏢', hotel: '🏨', house: '🏠', duplex: '🏘️',
    studio: '🛋️', self_contain: '🚪', 'self-contain': '🚪',
    hostel: '🛏️', lodge: '🏕️', resort: '🏖️',
    office: '🏢', warehouse: '🏭', land: '🌿',
  };

  function toLabel(value: string): string {
    return value.split(/[_\-]/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }

  function getIcon(value: string): string {
    return ICON_MAP[value] || '🏠';
  }

  async function load() {
    setLoading(true);
    // Load types
    const { data: typesData } = await supabase.rpc('get_platform_setting', { p_key: 'property_types_allowed' });
    let loadedTypes: string[] = [];
    if (typesData) {
      try { const parsed = JSON.parse(typesData); if (Array.isArray(parsed)) loadedTypes = parsed; } catch { }
    }
    if (loadedTypes.length === 0) {
      loadedTypes = ['apartment', 'house', 'duplex', 'studio', 'self_contain', 'office', 'warehouse', 'land', 'hotel', 'hostel', 'lodge', 'resort'];
    }
    setTypes(loadedTypes);

    // Load subtypes
    const { data: subData } = await supabase.rpc('get_platform_setting', { p_key: 'property_subtypes' });
    let loadedSubtypes: Record<string, string[]> = {};
    if (subData) {
      try { loadedSubtypes = JSON.parse(subData); } catch { }
    }
    // Fallback defaults
    if (Object.keys(loadedSubtypes).length === 0) {
      loadedSubtypes = {
        apartment: ['Short Stay', 'Long Stay'],
        house: ['Bungalow', 'Duplex', 'Terrace', 'Semi-Detached', 'Detached'],
        hotel: ['Standard', 'Deluxe', 'Suite'],
      };
    }
    setSubtypes(loadedSubtypes);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function saveTypes(newTypes: string[]) {
    setSaving(true);
    await supabase.rpc('update_platform_setting', {
      p_key: 'property_types_allowed',
      p_value: JSON.stringify(newTypes),
    });
    setSaving(false);
    setTypes(newTypes);
  }

  async function saveSubtypes(newSubtypes: Record<string, string[]>) {
    setSaving(true);
    await supabase.rpc('update_platform_setting', {
      p_key: 'property_subtypes',
      p_value: JSON.stringify(newSubtypes),
    });
    setSaving(false);
    setSubtypes(newSubtypes);
  }

  function handleAddType() {
    const clean = newType.trim().toLowerCase().replace(/\s+/g, '_');
    if (!clean) { toast.error('Enter a property type'); return; }
    if (types.includes(clean)) { toast.error('Type already exists'); return; }
    saveTypes([...types, clean]);
    setNewType('');
  }

  function handleRemoveType(value: string) {
    if (!confirm(`Remove "${toLabel(value)}"? Existing listings using this type will still work.`)) return;
    saveTypes(types.filter(t => t !== value));
    // Also remove its subtypes
    const newSubtypes = { ...subtypes };
    delete newSubtypes[value];
    saveSubtypes(newSubtypes);
  }

  function handleMoveType(index: number, direction: -1 | 1) {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= types.length) return;
    const updated = [...types];
    [updated[index], updated[newIndex]] = [updated[newIndex], updated[index]];
    saveTypes(updated);
  }

  function handleAddSubtype(parentType: string) {
    const val = (newSubtype[parentType] || '').trim();
    if (!val) { toast.error('Enter a sub-type name'); return; }
    const current = subtypes[parentType] || [];
    if (current.includes(val)) { toast.error('Sub-type already exists'); return; }
    const updated = { ...subtypes, [parentType]: [...current, val] };
    saveSubtypes(updated);
    setNewSubtype(prev => ({ ...prev, [parentType]: '' }));
  }

  function handleRemoveSubtype(parentType: string, subtype: string) {
    const current = subtypes[parentType] || [];
    const updated = { ...subtypes, [parentType]: current.filter(s => s !== subtype) };
    saveSubtypes(updated);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-3 border-[#3B82F6] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-white">Property Types</h2>
          <p className="text-[11px] text-[#5C5E72]">{types.length} types. Add sub-types under each type (e.g., Apartment → Short Stay, Long Stay).</p>
        </div>
        {saving && <div className="w-5 h-5 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" />}
      </div>

      {/* Add new type */}
      <div className="flex gap-2">
        <input type="text" value={newType} onChange={e => setNewType(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAddType()} placeholder="e.g. Penthouse, Mansion..." className="flex-1 h-10 rounded-xl bg-[#12121A] border border-[#1E1E2C] text-white text-sm px-4 placeholder-[#3A3A4A] focus:border-[#3B82F6]/50 outline-none" />
        <button onClick={handleAddType} className="h-10 px-4 rounded-xl bg-[#3B82F6]/15 text-[#3B82F6] text-xs font-semibold border border-[#3B82F6]/20 hover:bg-[#3B82F6]/25 transition-colors">+ Add Type</button>
      </div>

      {/* Types list with subtypes */}
      <div className="space-y-3">
        {types.map((t, i) => {
          const typeSubtypes = subtypes[t] || [];
          return (
            <div key={t} className="glass rounded-xl overflow-hidden">
              {/* Type header */}
              <div className="p-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-xl">{getIcon(t)}</span>
                  <div>
                    <p className="text-xs font-semibold text-white">{toLabel(t)}</p>
                    <p className="text-[10px] text-[#5C5E72] font-mono">{t} · {typeSubtypes.length} sub-types</p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <button onClick={() => handleMoveType(i, -1)} disabled={i === 0} className="w-7 h-7 rounded-lg bg-[#1A1A24] flex items-center justify-center text-[#5C5E72] hover:text-white disabled:opacity-30 transition-colors" title="Move up"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 15l-6-6-6 6" /></svg></button>
                  <button onClick={() => handleMoveType(i, 1)} disabled={i === types.length - 1} className="w-7 h-7 rounded-lg bg-[#1A1A24] flex items-center justify-center text-[#5C5E72] hover:text-white disabled:opacity-30 transition-colors" title="Move down"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6" /></svg></button>
                  <button onClick={() => handleRemoveType(t)} className="w-7 h-7 rounded-lg bg-[#1A1A24] flex items-center justify-center text-[#5C5E72] hover:text-red-400 transition-colors" title="Remove"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg></button>
                </div>
              </div>

              {/* Subtypes */}
              <div className="border-t border-[#1E1E2C] px-3 py-2">
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {typeSubtypes.map(sub => (
                    <span key={sub} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] bg-[#3B82F6]/10 text-[#3B82F6] border border-[#3B82F6]/20">
                      {sub}
                      <button onClick={() => handleRemoveSubtype(t, sub)} className="hover:text-red-400" title="Remove">×</button>
                    </span>
                  ))}
                  {typeSubtypes.length === 0 && <p className="text-[10px] text-[#3A3A4A] italic">No sub-types yet</p>}
                </div>
                <div className="flex gap-2">
                  <input type="text" value={newSubtype[t] || ''} onChange={e => setNewSubtype(prev => ({ ...prev, [t]: e.target.value }))} onKeyDown={e => e.key === 'Enter' && handleAddSubtype(t)} placeholder={`Add sub-type under ${toLabel(t)}...`} className="flex-1 h-8 rounded-lg bg-[#12121A] border border-[#1E1E2C] text-white text-[11px] px-3 placeholder-[#3A3A4A] focus:border-[#3B82F6]/50 outline-none" />
                  <button onClick={() => handleAddSubtype(t)} className="h-8 px-3 rounded-lg bg-[#3B82F6]/10 text-[#3B82F6] text-[10px] font-semibold hover:bg-[#3B82F6]/20 transition-colors">+ Add</button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Toggle Switch ──────────────────────────────────

function ToggleSwitch({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className={`relative w-10 h-5.5 rounded-full transition-colors ${enabled ? 'bg-[#10B981]' : 'bg-[#2A2A3A]'}`}
    >
      <div className={`absolute top-0.5 w-4.5 h-4.5 rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
    </button>
  );
}
