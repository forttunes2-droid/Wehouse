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

    const { data: userData } = await supabase.auth.getUser();
    const userId = userData?.user?.id;
    if (!userId) {
      setError('Not logged in');
      setIsLoading(false);
      return false;
    }

    const { data, error: rpcError } = await supabase.rpc('verify_admin_auth_v2', {
      p_user_id: userId,
      p_password: password,
    });

    if (rpcError) {
      setError('Verification error: ' + rpcError.message);
      setIsLoading(false);
      return false;
    }

    if (data === true) {
      expiryRef.current = Date.now() + AUTH_SESSION_MS;
      setError('');
      setIsLoading(false);
      setShowModal(false);

      const cb = pendingCallbackRef.current;
      pendingCallbackRef.current = null;
      cb?.();
      return true;
    } else {
      setError('Incorrect password');
      setIsLoading(false);
      return false;
    }
  }, []);

  const setPassword = useCallback(async (newPassword: string, oldPassword?: string): Promise<boolean> => {
    setIsLoading(true);
    setError('');

    const { data: userData } = await supabase.auth.getUser();
    const userId = userData?.user?.id;
    if (!userId) {
      setError('Not logged in');
      setIsLoading(false);
      return false;
    }

    if (oldPassword) {
      const { data: verified } = await supabase.rpc('verify_admin_auth_v2', {
        p_user_id: userId,
        p_password: oldPassword,
      });
      if (!verified) {
        setError('Current password is incorrect');
        setIsLoading(false);
        return false;
      }
    }

    const { data, error: rpcError } = await supabase.rpc('set_admin_auth_v2', {
      p_user_id: userId,
      p_password: newPassword,
    });

    if (rpcError) {
      setError('Failed to set password: ' + rpcError.message);
      setIsLoading(false);
      return false;
    }

    if (data === true) {
      expiryRef.current = Date.now() + AUTH_SESSION_MS;
      setError('');
      setIsLoading(false);
      setShowModal(false);

      const cb = pendingCallbackRef.current;
      pendingCallbackRef.current = null;
      cb?.();
      return true;
    } else {
      setError('Could not save password. Please try again.');
      setIsLoading(false);
      return false;
    }
  }, []);

  const dismissRequest = useCallback(() => {
    setShowModal(false);
    pendingCallbackRef.current = null;
    setError('');
  }, []);

  const clearAuth = useCallback(() => {
    expiryRef.current = 0;
  }, []);

  return (
    <AdminAuthContext.Provider
      value={{ requestAuth, verifyPassword, setPassword, dismissRequest, clearAuth, showModal, isLoading, error }}
    >
      {children}
    </AdminAuthContext.Provider>
  );
}

export function useAdminAuth(): AdminAuthContextType {
  const ctx = useContext(AdminAuthContext);
  if (!ctx) throw new Error('useAdminAuth must be used within AdminAuthProvider');
  return ctx;
}
