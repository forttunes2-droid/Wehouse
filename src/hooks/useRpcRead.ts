import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { withTimeout } from '@/lib/withTimeout';

// Read-only requests may time out safely. Never use this for mutations.
export function useRpcRead<T>(name: string, identity: string, args?: Record<string, unknown>) {
  const argumentsKey = JSON.stringify(args || {});
  const key = `${identity}:${name}:${argumentsKey}`;
  const generation = useRef(0);
  const [state, setState] = useState<{ key: string; data: T | null; loading: boolean; error: string }>({ key, data: null, loading: true, error: '' });
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    setState({ key, data: null, loading: true, error: '' });
    try {
      const result = await withTimeout(supabase.rpc(name, JSON.parse(argumentsKey)), 15000, 'This is taking too long. Check your connection and try again.');
      if (result.error || result.data == null) throw result.error || new Error('The requested information is unavailable.');
      if (request === generation.current) setState({ key, data: result.data as T, loading: false, error: '' });
    } catch (cause) {
      const error = cause instanceof Error ? cause.message : (cause as { message?: string })?.message || 'Could not load this information. Please try again.';
      if (request === generation.current) setState({ key, data: null, loading: false, error });
    }
  }, [key, name, argumentsKey]);
  useEffect(() => { void refresh(); return () => { generation.current++; }; }, [refresh]);
  return { ...(state.key === key ? state : { data: null, loading: true, error: '' }), refresh };
}
