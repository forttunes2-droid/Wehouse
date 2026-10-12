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
