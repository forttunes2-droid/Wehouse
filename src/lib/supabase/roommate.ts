import { supabase } from "./client";
import type { RoommatePreferences } from "@/types";

const DEFAULT_MATCH_PAGE = 24;

export type RoommateMatchProfile = {
  user_id: string;
  username: string | null;
  full_name: string | null;
  avatar_url: string | null;
  gender: string | null;
  city: string | null;
  state: string | null;
  bio: string | null;
  school: string | null;
  area_preference: string | null;
  score_factors: Record<string, number>;
};
export type RoommateMatchResult = {
  id: string;
  matched_user_id: string;
  match_score: number;
  status: string;
  created_at: string;
  mutual_accepted: boolean;
  conversation_id: string | null;
  matched_profile: RoommateMatchProfile;
};
export type ReceivedRoommateInterest = {
  interest_id: string;
  sender_user_id: string;
  match_score: number;
  sent_at: string;
  username: string | null;
  full_name: string | null;
  avatar_url: string | null;
  city: string | null;
  state: string | null;
  school: string | null;
  bio: string | null;
};
type MatchRpcRow = Omit<RoommateMatchResult, "matched_profile"> &
  Omit<RoommateMatchProfile, "user_id" | "score_factors"> & {
    budget_score?: number;
    location_score?: number;
    cleanliness_score?: number;
    noise_score?: number;
    visitors_score?: number;
    stay_score?: number;
  };

export async function saveRoommatePreferences(
  prefs: Partial<RoommatePreferences>,
) {
  const { data, error } = await supabase.rpc("save_my_roommate_preferences", {
    p_gender: prefs.gender || "",
    p_gender_preference: prefs.gender_preference || "no_preference",
    p_budget_min: Number(prefs.budget_min || 0),
    p_budget_max: Number(prefs.budget_max || 0),
    p_cleanliness: prefs.cleanliness || "moderate",
    p_noise_level: prefs.noise_level || "moderate",
    p_sleep_time: prefs.sleep_time || "10pm-11pm",
    p_visitors: prefs.visitors || "sometimes",
    p_stay_duration: prefs.stay_duration || "1_year",
    p_area_preference: prefs.area_preference || null,
    p_bio: prefs.bio || null,
    p_school_name: prefs.school_name || null,
    p_campus: prefs.campus || null,
    p_level: prefs.level || null,
    p_department: prefs.department || null,
  });
  if (error || !data)
    return { prefs: (data || null) as RoommatePreferences | null, error };

  const { data: schoolData, error: schoolError } = await supabase.rpc(
    "set_my_roommate_school_filter",
    {
      p_school_match: Boolean(prefs.school_match),
      p_school_name: prefs.school_name || null,
      p_campus: prefs.campus || null,
    },
  );
  return {
    prefs: (schoolData || data || null) as RoommatePreferences | null,
    error: schoolError,
  };
}

export async function getRoommatePreferences(userId?: string) {
  void userId;
  const { data, error } = await supabase.rpc("get_my_roommate_preferences");
  const row = Array.isArray(data) ? data[0] : data;
  return { prefs: (row || null) as RoommatePreferences | null, error };
}

export async function startRoommateSearch(userId?: string) {
  void userId;
  const { data, error } = await supabase.rpc("start_my_roommate_search");
  return { prefs: (data || null) as RoommatePreferences | null, error };
}

export async function stopRoommateSearch(userId?: string) {
  void userId;
  const { data, error } = await supabase.rpc("stop_my_roommate_search");
  return { prefs: (data || null) as RoommatePreferences | null, error };
}

export async function refreshRoommateSearch(userId?: string) {
  void userId;
  const { error } = await supabase.rpc("refresh_my_roommate_search");
  if (error) return { matches: [], hasMore: false, error };
  return getSavedMatchResults(DEFAULT_MATCH_PAGE, 0);
}

export async function getSavedMatchResults(
  limit = DEFAULT_MATCH_PAGE,
  offset = 0,
) {
  const pageSize = Math.max(1, Math.min(limit, 48));
  const { data, error } = await supabase.rpc("get_my_roommate_matches_page", {
    p_limit: pageSize + 1,
    p_offset: Math.max(0, offset),
  });
  const rows = data || [];
  const hasMore = rows.length > pageSize;
  const matches: RoommateMatchResult[] = (rows as MatchRpcRow[])
    .slice(0, pageSize)
    .map((row) => ({
      id: row.id,
      matched_user_id: row.matched_user_id,
      match_score: row.match_score,
      status: row.status,
      created_at: row.created_at,
      mutual_accepted: Boolean(row.mutual_accepted),
      conversation_id: row.conversation_id || null,
      matched_profile: {
        user_id: row.matched_user_id,
        username: row.username,
        full_name: row.full_name,
        avatar_url: row.avatar_url,
        gender: row.gender,
        city: row.city,
        state: row.state,
        bio: row.bio,
        school: row.school,
        area_preference: row.area_preference,
        score_factors: {
          budget: Number(row.budget_score || 0),
          location: Number(row.location_score || 0),
          cleanliness: Number(row.cleanliness_score || 0),
          noise: Number(row.noise_score || 0),
          visitors: Number(row.visitors_score || 0),
          stay: Number(row.stay_score || 0),
        },
      },
    }));
  return { matches, hasMore, error };
}

export async function updateMatchStatus(
  matchId: string,
  status: "new" | "viewed" | "accepted" | "declined",
) {
  const { data, error } = await supabase.rpc(
    "update_my_roommate_match_status",
    {
      p_match_id: matchId,
      p_status: status,
    },
  );
  return { conversationId: data || null, error };
}

export async function getReceivedRoommateInterests() {
  const { data, error } = await supabase.rpc(
    "get_my_received_roommate_interests",
  );
  return { interests: (data || []) as ReceivedRoommateInterest[], error };
}

export async function respondToRoommateInterest(
  interestId: string,
  response: "accepted" | "declined",
) {
  const { data, error } = await supabase.rpc(
    "respond_to_my_roommate_interest",
    {
      p_interest_id: interestId,
      p_response: response,
    },
  );
  return { conversationId: (data as string | null) || null, error };
}

export async function checkSearchExpiry(
  userId?: string,
): Promise<{ expired: boolean; prefs: RoommatePreferences | null }> {
  void userId;
  const { prefs } = await getRoommatePreferences();
  return { expired: prefs?.search_status === "expired", prefs };
}
