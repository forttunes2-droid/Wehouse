import { supabase } from './client';
import type { Profile } from '@/types';

// ─── WORKER HELPERS ────────────────────────────────

export async function getWorkers(filters?: { city?: string; occupation?: string; status?: string }) {
  let query = supabase.from('profiles').select('*').eq('role', 'worker');
  if (filters?.city) query = query.eq('city', filters.city);
  if (filters?.occupation) query = query.eq('worker_occupation', filters.occupation);
  if (filters?.status) query = query.eq('worker_status', filters.status);
  // No status filter = show all workers (pending + verified + suspended)
  const { data, error } = await query.order('created_at', { ascending: false });
  return { workers: data as Profile[] | null, error };
}

// Parse worker status from profile — checks bio marker FIRST (source of truth), falls back to column
export function parseWorkerStatus(profile: Profile): string {
  // Bio marker is the source of truth — we always write here
  const match = profile.bio?.match(/🛠️STATUS:(\w+)🛠️/);
  if (match) return match[1];
  // Fallback to column (for pre-existing data)
  if (profile.worker_status) return profile.worker_status;
  return 'pending';
}

export async function getAllWorkers() {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('role', 'worker')
    .order('created_at', { ascending: false });
  return { workers: data as Profile[] | null, error };
}

export async function getPendingWorkers() {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('role', 'worker')
    .eq('worker_status', 'pending')
    .order('created_at', { ascending: false });
  return { workers: data as Profile[] | null, error };
}

export async function updateWorkerStatus(userId: string, status: 'pending' | 'verified' | 'suspended' | 'rejected') {
  // Strategy: Update bio marker (always works) + try column (best effort)
  // Bio marker is the SOURCE OF TRUTH — parseWorkerStatus reads it first

  // 1. Read current bio
  const { data: row } = await supabase
    .from('profiles')
    .select('bio')
    .eq('user_id', userId)
    .maybeSingle();

  const bio = row?.bio || '';
  const cleanBio = bio.replace(/🛠️STATUS:\w+🛠️/g, '').trim();
  const newBio = `🛠️STATUS:${status}🛠️ ${cleanBio}`.trim();

  // 2. Update bio (this column always exists) — this is the PRIMARY write
  const { data: updated, error } = await supabase
    .from('profiles')
    .update({ bio: newBio })
    .eq('user_id', userId)
    .select();

  // Verify rows were actually updated
  if (!error && (!updated || updated.length === 0)) {
    return { error: { message: `Update succeeded but 0 rows changed for user ${userId}` } as any };
  }

  // 3. Also update the proper columns (best effort, may fail if columns don't exist)
  if (!error) {
    try {
      await supabase
        .from('profiles')
        .update({ worker_status: status, worker_verified: status === 'verified', updated_at: new Date().toISOString() })
        .eq('user_id', userId);
    } catch { /* columns may not exist, bio is the source of truth */ }
  }

  return { error };
}
