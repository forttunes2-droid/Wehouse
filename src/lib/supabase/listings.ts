import { supabase } from './client';
import type { Listing } from '@/types';
import { compressImageFile } from './utils';
import { ROLE_RANK } from '@/types';

// Canonical listing API. Public reads use RLS; all mutations use server-authorized RPCs.

export async function getAllListings() {
  const { data, error } = await supabase
    .from('listings')
    .select('*')
    .eq('status', 'available')
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  return { listings: data as Listing[] | null, error };
}

export async function getListing(id: string) {
  const { data, error } = await supabase
    .from('listings')
    .select('*')
    .or(`listing_id.eq.${id},id.eq.${id}`)
    .is('deleted_at', null)
    .maybeSingle();
  return { listing: data as Listing | null, error };
}

export { getListing as getListingById };

export async function getCreatorListings(userId: string) {
  const { data, error } = await supabase
    .from('listings')
    .select('*')
    .eq('owner_id', userId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  return { listings: data as Listing[] | null, error };
}

export { getCreatorListings as getListingsByOwner };

export async function getAvailableChatAgents(listingState?: string, listingLga?: string) {
  const { data, error } = await supabase
    .from('profiles')
    .select('user_id, username, avatar_url, role, assigned_state, assigned_lga, state, city')
    .in('role', ['staff', 'admin'])
    .eq('deleted', false)
    .eq('suspended', false)
    .eq('banned', false)
    .order('username', { ascending: true });

  const normState = (listingState || '').trim().toLowerCase();
  const normLga = (listingLga || '').trim().toLowerCase();
  const agents = (data || []).map((row) => ({ ...row })) as Array<{
    user_id: string;
    username: string | null;
    avatar_url: string | null;
    role: string;
    assigned_state: string | null;
    assigned_lga: string | null;
    state: string | null;
    city: string | null;
  }>;

  agents.sort((a, b) => {
    const aState = (a.assigned_state || a.state || '').trim().toLowerCase();
    const bState = (b.assigned_state || b.state || '').trim().toLowerCase();
    const aLga = (a.assigned_lga || a.city || '').trim().toLowerCase();
    const bLga = (b.assigned_lga || b.city || '').trim().toLowerCase();
    const aExact = !!normState && aState === normState && (!normLga || aLga === normLga);
    const bExact = !!normState && bState === normState && (!normLga || bLga === normLga);
    if (aExact !== bExact) return aExact ? -1 : 1;
    return (a.username || '').localeCompare(b.username || '');
  });

  return { agents: agents.length ? agents : null, error };
}

export async function detectDuplicateImage(imageUrl: string, listingId?: string, ownerId?: string) {
  const { data, error } = await supabase.functions.invoke('detect-duplicate-images', {
    body: { imageUrl, listingId, ownerId },
  });
  return { result: data, error };
}

export async function checkDuplicateListing(title: string, _area: string, city: string, state: string, posterUserId?: string) {
  const normalized = title.trim().toLowerCase().replace(/\s+/g, ' ');
  if (normalized.length < 6) return { titleMatch: false, recentPost: null };

  const { data: existing } = await supabase
    .from('listings')
    .select('id,title,owner_id,created_at')
    .eq('city', city)
    .eq('state', state)
    .not('status', 'in', '(closed,rejected)')
    .is('deleted_at', null)
    .limit(50);

  const threshold = normalized.length < 15 ? 0.95 : normalized.length < 30 ? 0.88 : 0.82;
  const titleMatch = (existing || []).some((listing) => {
    if (!listing.title || (posterUserId && listing.owner_id === posterUserId)) return false;
    return calculateSimilarity(normalized, listing.title.trim().toLowerCase().replace(/\s+/g, ' ')) >= threshold;
  });

  let recentPost = null;
  if (posterUserId) {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data } = await supabase
      .from('listings')
      .select('id,created_at')
      .eq('owner_id', posterUserId)
      .eq('city', city)
      .gte('created_at', thirtyDaysAgo)
      .is('deleted_at', null)
      .limit(1)
      .maybeSingle();
    recentPost = data;
  }

  return { titleMatch, recentPost };
}

function calculateSimilarity(a: string, b: string) {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const matrix = Array.from({ length: b.length + 1 }, (_, i) => [i]);
  for (let j = 0; j <= a.length; j += 1) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i += 1) {
    for (let j = 1; j <= a.length; j += 1) {
      matrix[i][j] = b[i - 1] === a[j - 1]
        ? matrix[i - 1][j - 1]
        : Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
    }
  }
  return 1 - matrix[b.length][a.length] / Math.max(a.length, b.length);
}

