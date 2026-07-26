// ═══════════════════════════════════════════════════════════
// Staff Analytics — Branch/Module Scoped
// Uses server-side staff_branch_analytics RPC.
// ═══════════════════════════════════════════════════════════

import { supabase } from './client';

export async function getStaffBranchAnalytics(staffUserId: string) {
  const { data, error } = await supabase.rpc('staff_branch_analytics', {
    p_staff_user_id: staffUserId,
  });
  return { metrics: data as Array<{ metric: string; value: number }> | null, error };
}

// Helper: convert metrics array to keyed object
export function parseStaffMetrics(metrics: Array<{ metric: string; value: number }> | null) {
  const result: Record<string, number> = {};
  if (!metrics) return result;
  for (const m of metrics) {
    result[m.metric] = m.value;
  }
  return result;
}
