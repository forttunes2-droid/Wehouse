import { supabase } from './client';

export type ReportSubject = 'roommate_chat' | 'companion_chat' | 'worker_chat' | 'hotel_chat' | 'support_case' | 'profile' | 'message';
export const REPORT_REASONS = [
  ['spam', 'Spam'],
  ['harassment', 'Harassment'],
  ['scam', 'Scam or fraud'],
  ['unsafe', 'Unsafe'],
  ['inappropriate', 'Inappropriate'],
  ['other', 'Something else'],
] as const;

export async function reportContent(subjectType: ReportSubject, subjectUserId: string, reason: string, details?: string, subjectRef?: string) {
  const { error } = await supabase.rpc('report_content', { p_subject_type: subjectType, p_subject_user_id: subjectUserId, p_reason: reason, p_details: details ?? null, p_subject_ref: subjectRef ?? null });
  return { error };
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
  return { data: (data ?? []) as ContentReport[], error };
}

export async function resolveContentReport(id: string, status: 'reviewing' | 'actioned' | 'dismissed', note?: string) {
  const { error } = await supabase.rpc('admin_resolve_content_report', { p_report_id: id, p_status: status, p_note: note ?? null });
  return { error };
}
