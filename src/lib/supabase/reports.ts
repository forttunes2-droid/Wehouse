import { supabase } from './client';

export type ReportSubject = 'roommate_chat' | 'friend_chat' | 'worker_chat' | 'hotel_chat' | 'support_case' | 'profile' | 'message' | 'listing' | 'hotel';
export const REPORT_REASONS = [
  ['spam', 'Spam'],
  ['harassment', 'Harassment'],
  ['scam', 'Scam or fraud'],
  ['unsafe', 'Unsafe'],
  ['inappropriate', 'Inappropriate'],
  ['other', 'Something else'],
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number][0];

export async function reportContent(subjectType: ReportSubject, subjectUserId: string, reason: string, details?: string, subjectRef?: string) {
  const { data, error } = await supabase.rpc('report_content', { p_subject_type: subjectType, p_subject_user_id: subjectUserId, p_reason: reason, p_details: details ?? null, p_subject_ref: subjectRef ?? null });
  return { reportId: typeof data === 'string' ? data : null, error };
}

export async function reportListing(listingId: string, reason: ReportReason, details?: string) {
  const { data, error } = await supabase.rpc('report_listing', {
    p_listing_id: listingId,
    p_reason: reason,
    p_details: details ?? null,
  });
  return { reportId: typeof data === 'string' ? data : null, error };
}

export async function reportHotel(hotelId: number, reason: ReportReason, details?: string) {
  const { data, error } = await supabase.rpc('report_hotel', {
    p_hotel_id: hotelId, p_reason: reason, p_details: details ?? null,
  });
  return { reportId: typeof data === 'string' ? data : null, error };
}

export type MyContentReport = {
  report_id: string;
  subject_type: ReportSubject;
  subject_ref: string | null;
  reason: string;
  details: string | null;
  status: 'open' | 'reviewing' | 'actioned' | 'dismissed';
  created_at: string;
  resolved_at: string | null;
};

export async function listMyContentReports() {
  const { data, error } = await supabase.rpc('list_my_content_reports');
  return { data: (Array.isArray(data) ? data : []) as MyContentReport[], error: error || (!Array.isArray(data) ? { message: 'Report status response could not be confirmed' } : null) };
}

export type ContentReport = {
  id: string;
  reporter_user_id: string;
  subject_user_id: string;
  subject_type: ReportSubject;
  subject_ref: string | null;
  reason: string;
  details: string | null;
  status: 'open' | 'reviewing' | 'actioned' | 'dismissed';
  resolution_note: string | null;
  created_at: string;
};

export async function listContentReports(status: ContentReport['status']) {
  const { data, error } = await supabase.rpc('admin_list_content_reports', { p_status: status });
  return { data: (Array.isArray(data) ? data : []) as ContentReport[], error: error || (!Array.isArray(data) ? { message: 'Moderation queue response could not be confirmed' } : null) };
}

export async function resolveContentReport(id: string, status: 'reviewing' | 'actioned' | 'dismissed', note?: string) {
  const { error } = await supabase.rpc('admin_resolve_content_report', { p_report_id: id, p_status: status, p_note: note ?? null });
  return { error };
}
