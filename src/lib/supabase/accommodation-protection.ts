import { supabase } from "./client";

export type AccommodationSubject = "short_let" | "hotel";

export type AccommodationProtection = {
  subject_type: AccommodationSubject;
  subject_id: string;
  protection_state: string | null;
  amount_total: number | null;
  checked_in_at: string | null;
  arrival_issue_window_hours: number | null;
  arrival_issue_deadline_at: string | null;
  policy_version_id: string | null;
  can_report_arrival_issue: boolean;
  arrival_issue_case_id: string | null;
};

export async function getMyAccommodationProtection(
  subjectType: AccommodationSubject,
  subjectId: string,
) {
  const { data, error } = await supabase.rpc(
    "get_my_accommodation_protection",
    { p_subject_type: subjectType, p_subject_id: subjectId },
  );
  return { protection: (data as AccommodationProtection | null) || null, error };
}

export async function reportMyAccommodationArrivalIssue(
  subjectType: AccommodationSubject,
  subjectId: string,
  reason: string,
) {
  const { data, error } = await supabase.rpc(
    "report_my_accommodation_arrival_issue",
    {
      p_subject_type: subjectType,
      p_subject_id: subjectId,
      p_reason: reason,
    },
  );
  return { caseId: (data as string | null) || null, error };
}
