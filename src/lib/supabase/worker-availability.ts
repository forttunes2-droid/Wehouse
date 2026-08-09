import { supabase } from './client';

// Canonical worker self-service availability mutation.
// Identity is derived server-side from auth.uid(); callers cannot choose a worker id.
export async function setWorkerAvailability(_workerId: string, isAvailable: boolean) {
  const { error } = await supabase.rpc('set_my_worker_availability', {
    p_is_available: isAvailable,
  });

  return { error };
}
