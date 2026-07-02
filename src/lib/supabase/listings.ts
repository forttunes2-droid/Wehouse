import { supabase } from './client';
import type { Listing } from '@/types';
import { compressImageFile } from './utils';
import { ROLE_RANK } from '@/types';

// ─── LISTING HELPERS ───────────────────────────────

export async function getAllListings() {
  // Users only see available and reserved listings. Deleted and closed listings are hidden.
  const { data, error } = await supabase
    .from('listings')
    .select('*')
    .in('availability_status', ['available', 'reserved'])
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  return { listings: data as Listing[] | null, error };
}

export async function getListing(id: string) {
  const { data, error } = await supabase
    .from('listings')
    .select('*')
    .eq('listing_id', id)
    .is('deleted_at', null)
    .maybeSingle();
  return { listing: data as Listing | null, error };
}

// Alias used by ListingDetail.tsx
export { getListing as getListingById };

export async function getCreatorListings(userId: string) {
  const { data, error } = await supabase.from('listings').select('*').eq('owner_id', userId).is('deleted_at', null).order('created_at', { ascending: false });
  return { listings: data as Listing[] | null, error };
}

// Alias: get listings by owner (used by StaffDashboard)
export { getCreatorListings as getListingsByOwner };

// Get staff/admin users available to be assigned as chat agents for a listing
// Hierarchy:
//   Admin: can appoint staff
//   Assistant State Admin: can appoint admin, staff, or themselves
//   State Admin: can appoint staff, admin, assistant_state_admin, or themselves
//   Creator: can appoint anyone (staff, admin, assistant_state_admin, state_admin)
// Get all active staff who can be assigned as chat agents.
// Staff matching the listing's location appear FIRST, then others follow.
// Uses assigned_state/lga with fallback to state/city for location matching.
export async function getAvailableChatAgents(listingState?: string, listingLga?: string) {
  const { data, error } = await supabase
    .from('profiles')
    .select('user_id, username, avatar_url, role, assigned_state, assigned_lga, state, city')
    .in('role', ['staff', 'admin', 'assistant_state_admin'])
    .is('deleted_at', null)
    .order('username', { ascending: true });

  let agents = (data || []) as Array<{
    user_id: string; username: string | null; avatar_url: string | null; role: string;
    assigned_state: string | null; assigned_lga: string | null; state: string | null; city: string | null;
  }>;

  // Normalize listing location for comparison
  const normState = (listingState || '').trim().toLowerCase();
  const normLga = (listingLga || '').trim().toLowerCase();

  // Sort: staff matching listing location first, then others
  if (normState && agents.length > 1) {
    agents.sort((a, b) => {
      // Use assigned_* with fallback to state/city
      const aState = ((a.assigned_state || a.state) || '').trim().toLowerCase();
      const bState = ((b.assigned_state || b.state) || '').trim().toLowerCase();
      const aLga = ((a.assigned_lga || a.city) || '').trim().toLowerCase();
      const bLga = ((b.assigned_lga || b.city) || '').trim().toLowerCase();

      // Check if state matches (handles "Abuja (FCT)" vs "Abuja")
      const aMatchesState = aState === normState || aState.includes(normState) || normState.includes(aState);
      const bMatchesState = bState === normState || bState.includes(normState) || normState.includes(bState);

      // Check if LGA/city matches
      const aMatchesLga = normLga ? (aLga === normLga || aLga.includes(normLga) || normLga.includes(aLga)) : aMatchesState;
      const bMatchesLga = normLga ? (bLga === normLga || bLga.includes(normLga) || normLga.includes(bLga)) : bMatchesState;

      // Perfect match (state + lga) comes first
      if (aMatchesLga && !bMatchesLga) return -1;
      if (!aMatchesLga && bMatchesLga) return 1;

      // State match comes next
      if (aMatchesState && !bMatchesState) return -1;
      if (!aMatchesState && bMatchesState) return 1;

      // Alphabetical for same tier
      return (a.username || '').localeCompare(b.username || '');
    });
  }

  return { agents: agents.length > 0 ? agents : null, error };
}

// Check for duplicate listings — practical for Nigerian context (no house numbers)
// Uses: title similarity in same area + 30-day cooldown for same user
// Call the Supabase Edge Function to detect duplicate images
// Returns: { isDuplicate, isSuspicious, similarity, matches: [...] }
export async function detectDuplicateImage(imageUrl: string, listingId?: string, ownerId?: string) {
  const { data, error } = await supabase.functions.invoke('detect-duplicate-images', {
    body: { imageUrl, listingId, ownerId },
  });
  return { result: data, error };
}

