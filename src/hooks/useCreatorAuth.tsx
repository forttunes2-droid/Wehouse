import { createContext, useContext, useState, useCallback, useRef, type ReactNode } from 'react';
import { supabase } from '@/lib/supabase';

interface CreatorAuthContextType {
  requestAuth: (onSuccess?: () => void) => void;
  verifyPassword: (password: string) => Promise<boolean>;
  setPassword: (newPassword: string, oldPassword?: string) => Promise<boolean>;
  dismissRequest: () => void;
  clearAuth: () => void;
  showModal: boolean;
  isLoading: boolean;
  error: string;
}

const CreatorAuthContext = createContext<CreatorAuthContextType | null>(null);
const AUTH_SESSION_MS = 30 * 60 * 1000;

export function CreatorAuthProvider({ children }: { children: ReactNode }) {
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
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setError('Not logged in'); setIsLoading(false); return false; }

    // Pass Supabase UUID directly — SQL function does the lookup internally (SECURITY DEFINER)
    const { data, error: rpcErr } = await supabase.rpc('creator_auth_verify_v3', {
      p_auth_id: user.id,
      p_password: password,
    });

    if (rpcErr) { setError('Error: ' + rpcErr.message); setIsLoading(false); return false; }
    if (data === true) {
      expiryRef.current = Date.now() + AUTH_SESSION_MS;
      setIsLoading(false); setShowModal(false);
      const cb = pendingCallbackRef.current; pendingCallbackRef.current = null; cb?.();
      return true;
    }
    setError('Incorrect password'); setIsLoading(false); return false;
  }, []);

  const setPassword = useCallback(async (newPassword: string, oldPassword?: string): Promise<boolean> => {
    setIsLoading(true);
    setError('');
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setError('Not logged in'); setIsLoading(false); return false; }

    // If oldPassword provided, verify it first
    if (oldPassword) {
      const { data: verified } = await supabase.rpc('creator_auth_verify_v3', {
        p_auth_id: user.id,
        p_password: oldPassword,
      });
      if (!verified) { setError('Current password is incorrect'); setIsLoading(false); return false; }
    }

    // Pass Supabase UUID directly — SQL function finds creator internally
    const { data, error: rpcErr } = await supabase.rpc('creator_auth_set_v3', {
      p_auth_id: user.id,
      p_password: newPassword,
    });

    if (rpcErr) { setError('Failed: ' + rpcErr.message); setIsLoading(false); return false; }
    if (data === true) {
      expiryRef.current = Date.now() + AUTH_SESSION_MS;
      setIsLoading(false); setShowModal(false);
      const cb = pendingCallbackRef.current; pendingCallbackRef.current = null; cb?.();
      return true;
    }
    setError('Could not save password'); setIsLoading(false); return false;
  }, []);

  // Check if password is already set — for modal to know setup vs enter mode
  const checkHasPassword = useCallback(async (): Promise<boolean> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;
    const { data } = await supabase.rpc('creator_auth_status_v3', { p_auth_id: user.id });
    return data?.has_password === true;
  }, []);

  const dismissRequest = useCallback(() => {
    setShowModal(false);
    pendingCallbackRef.current = null;
    setError('');
  }, []);

  const clearAuth = useCallback(() => { expiryRef.current = 0; }, []);

  return (
    <CreatorAuthContext.Provider
      value={{ requestAuth, verifyPassword, setPassword, dismissRequest, clearAuth, showModal, isLoading, error }}
    >
      {children}
    </CreatorAuthContext.Provider>
  );
}

export function useCreatorAuth(): CreatorAuthContextType {
  const ctx = useContext(CreatorAuthContext);
  if (!ctx) throw new Error('useCreatorAuth must be used within CreatorAuthProvider');
  return ctx;
}
