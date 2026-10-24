import { supabase } from './client';
import type { Profile } from '@/types';

export async function getMySavedServiceProviderIds() {
  const { data, error } = await supabase.rpc('get_my_saved_service_provider_ids');
  return {
    workerIds: (data || []).map((row: { worker_id: string }) => String(row.worker_id)).filter(Boolean),
    error,
  };
}

export async function getSavedServiceProviders(workerIds: string[]) {
  if (!workerIds.length) return { workers: [] as Profile[], error: null };
  const { data, error } = await supabase.rpc('get_public_saved_service_providers', {
    p_worker_ids: workerIds,
  });
  const workers = (data || []).map((row: any) => ({
    ...row, role: 'worker', profile_complete: true, worker_status: 'verified',
    worker_verified: true, available: true, deleted: false, suspended: false, banned: false,
  })) as Profile[];
  return { workers, error };
}

export async function saveServiceProvider(workerId: string) {
  const { error } = await supabase.rpc('save_my_service_provider', { p_worker_id: workerId });
  return { error };
}

export async function unsaveServiceProvider(workerId: string) {
  const { error } = await supabase.rpc('unsave_my_service_provider', { p_worker_id: workerId });
  return { error };
}