export async function checkDuplicateListing(title: string, _area: string, city: string, state: string, posterAuthId?: string) {
  const normTitle = title.trim().toLowerCase().replace(/\s+/g, ' ');

  // Skip duplicate check for very short/generic titles — too many false positives
  if (normTitle.length < 6) {
    return { titleMatch: false, recentPost: null };
  }

  // 1. Fetch existing listings in same city (not hidden)
  // If area is provided, also filter by area for more precise matching
  let query = supabase
    .from('listings')
    .select('id, title, city, state, address, owner_id, created_at, images')
    .eq('city', city)
    .eq('state', state)
    .not('availability_status', 'eq', 'hidden')
    .is('deleted_at', null);

  const { data: existing } = await query.limit(50);

  // 2. Check title similarity — ADAPTIVE threshold based on title length
  // Short titles (< 15 chars): need 95%+ match to flag (avoids "clean room" vs "nice room")
  // Medium titles (15-30 chars): need 88%+ match
  // Long titles (> 30 chars): need 82%+ match
  const THRESHOLD = normTitle.length < 15 ? 0.95 : normTitle.length < 30 ? 0.88 : 0.82;

  let titleMatch = false;
  for (const listing of (existing || [])) {
    if (!listing.title) continue;
    // Skip comparing against the same user's own listings
    if (posterAuthId && listing.owner_id === posterAuthId) continue;
    const existingTitle = listing.title.trim().toLowerCase().replace(/\s+/g, ' ');
    const similarity = calculateSimilarity(normTitle, existingTitle);
    if (similarity >= THRESHOLD) {
      titleMatch = true;
      break;
    }
  }

  // 3. Same-user cooldown: same poster, same city, within last 30 days
  let recentPost = null;
  if (posterAuthId) {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data: recent } = await supabase
      .from('listings')
      .select('id, created_at')
      .eq('owner_id', posterAuthId)
      .eq('city', city)
      .gte('created_at', thirtyDaysAgo)
      .limit(1)
      .maybeSingle();
    recentPost = recent;
  }

  return {
    titleMatch,
    recentPost,
  };
}

// Levenshtein distance — measures how similar two strings are
function calculateSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      matrix[i][j] = b.charAt(i - 1) === a.charAt(j - 1)
        ? matrix[i - 1][j - 1]
        : Math.min(
            matrix[i - 1][j - 1] + 1, // substitution
            matrix[i][j - 1] + 1,     // insertion
            matrix[i - 1][j] + 1      // deletion
          );
    }
  }

  const maxLen = Math.max(a.length, b.length);
  return 1 - matrix[b.length][a.length] / maxLen;
}

export async function uploadListingImage(file: File, listingId: string) {
  if (!file.type.startsWith('image/')) return { url: null, error: { message: 'Please select an image (JPG, PNG)' } as any };
  if (file.size > 10 * 1024 * 1024) return { url: null, error: { message: 'Image must be under 10MB' } as any };

  try {
    const compressed = await compressImageFile(file, 1200, 0.8);
    const fileName = `listings/${listingId}/${Date.now()}.jpg`;
    const { error: uploadError } = await supabase.storage.from('listing-images').upload(fileName, compressed, { contentType: 'image/jpeg' });
    if (uploadError) return { url: null, error: uploadError };
    const { data: urlData } = supabase.storage.from('listing-images').getPublicUrl(fileName);
    return { url: urlData.publicUrl, error: null };
  } catch (err: any) {
    return { url: null, error: { message: err.message || 'Upload failed' } };
  }
}

export async function uploadListingVideo(file: File, listingId: string) {
  // Validate file type
  const validTypes = ['video/mp4', 'video/quicktime', 'video/webm'];
  if (!validTypes.includes(file.type)) {
    return { url: null, error: { message: 'Only MP4, MOV, and WebM videos are allowed' } as any };
  }
  // Validate file size (50MB max)
  if (file.size > 50 * 1024 * 1024) {
    return { url: null, error: { message: 'Video must be under 50MB' } as any };
  }

  const fileName = `listings/${listingId}/${Date.now()}-${file.name}`;
  const { error: uploadError } = await supabase.storage
    .from('listing-videos')
    .upload(fileName, file, { contentType: file.type });

  if (uploadError) {
    if (uploadError.message?.includes('bucket')) {
      return { url: null, error: { message: 'Video storage not configured. Run the SQL migration.' } as any };
    }
    return { url: null, error: uploadError };
  }

  const { data: urlData } = supabase.storage.from('listing-videos').getPublicUrl(fileName);
  return { url: urlData.publicUrl, error: null };
}

export async function deleteListing(listingId: string, userId?: string) {
  // Soft-delete: set deleted_at instead of hard delete
  // listingId is the UUID primary key (id column), NOT the listing_id text column
  if (userId) {
    const { data: listing } = await supabase
      .from('listings')
      .select('owner_id')
      .eq('id', listingId)
      .maybeSingle();
    if (!listing || listing.owner_id !== userId) {
      return { error: { message: 'You can only delete your own listings' } as any };
    }
  }

  const { error } = await supabase
    .from('listings')
    .update({ deleted_at: new Date().toISOString(), availability_status: 'closed' })
    .eq('id', listingId);

  return { error };
}

// ─── SAVED LISTINGS ────────────────────────────────

export async function saveListing(userId: string, listingId: string) {
  const { error } = await supabase.from('saved_listings').insert({ user_id: userId, listing_id: listingId });
  return { error };
}

export async function unsaveListing(userId: string, listingId: string) {
  const { error } = await supabase.from('saved_listings').delete().eq('user_id', userId).eq('listing_id', listingId);
  return { error };
}

