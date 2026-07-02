import { supabase } from './client';
import type { RoommatePreferences } from '@/types';

// ─── ROOMMATE HELPERS ──────────────────────────────

// 8-hour search window in milliseconds
const SEARCH_DURATION_MS = 8 * 60 * 60 * 1000;

export async function saveRoommatePreferences(prefs: Partial<RoommatePreferences>) {
  const { data, error } = await supabase
    .from('roommate_preferences')
    .upsert(
      { ...prefs, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    )
    .select()
    .maybeSingle();
  return { prefs: data as RoommatePreferences | null, error };
}

export async function getRoommatePreferences(userId: string) {
  const { data, error } = await supabase.from('roommate_preferences').select('*').eq('user_id', userId).maybeSingle();
  return { prefs: data as RoommatePreferences | null, error };
}

export async function findMatches(userId: string) {
  const { data, error } = await supabase.rpc('find_roommate_matches', { p_user_id: userId });
  return { matches: data || [], error };
}

// ─── BACKGROUND SEARCH SYSTEM ──────────────────────

// Start an 8-hour active search window
export async function startRoommateSearch(userId: string) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SEARCH_DURATION_MS);

  const { data, error } = await supabase
    .from('roommate_preferences')
    .update({
      search_status: 'active',
      search_started_at: now.toISOString(),
      search_expires_at: expiresAt.toISOString(),
      search_match_count: 0,
      updated_at: now.toISOString(),
    })
    .eq('user_id', userId)
    .select()
    .maybeSingle();

  return { prefs: data as RoommatePreferences | null, error };
}

// Stop an active search
export async function stopRoommateSearch(userId: string) {
  const { data, error } = await supabase
    .from('roommate_preferences')
    .update({
      search_status: 'stopped',
      search_expires_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId)
    .select()
    .maybeSingle();

  return { prefs: data as RoommatePreferences | null, error };
}

// Refresh search — extends the 8-hour window and re-runs matching
export async function refreshRoommateSearch(userId: string) {
  // 1. Re-run the match algorithm
  const { matches: newMatches, error: matchError } = await findMatches(userId);
  if (matchError) return { matches: [], error: matchError };

  // 2. Get existing saved matches to avoid duplicates
  const { data: existing } = await supabase
    .from('roommate_search_results')
    .select('matched_user_id')
    .eq('searcher_id', userId);

  const existingIds = new Set((existing || []).map((m: any) => m.matched_user_id));

  // 3. Save only new matches
  const trulyNew = (newMatches || []).filter((m: any) => !existingIds.has(m.user_id));
  if (trulyNew.length > 0) {
    const rows = trulyNew.map((m: any) => ({
      searcher_id: userId,
      matched_user_id: m.user_id,
      match_score: m.match_score || 0,
      status: 'new',
    }));
    await supabase.from('roommate_search_results').insert(rows);
  }

  // 4. Update match count on preferences
  const { data: allSaved } = await supabase
    .from('roommate_search_results')
    .select('*', { count: 'exact', head: true })
    .eq('searcher_id', userId);

  await supabase
    .from('roommate_preferences')
    .update({ search_match_count: allSaved?.length || 0 })
    .eq('user_id', userId);

  return { matches: newMatches || [], error: null };
}

// Get saved match results (persisted across sessions)
export async function getSavedMatchResults(userId: string) {
  const { data, error } = await supabase
    .from('roommate_search_results')
    .select(`
      *,
      matched_profile:profiles!matched_user_id(username, gender, city, state, bio, school)
    `)
    .eq('searcher_id', userId)
    .order('match_score', { ascending: false });

  return { matches: data || [], error };
}

// Update a match status (viewed, accepted, declined)
export async function updateMatchStatus(matchId: string, status: 'new' | 'viewed' | 'accepted' | 'declined') {
  const { error } = await supabase
    .from('roommate_search_results')
    .update({ status })
    .eq('id', matchId);
  return { error };
}

// Clear all saved match results for a user
export async function clearMatchResults(userId: string) {
  const { error } = await supabase
    .from('roommate_search_results')
    .delete()
    .eq('searcher_id', userId);
  return { error };
}

// Check if search has expired — if so, update status
export async function checkSearchExpiry(userId: string): Promise<{ expired: boolean; prefs: RoommatePreferences | null }> {
  const { prefs } = await getRoommatePreferences(userId);
  if (!prefs) return { expired: false, prefs: null };

  // If already expired/stopped, return as-is
  if (prefs.search_status === 'expired' || prefs.search_status === 'stopped' || prefs.search_status === 'idle') {
    return { expired: prefs.search_status === 'expired', prefs };
  }

  // Check if the expiry time has passed
  if (prefs.search_expires_at && new Date(prefs.search_expires_at) < new Date()) {
    // Update to expired
    const { data } = await supabase
      .from('roommate_preferences')
      .update({ search_status: 'expired' })
      .eq('user_id', userId)
      .select()
      .maybeSingle();
    return { expired: true, prefs: data as RoommatePreferences | null };
  }

  return { expired: false, prefs };
}
