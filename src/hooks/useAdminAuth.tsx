import { createContext, useContext, useState, useCallback, useRef, type ReactNode } from 'react';
import { supabase } from '@/lib/supabase';

interface AdminAuthContextType {
  requestAuth: (onSuccess?: () => void) => void;
  verifyPassword: (password: string) => Promise<boolean>;
  setPassword: (newPassword: string, oldPassword?: string) => Promise<boolean>;
  dismissRequest: () => void;
  clearAuth: () => void;
  showModal: boolean;
  isLoading: boolean;
  error: string;
}

const AdminAuthContext = createContext<AdminAuthContextType | null>(null);
const AUTH_SESSION_MS = 30 * 60 * 1000;

async function getStableAdminId(): Promise<string | null> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const { data: p1 } = await supabase.from('profiles').select('user_id').eq('auth_id', user.id).maybeSingle();
    if (p1?.user_id) return p1.user_id;
    const { data: p2 } = await supabase.from('profiles').select('user_id').eq('email', user.email).in('role', ['admin', 'staff', 'director']).maybeSingle();
    if (p2?.user_id) return p2.user_id;
    const { data: p3 } = await supabase.from('profiles').select('user_id').in('role', ['admin', 'staff', 'director']).maybeSingle();
    return p3?.user_id || null;
  } catch { return null; }
}

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [showModal, setShowModal] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const expiryRef = useRef<number>(0);
  const pendingCallbackRef = useRef<(() => void) | null>(null);

  const requestAuth = useCallback((onSuccess?: () => void) => {
    pendingCallbackRef.current = onSuccess || null;
    setShowModal(true);
    setError('');
  }, []);

  const verifyPassword = useCallback(async (password: string): Promise<boolean> => {
    setIsLoading(true);
    setError('');

    const stableId = await getStableAdminId();
    if (!stableId) { setError('Not logged in'); setIsLoading(false); return false; }

    let data: any = null;
    const v2 = await supabase.rpc('verify_admin_auth_v2', { p_user_id: stableId, p_password: password });
    data = v2.data;
    if (v2.error?.message?.includes('does not exist')) {
      const old = await supabase.rpc('verify_admin_auth', { p_user_id: stableId, p_password: password });
      data = old.data;
    }

    if (v2.error && !v2.error.message?.includes('does not exist')) {
      setError('Verification error: ' + v2.error.message); setIsLoading(false); return false;
    }

    if (data === true) {
      expiryRef.current = Date.now() + AUTH_SESSION_MS;
      setError(''); setIsLoading(false); setShowModal(false);
      const cb = pendingCallbackRef.current; pendingCallbackRef.current = null; cb?.();
      return true;
    } else {
      setError('Incorrect password'); setIsLoading(false); return false;
    }
  }, []);

  const setPassword = useCallback(async (newPassword: string, oldPassword?: string): Promise<boolean> => {
    setIsLoading(true); setError('');

    const stableId = await getStableAdminId();
    if (!stableId) { setError('Not logged in'); setIsLoading(false); return false; }

    if (oldPassword) {
      const v2v = await supabase.rpc('verify_admin_auth_v2', { p_user_id: stableId, p_password: oldPassword });
      let verified = v2v.data;
      if (v2v.error?.message?.includes('does not exist')) {
        const oldv = await supabase.rpc('verify_admin_auth', { p_user_id: stableId, p_password: oldPassword });
        verified = oldv.data;
      }
      if (!verified) { setError('Current password is incorrect'); setIsLoading(false); return false; }
    }

    let data: any = null;
    const v2 = await supabase.rpc('set_admin_auth_v2', { p_user_id: stableId, p_password: newPassword });
    data = v2.data;
    if (v2.error?.message?.includes('does not exist')) {
      const old = await supabase.rpc('set_admin_auth', { p_user_id: stableId, p_password: newPassword });
      data = old.data;
    }

    if (v2.error && !v2.error.message?.includes('does not exist')) {
      setError('Failed: ' + v2.error.message); setIsLoading(false); return false;
    }

    if (data === true) {
      expiryRef.current = Date.now() + AUTH_SESSION_MS;
      setError(''); setIsLoading(false); setShowModal(false);
      const cb = pendingCallbackRef.current; pendingCallbackRef.current = null; cb?.();
      return true;
    } else { setError('Could not save password'); setIsLoading(false); return false; }
  }, []);

  const dismissRequest = useCallback(() => { setShowModal(false); pendingCallbackRef.current = null; setError(''); }, []);
  const clearAuth = useCallback(() => { expiryRef.current = 0; }, []);

  return (
    <AdminAuthContext.Provider value={{ requestAuth, verifyPassword, setPassword, dismissRequest, clearAuth, showModal, isLoading, error }}>
      {children}
    </AdminAuthContext.Provider>
  );
}

export function useAdminAuth(): AdminAuthContextType {
  const ctx = useContext(AdminAuthContext);
  if (!ctx) throw new Error('useAdminAuth must be used within AdminAuthProvider');
  return ctx;
}
