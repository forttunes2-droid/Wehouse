import { supabase } from './client';
import type { Profile } from '@/types';

// Public worker discovery must use the backend projection instead of reading
// arbitrary profile rows. The RPC exposes only the fields intended for the
// worker marketplace and applies verified + available account rules server-side.
export async function getWorkers(filters?: { city?: string; occupation?: string; status?: string }) {
  const { data, error } = await supabase.rpc('get_public_workers', {
    p_state: null,
    p_city: filters?.city || null,
    p_occupation: filters?.occupation || null,
  });

  const workers = (data || []).map((row: any) => ({
    ...row,
    role: 'worker',
    profile_complete: true,
    worker_status: 'verified',
    worker_verified: true,
    available: true,
    deleted: false,
    suspended: false,
    banned: false,
  })) as Profile[];

  return { workers, error };
}

// A worker may only change their own availability. The backend derives the
// worker identity from auth.uid() and rejects unavailable/unverified accounts.
export async function setWorkerAvailability(_workerId: string, isAvailable: boolean) {
  const { error } = await supabase.rpc('set_my_worker_availability', {
    p_is_available: isAvailable,
  });
  if (error) return { profile: null as Profile | null, error };

  const { data, error: profileError } = await supabase
    .from('profiles')
    .select('*')
    .eq('auth_id', (await supabase.auth.getUser()).data.user?.id || '')
    .maybeSingle();

  return { profile: (data || null) as Profile | null, error: profileError };
}
