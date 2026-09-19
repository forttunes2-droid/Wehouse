import { useState, useEffect, useCallback, useRef } from 'react';
import { getStaffPermissions } from '@/lib/supabase';
import type { StaffPermission } from '@/types';

type PermissionState = { staffId?: string; permissions: StaffPermission[]; loading: boolean; error: unknown };
export function useStaffPermissions(staffId: string | undefined) {
  const [state, setState] = useState<PermissionState>({ permissions: [], loading: true, error: null });
  const generation = useRef(0);
  const load = useCallback(async () => {
    const request = ++generation.current;
    setState({ staffId, permissions: [], loading: Boolean(staffId), error: null });
    if (!staffId) return;
    try {
      const result = await getStaffPermissions(staffId);
      if (result.error) throw result.error;
      if (request === generation.current)
        setState({ staffId, permissions: result.permissions, loading: false, error: null });
    } catch (error) {
      if (request === generation.current)
        setState({ staffId, permissions: [], loading: false, error });
    }
  }, [staffId]);
  useEffect(() => {
    void load();
    return () => { generation.current++; };
  }, [load]);
  // Never show the previous person's permissions during an identity change.
  const current = state.staffId === staffId;
  const permissions = current ? state.permissions : [];
  return {
    permissions,
    loading: current ? state.loading : true,
    error: current ? state.error : null,
    refresh: load,
    hasPermission: (permission: StaffPermission) => permissions.includes(permission),
    hasAnyPermission: (values: StaffPermission[]) => values.some(value => permissions.includes(value)),
    hasAllPermissions: (values: StaffPermission[]) => values.every(value => permissions.includes(value)),
    isStaff: permissions.length > 0,
  };
}
