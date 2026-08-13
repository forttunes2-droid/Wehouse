import { supabase } from './client';
import type { RoommatePreferences } from '@/types';

export async function saveRoommatePreferences(prefs: Partial<RoommatePreferences>) {
  const { data, error } = await supabase.rpc('save_my_roommate_preferences', {
    p_gender: prefs.gender || '',
    p_gender_preference: prefs.gender_preference || 'no_preference',
    p_budget_min: Number(prefs.budget_min || 0),
    p_budget_max: Number(prefs.budget_max || 0),
    p_cleanliness: prefs.cleanliness || 'moderate',
    p_noise_level: prefs.noise_level || 'moderate',
    p_sleep_time: prefs.sleep_time || '10pm-11pm',
    p_visitors: prefs.visitors || 'sometimes',
    p_stay_duration: prefs.stay_duration || '1_year',
    p_area_preference: prefs.area_preference || null,
    p_bio: prefs.bio || null,
    p_school_name: prefs.school_name || null,
    p_campus: prefs.campus || null,
    p_level: prefs.level || null,
    p_department: prefs.department || null,
  });
  if (error || !data) return { prefs: (data || null) as RoommatePreferences | null, error };

  const { data: schoolData, error: schoolError } = await supabase.rpc('set_my_roommate_school_filter', {
    p_school_match: Boolean(prefs.school_match),
    p_school_name: prefs.school_name || null,
    p_campus: prefs.campus || null,
  });
  return {
    prefs: (schoolData || data || null) as RoommatePreferences | null,
    error: schoolError,
  };
}

export async function getRoommatePreferences(_userId?: string) {
  const { data, error } = await supabase.rpc('get_my_roommate_preferences');
  const row = Array.isArray(data) ? data[0] : data;
  return { prefs: (row || null) as RoommatePreferences | null, error };
}

export async function startRoommateSearch(_userId?: string) {
  const { data, error } = await supabase.rpc('start_my_roommate_search');
  return { prefs: (data || null) as RoommatePreferences | null, error };
}

export async function stopRoommateSearch(_userId?: string) {
  const { data, error } = await supabase.rpc('stop_my_roommate_search');
  return { prefs: (data || null) as RoommatePreferences | null, error };
}

export async function refreshRoommateSearch(_userId?: string) {
  const { error } = await supabase.rpc('refresh_my_roommate_search');
  if (error) return { matches: [], error };
  return getSavedMatchResults();
}

export async function getSavedMatchResults(_userId?: string) {
  const { data, error } = await supabase.rpc('get_my_roommate_matches');
  const matches = (data || []).map((row: any) => ({
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
    },
  }));
  return { matches, error };
}

export async function updateMatchStatus(matchId: string, status: 'new' | 'viewed' | 'accepted' | 'declined') {
  const { data, error } = await supabase.rpc('update_my_roommate_match_status', {
    p_match_id: matchId,
    p_status: status,
  });
  return { conversationId: data || null, error };
}

export async function checkSearchExpiry(_userId?: string): Promise<{ expired: boolean; prefs: RoommatePreferences | null }> {
  const { prefs } = await getRoommatePreferences();
  return { expired: prefs?.search_status === 'expired', prefs };
}

// Compatibility aliases retained only for callers while the UI is consolidated.
export async function findMatches(_userId?: string) { return refreshRoommateSearch(); }
export async function clearMatchResults(_userId?: string) { return { error: null }; }
