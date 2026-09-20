import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { withTimeout } from '@/lib/withTimeout';
import { resolveWorkspace, workspaceStorageKey } from '@/lib/workspaceSession';
import type { WorkspaceAccess, WorkspaceChoice } from '@/pages/AccountCenter';

export function useWorkspaceAccess(userId?: string) {
  const [access, setAccess] = useState<WorkspaceAccess | null>(null);
  const [active, setActive] = useState<WorkspaceChoice>('personal');
  const [error, setError] = useState('');
  const generation = useRef(0);
  const reload = useCallback(async () => {
    const request = ++generation.current;
    setAccess(null);
    setError('');
    if (!userId) return;
    try {
      const result = await withTimeout(Promise.resolve(supabase.rpc('get_my_workspace_access')), 15000, 'Your workspaces could not be loaded. Please try again.');
      if (request !== generation.current) return;
      if (result.error || !result.data) throw new Error('Your workspaces could not be loaded. Please try again.');
      let preferred: string | null = null;
      try { preferred = localStorage.getItem(workspaceStorageKey(userId)); } catch { /* Storage can be disabled. */ }
      const workspace = resolveWorkspace(result.data as WorkspaceAccess, userId, preferred);
      if (!workspace) throw new Error('Your account access could not be confirmed. Please sign in again.');
      setActive(workspace);
      setAccess(result.data as WorkspaceAccess);
    } catch (cause) {
      if (request === generation.current) setError(cause instanceof Error ? cause.message : 'Your workspaces could not be loaded.');
    }
  }, [userId]);
  useEffect(() => {
    void reload();
    const refresh = () => void reload();
    window.addEventListener('wehouse:workspace-access-changed', refresh);
    return () => { generation.current += 1; window.removeEventListener('wehouse:workspace-access-changed', refresh); };
  }, [reload]);
  return { access, active, setActive, error, reload };
}
