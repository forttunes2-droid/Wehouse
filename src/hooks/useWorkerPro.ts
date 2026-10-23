import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { withTimeout } from '@/lib/withTimeout';
import type { WorkerProEntitlement } from '@/types';

export function useWorkerPro(workerId?: string) {
  const [pro, setPro] = useState<WorkerProEntitlement | null>(null);
  const [loading, setLoading] = useState(Boolean(workerId));
  const [error, setError] = useState('');
  const requestVersion = useRef(0);
  const [resolvedFor, setResolvedFor] = useState<string | undefined>(undefined);

  const load = useCallback(async (showLoading: boolean) => {
    const request = ++requestVersion.current;
    if (!workerId) {
      setPro(null);
      setLoading(false);
      setError('');
      setResolvedFor(undefined);
      return null;
    }
    if (showLoading) setLoading(true);
    try {
      const result = await withTimeout(supabase.rpc('get_my_worker_pro'), 10000, 'Worker tools took too long to load');
      if (request !== requestVersion.current) return null;
      if (result.error || !result.data || typeof result.data.active !== 'boolean') throw new Error('Worker tools could not be loaded. Please try again.');
      setError('');
      const entitlement = result.data as WorkerProEntitlement;
      setPro(entitlement);
      return entitlement;
    } catch {
      if (request === requestVersion.current) { setError('Worker tools could not be loaded. Please try again.'); setPro(null); }
      return null;
    } finally {
      if (request === requestVersion.current) { setLoading(false); setResolvedFor(workerId); }
    }
  }, [workerId]);

  const refresh = useCallback(async () => {
    await load(true);
  }, [load]);

  useEffect(() => {
    void refresh();
    return () => { ++requestVersion.current; };
  }, [refresh]);

  useEffect(() => {
    if (!workerId) return;
    let reference = '';
    try { reference = localStorage.getItem('wh_worker_pro_payment_ref') || ''; } catch {}
    if (!reference) return;
    let cancelled = false;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      attempts += 1;
      const entitlement = await load(false);
      if (cancelled) return;
      if (entitlement?.active) {
        try { localStorage.removeItem('wh_worker_pro_payment_ref'); } catch {}
        window.dispatchEvent(new CustomEvent('wehouse:worker-pro-activated', {
          detail: { workerId, reference },
        }));
        return;
      }
      if (attempts < 15) timer = setTimeout(() => void poll(), 2000);
    };
    timer = setTimeout(() => void poll(), 1500);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [load, workerId]);

  return { pro: resolvedFor === workerId ? pro : null,
    loading: loading || Boolean(workerId && resolvedFor !== workerId),
    error: resolvedFor === workerId ? error : '', refresh };
}
