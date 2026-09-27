import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { WorkerProEntitlement } from '@/types';

export function useWorkerPro(workerId?: string) {
  const [pro, setPro] = useState<WorkerProEntitlement | null>(null);
  const [loading, setLoading] = useState(Boolean(workerId));
  const [error, setError] = useState('');

  const load = useCallback(async (showLoading: boolean) => {
    if (!workerId) {
      setPro(null);
      setLoading(false);
      return null;
    }
    if (showLoading) setLoading(true);
    const result = await supabase.rpc('get_my_worker_pro');
    if (showLoading) setLoading(false);
    if (result.error) {
      setError(result.error.message);
      setPro(null);
      return null;
    }
    setError('');
    const entitlement = result.data as WorkerProEntitlement;
    setPro(entitlement);
    return entitlement;
  }, [workerId]);

  const refresh = useCallback(async () => {
    await load(true);
  }, [load]);

  useEffect(() => {
    void refresh();
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

  return { pro, loading, error, refresh };
}
