import { supabase } from './client';
import type { Review, RoomInterest } from '@/types';

// ─── PERSONAL ACTIVITY ─────────────────────────────

export interface UserActivityItem {
  id: string;
  user_id: string;
  auth_id: string;
  action_type: string;
  details: Record<string, any>;
  created_at: string;
}

export async function getUserActivity(userId: string, limit: number = 30) {
  const { data, error } = await supabase
    .from('user_activity')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  return { activity: data as UserActivityItem[] | null, error };
}

export async function getUserMatches(userId: string) {
  // Get roommate matches involving the user
  const { data, error } = await supabase
    .from('roommate_matches')
    .select('*, user_a:profiles!user_a_id(username, city, state), user_b:profiles!user_b_id(username, city, state)')
    .or(`user_a_id.eq.${userId},user_b_id.eq.${userId}`)
    .order('created_at', { ascending: false })
    .limit(20);
  return { matches: data || [], error };
}

export async function getUserRoomInterests(userId: string) {
  // Get room interests where user is sender or receiver
  const { data, error } = await supabase
    .from('room_interests')
    .select('*')
    .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)
    .order('created_at', { ascending: false })
    .limit(20);
  return { interests: data as RoomInterest[] | null, error };
}

export async function getSavedListingsWithData(userId: string) {
  const { data, error } = await supabase
    .from('saved_listings')
    .select('*, listing:listings(*)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(20);
  return { saved: data || [], error };
}

// ─── REVIEWS ───────────────────────────────────────
// Column mapping: user_id = reviewer, worker_id = target, comment = content

export async function getReviews(targetId: string) {
  const { data, error } = await supabase
    .from('reviews')
    .select('*')
    .eq('worker_id', targetId)
    .order('created_at', { ascending: false });
  return { reviews: data as Review[] | null, error };
}

export async function createReview(reviewerId: string, targetId: string, rating: number, content: string) {
  const { data, error } = await supabase
    .from('reviews')
    .insert({ user_id: reviewerId, worker_id: targetId, rating, comment: content })
    .select()
    .maybeSingle();
  return { review: data as Review | null, error };
}

// ─── ROOM INTERESTS ────────────────────────────────

export async function getRoomInterests(listingId: string) {
  const { data, error } = await supabase
    .from('room_interests')
    .select('*')
    .eq('listing_id', listingId)
    .order('created_at', { ascending: false });
  return { interests: data as RoomInterest[] | null, error };
}

export async function createRoomInterest(userId: string, listingId: string, message?: string) {
  const { data, error } = await supabase
    .from('room_interests')
    .insert({ user_id: userId, listing_id: listingId, message })
    .select()
    .maybeSingle();
  return { interest: data as RoomInterest | null, error };
}


// ─── CANONICAL ACTIVITY FEED ───────────────────────
// activity_events + activity_event_audiences are the durable source of truth.
// Legacy notifications are only a compatibility/delivery layer.

export type ActivityWorkspace =
  | "personal"
  | "account"
  | "worker"
  | "partner"
  | "property_partner"
  | "hotel"
  | "staff"
  | "admin"
  | "creator"
  | "property_operations"
  | "field_operations"
  | "worker_operations"
  | "finance_operations"
  | "security_operations"
  | "support";

export type CanonicalActivityRow = {
  id: string;
  type: string;
  title: string;
  message: string | null;
  read: boolean;
  created_at: string;
  source_type: string | null;
  source_id: string | null;
  destination_route: string | null;
  destination_params: Record<string, unknown> | null;
  workspace: string;
  action_required: boolean;
  resolved_at: string | null;
};

export type CanonicalActivitySummary = {
  unread: number;
  needs_action: number;
  latest_at: string | null;
};

export async function getCanonicalActivity(
  workspace: ActivityWorkspace | string,
  limit = 100,
) {
  const { data, error } = await supabase.rpc("get_my_canonical_activity_v2", {
    p_workspace: workspace,
    p_limit: limit,
  });
  return {
    rows: validActivityRows(data) ? data : [],
    error: error || (validActivityRows(data) ? null : {message:'Activity returned an invalid response. Try again.'}),
  };
}

export async function getCanonicalActivitySummary(
  workspace: ActivityWorkspace | string,
) {
  const { data, error } = await supabase.rpc(
    "get_my_canonical_activity_summary",
    { p_workspace: workspace },
  );
  const value = (data || {}) as Partial<CanonicalActivitySummary>;
  const valid = Number.isSafeInteger(value.unread) && Number(value.unread)>=0 &&
    Number.isSafeInteger(value.needs_action) && Number(value.needs_action)>=0 &&
    (value.latest_at === null || (typeof value.latest_at==='string' && Number.isFinite(Date.parse(value.latest_at))));
  return {
    summary: {
      unread: Number(value.unread || 0),
      needs_action: Number(value.needs_action || 0),
      latest_at: value.latest_at ? String(value.latest_at) : null,
    },
    error: error || (valid ? null : {message:'Activity counts could not be confirmed. Refresh Activity.'}),
  };
}

function validActivityRows(value:unknown):value is CanonicalActivityRow[]{
  if(!Array.isArray(value))return false;
  return value.every(row=>row&&typeof row.id==='string'&&row.id.length>0&&
    typeof row.type==='string'&&typeof row.title==='string'&&typeof row.read==='boolean'&&
    typeof row.workspace==='string'&&row.workspace.length>0&&typeof row.action_required==='boolean'&&
    typeof row.created_at==='string'&&Number.isFinite(Date.parse(row.created_at))&&
    (row.resolved_at===null||(typeof row.resolved_at==='string'&&Number.isFinite(Date.parse(row.resolved_at))))&&
    ['message','source_type','source_id','destination_route'].every(key=>row[key]===null||typeof row[key]==='string')&&
    (row.destination_params===null||(typeof row.destination_params==='object'&&!Array.isArray(row.destination_params))))&&
    new Set(value.map(row=>row.id)).size===value.length;
}

export async function markCanonicalActivityRead(
  activityEventId: string,
  workspace: ActivityWorkspace | string,
) {
  const { data, error } = await supabase.rpc(
    "mark_my_canonical_activity_read",
    {
      p_activity_event_id: activityEventId,
      p_workspace: workspace,
    },
  );
  return { read: data === true, error: error || (data === true ? null : {message:'The Activity read receipt could not be confirmed. Refresh Activity.'}) };
}

export async function markAllCanonicalActivityRead(
  workspace: ActivityWorkspace | string,
) {
  const { data, error } = await supabase.rpc(
    "mark_all_my_canonical_activity_read",
    { p_workspace: workspace },
  );
  return { count: typeof data==='number'&&Number.isSafeInteger(data)&&data>=0?data:0,
    error: error || (typeof data==='number'&&Number.isSafeInteger(data)&&data>=0?null:{message:'The Activity read count could not be confirmed. Refresh Activity.'}) };
}

export function subscribeToCanonicalActivity(
  userId: string,
  channelName: string,
  onChange: () => void,
) {
  return supabase
    .channel(channelName)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "activity_event_audiences",
        filter: `recipient_user_id=eq.${userId}`,
      },
      onChange,
    );
}