export async function getSavedListings(userId: string) {
  const { data, error } = await supabase.from('saved_listings').select('listing_id').eq('user_id', userId);
  return { saved: data || [], savedIds: (data || []).map((r: any) => r.listing_id) as string[], error };
}

// ─── LISTING CREATION ──────────────────────────────

export async function createListing(listing: Omit<Listing, 'id' | 'listing_id' | 'created_at' | 'updated_at'>) {
  const { data, error } = await supabase.from('listings').insert({
    ...listing,
    listing_id: crypto.randomUUID(),
  }).select().maybeSingle();
  return { listing: data as Listing | null, error };
}

// ═══════════════════════════════════════════════════════════
// LISTING APPROVAL SYSTEM
// ═══════════════════════════════════════════════════════════

// Returns the minimum role rank required to approve a listing based on who posted it
export function getRequiredApproverRank(posterRole: string): number {
  switch (posterRole) {
    case 'staff': return ROLE_RANK.admin;        // needs Head of Staff+
    case 'admin': return ROLE_RANK.assistant_state_admin; // needs Asst Admin+
    case 'assistant_state_admin': return ROLE_RANK.state_admin; // needs Admin+
    case 'state_admin': return ROLE_RANK.director; // needs Director+
    case 'director': return ROLE_RANK.creator;    // needs Creator
    default: return ROLE_RANK.creator;
  }
}

// Returns human-readable approver label
export function getApproverLabel(posterRole: string): string {
  switch (posterRole) {
    case 'staff': return 'Head of Staff, Assistant Admin, Admin, or Creator';
    case 'admin': return 'Assistant Admin, Admin, or Creator';
    case 'assistant_state_admin': return 'Admin or Creator';
    case 'state_admin': return 'Director or Creator';
    case 'director': return 'Creator only';
    default: return 'Creator';
  }
}

// Check if a user with given role can approve a listing posted by someone with posterRole
export function canApproveListing(userRole: string, posterRole: string): boolean {
  return ROLE_RANK[userRole as keyof typeof ROLE_RANK] >= getRequiredApproverRank(posterRole);
}

// Get listings pending approval that this user can approve
export async function getListingsPendingApproval(userRole: string, _userId: string, scopeState?: string, scopeLga?: string) {
  // Build the query for listings with pending_approval status
  let query = supabase
    .from('listings')
    .select('*, profiles!owner_id(username, role)')
    .eq('status', 'pending_approval')
    .is('deleted_at', null);

  // Filter by scope if provided
  if (scopeState) query = query.eq('state', scopeState);
  if (scopeLga) query = query.eq('city', scopeLga);

  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) return { listings: [] as Listing[], error };

  // Filter to only show listings this user can approve
  const filtered = (data || []).filter((l: any) => {
    const posterRole = l.submitted_by_role || l.profiles?.role || 'staff';
    return canApproveListing(userRole, posterRole);
  });

  return { listings: filtered as Listing[], error: null };
}

// Approve a listing
export async function approveListing(listingId: string, approverId: string) {
  const { error } = await supabase
    .from('listings')
    .update({
      status: 'available',
      availability_status: 'available',
      approved_by: approverId,
      approved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', listingId);
  return { error };
}

// Reject a listing
export async function rejectListing(listingId: string, approverId: string, reason: string) {
  const { error } = await supabase
    .from('listings')
    .update({
      status: 'rejected',
      approved_by: approverId,
      approved_at: new Date().toISOString(),
      rejection_reason: reason,
      updated_at: new Date().toISOString(),
    })
    .eq('id', listingId);
  return { error };
}

// Get listings submitted by a user that are pending approval
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

// ─── LISTING STATUS ───────────────────────────────

export async function updateListingStatus(listingId: string, status: string, updates?: Record<string, any>) {
  const payload = { status, ...updates, updated_at: new Date().toISOString() };
  const { error } = await supabase.from('listings').update(payload).eq('listing_id', listingId);
  return { error };
}

// ─── ENQUIRIES ────────────────────────────────────

export async function createEnquiry(listingId: string, userId: string, message: string) {
  const { data, error } = await supabase.from('enquiries').insert({
    listing_id: listingId,
    user_id: userId,
    message,
    status: 'active',
  }).select();
  return { enquiry: data?.[0] || null, error };
}

export async function getEnquiriesForListing(listingId: string) {
  const { data, error } = await supabase
    .from('enquiries')
    .select('*')
    .eq('listing_id', listingId)
    .order('created_at', { ascending: false });
  return { enquiries: data as any[] | null, error };
}

export async function getEnquiriesForUser(userId: string) {
  const { data, error } = await supabase
    .from('enquiries')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  return { enquiries: data as any[] | null, error };
}

export async function replyToEnquiry(enquiryId: string, staffId: string, reply: string) {
  const { error } = await supabase.from('enquiries').update({
    reply,
    staff_id: staffId,
    status: 'replied',
    replied_at: new Date().toISOString(),
  }).eq('id', enquiryId);
  return { error };
}
