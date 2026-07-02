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

export async function getReviews(targetId: string) {
  const { data, error } = await supabase
    .from('reviews')
    .select('*')
    .eq('target_id', targetId)
    .order('created_at', { ascending: false });
  return { reviews: data as Review[] | null, error };
}

export async function createReview(reviewerId: string, targetId: string, rating: number, content: string) {
  const { data, error } = await supabase
    .from('reviews')
    .insert({ reviewer_id: reviewerId, target_id: targetId, rating, content })
    .select()
    .single();
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
    .single();
  return { interest: data as RoomInterest | null, error };
}
