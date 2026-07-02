import { useState, useEffect, useCallback } from 'react';
import { getStaffPermissions } from '@/lib/supabase';
import type { StaffPermission } from '@/types';

export function useStaffPermissions(staffId: string | undefined) {
  const [permissions, setPermissions] = useState<StaffPermission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<any>(null);

  const load = useCallback(async () => {
    if (!staffId) {
      setPermissions([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { permissions: perms, error: err } = await getStaffPermissions(staffId);
    setPermissions(perms);
    setError(err);
    setLoading(false);
  }, [staffId]);

  useEffect(() => {
    load();
  }, [load]);

  const check = useCallback(
    (perm: StaffPermission) => permissions.includes(perm),
    [permissions]
  );

  const checkAny = useCallback(
    (perms: StaffPermission[]) => perms.some(p => permissions.includes(p)),
    [permissions]
  );

  const checkAll = useCallback(
    (perms: StaffPermission[]) => perms.every(p => permissions.includes(p)),
    [permissions]
  );

  return {
    permissions,
    loading,
    error,
    refresh: load,
    hasPermission: check,
    hasAnyPermission: checkAny,
    hasAllPermissions: checkAll,
    isStaff: permissions.length > 0,
  };
}