export async function uploadListingImage(file: File, listingId: string) {
  if (!file.type.startsWith('image/')) return { url: null, error: { message: 'Please select an image file' } as any };
  if (file.size > 10 * 1024 * 1024) return { url: null, error: { message: 'Image must be under 10MB' } as any };
  try {
    const compressed = await compressImageFile(file, 1600, 0.86);
    const path = `listings/${listingId}/${crypto.randomUUID()}.jpg`;
    const { error } = await supabase.storage.from('listing-images').upload(path, compressed, { contentType: 'image/jpeg' });
    if (error) return { url: null, error };
    return { url: supabase.storage.from('listing-images').getPublicUrl(path).data.publicUrl, error: null };
  } catch (error: any) {
    return { url: null, error: { message: error?.message || 'Image upload failed' } };
  }
}

export async function uploadListingVideo(file: File, listingId: string) {
  const allowed = ['video/mp4', 'video/quicktime', 'video/webm'];
  if (!allowed.includes(file.type)) return { url: null, error: { message: 'Only MP4, MOV and WebM videos are allowed' } as any };
  if (file.size > 50 * 1024 * 1024) return { url: null, error: { message: 'Video must be under 50MB' } as any };
  const extension = file.name.split('.').pop() || 'mp4';
  const path = `listings/${listingId}/${crypto.randomUUID()}.${extension}`;
  const { error } = await supabase.storage.from('listing-videos').upload(path, file, { contentType: file.type });
  if (error) return { url: null, error };
  return { url: supabase.storage.from('listing-videos').getPublicUrl(path).data.publicUrl, error: null };
}

export async function deleteListing(listingId: string, _userId?: string) {
  const { data, error } = await supabase.rpc('soft_delete_listing_internal', { p_listing_id: listingId });
  return { success: data === true, error };
}

export async function saveListing(userId: string, listingId: string) {
  const { error } = await supabase.from('saved_listings').upsert({ user_id: userId, listing_id: listingId }, { onConflict: 'user_id,listing_id' });
  return { error };
}

export async function unsaveListing(userId: string, listingId: string) {
  const { error } = await supabase.from('saved_listings').delete().eq('user_id', userId).eq('listing_id', listingId);
  return { error };
}

export async function getSavedListings(userId: string) {
  const { data, error } = await supabase.from('saved_listings').select('listing_id').eq('user_id', userId);
  return { saved: data || [], savedIds: (data || []).map((row) => row.listing_id) as string[], error };
}

export async function createListing(listing: Omit<Listing, 'id' | 'listing_id' | 'created_at' | 'updated_at'>) {
  const { data, error } = await supabase.rpc('create_internal_listing', { p_data: listing });
  return { listing: data as Listing | null, error };
}

export function getRequiredApproverRank(posterRole: string) {
  if (posterRole === 'staff') return ROLE_RANK.admin;
  return ROLE_RANK.creator;
}

export function getApproverLabel(posterRole: string) {
  return posterRole === 'staff' ? 'Admin or Creator' : 'Creator only';
}

export function canApproveListing(userRole: string, posterRole: string) {
  return (ROLE_RANK[userRole as keyof typeof ROLE_RANK] || 0) >= getRequiredApproverRank(posterRole);
}

export async function getListingsPendingApproval(userRole: string, _userId: string, scopeState?: string, scopeLga?: string) {
  let query = supabase
    .from('listings')
    .select('*')
    .eq('status', 'pending_approval')
    .is('deleted_at', null);
  if (scopeState) query = query.eq('state', scopeState);
  if (scopeLga) query = query.eq('city', scopeLga);
  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) return { listings: [] as Listing[], error };
  return {
    listings: (data || []).filter((listing) => canApproveListing(userRole, listing.submitted_by_role || 'staff')) as Listing[],
    error: null,
  };
}

export async function approveListing(listingId: string, _approverId?: string) {
  const { data, error } = await supabase.rpc('approve_listing_internal', { p_listing_id: listingId });
  return { listing: data as Listing | null, error };
}

export async function rejectListing(listingId: string, _approverId: string | undefined, reason: string) {
  const { data, error } = await supabase.rpc('reject_listing_internal', { p_listing_id: listingId, p_reason: reason });
  return { listing: data as Listing | null, error };
}

export async function getMyPendingListings(userId: string) {
  const { data, error } = await supabase
    .from('listings')
    .select('*')
    .eq('owner_id', userId)
    .eq('status', 'pending_approval')
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  return { listings: data as Listing[] | null, error };
}

export async function updateListingStatus(listingId: string, status: string, _updates?: Record<string, unknown>) {
  const { data, error } = await supabase.rpc('set_listing_status_internal', { p_listing_id: listingId, p_status: status });
  return { listing: data as Listing | null, error };
}
