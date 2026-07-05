import { createContext, useContext, useState, useCallback, useRef, type ReactNode } from 'react';
import { supabase } from '@/lib/supabase';

interface CreatorAuthContextType {
  /** Open the auth modal. If already authenticated recently, calls onSuccess immediately. */
  requestAuth: (onSuccess?: () => void) => void;
  /** Directly verify a password (used by the modal). */
  verifyPassword: (password: string) => Promise<boolean>;
  /** Set/change the creator password. */
  setPassword: (newPassword: string, oldPassword?: string) => Promise<boolean>;
  /** Dismiss the modal without verifying. */
  dismissRequest: () => void;
  /** Clear auth session (e.g. on logout) */
  clearAuth: () => void;
  /** Exposed for the modal component */
  showModal: boolean;
  isLoading: boolean;
  error: string;
}

const CreatorAuthContext = createContext<CreatorAuthContextType | null>(null);

// Auth session lasts 30 minutes
const AUTH_SESSION_MS = 30 * 60 * 1000;

export function CreatorAuthProvider({ children }: { children: ReactNode }) {
  const [showModal, setShowModal] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const expiryRef = useRef<number>(0);
  const pendingCallbackRef = useRef<(() => void) | null>(null);

  /**
   * ALWAYS asks for password on every critical action.
   * No session caching — most secure for the user's needs.
   */
  const requestAuth = useCallback((onSuccess?: () => void) => {
    // Always show modal — never skip
    pendingCallbackRef.current = onSuccess || null;
    setShowModal(true);
    setError('');
  }, []);

  const verifyPassword = useCallback(async (password: string): Promise<boolean> => {
    setIsLoading(true);
    setError('');

    // Get current user_id
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData?.user?.id;
    if (!userId) {
      setError('Not logged in');
      setIsLoading(false);
      return false;
    }

    const { data, error: rpcError } = await supabase.rpc('verify_creator_auth', {
      p_user_id: userId,
      p_password: password,
    });

    if (rpcError) {
      setError('Verification failed');
      setIsLoading(false);
      return false;
    }

    if (data === true) {
      // Success: start 30-min session, close modal, run pending action
      expiryRef.current = Date.now() + AUTH_SESSION_MS;
      setError('');
      setIsLoading(false);
      setShowModal(false);

      // Run the pending action automatically
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

  const setPassword = useCallback(async (newPassword: string): Promise<boolean> => {
    setIsLoading(true);
    setError('');

    // Get current user_id
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData?.user?.id;
    if (!userId) {
      setError('Not logged in');
      setIsLoading(false);
      return false;
    }

    const { data, error: rpcError } = await supabase.rpc('set_creator_auth', {
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

      // Run pending action if there is one
      const cb = pendingCallbackRef.current;
      pendingCallbackRef.current = null;
      cb?.();
      return true;
    } else {
      setError('Password must be at least 4 characters');
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
