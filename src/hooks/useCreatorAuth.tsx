import { createContext, useContext, useState, useCallback, useRef, type ReactNode } from 'react';
import { supabase } from '@/lib/supabase';

// ─── Types ──────────────────────────────────────────

interface CreatorAuthState {
  isAuthorized: boolean;
  isLoading: boolean;
  error: string;
  timeRemaining: number; // seconds until expiry
}

interface CreatorAuthContextType extends CreatorAuthState {
  requestAuth: (onSuccess?: () => void) => void;
  verifyPassword: (password: string) => Promise<boolean>;
  setPassword: (newPassword: string, oldPassword?: string) => Promise<boolean>;
  disableAuth: (password: string) => Promise<boolean>;
  clearAuth: () => void;
  dismissRequest: () => void;
  isAuthEnabled: () => Promise<boolean>;
  // Modal state
  showModal: boolean;
  pendingCallback: (() => void) | null;
}

const CreatorAuthContext = createContext<CreatorAuthContextType | null>(null);

// Auth session lasts 10 minutes
const AUTH_SESSION_MS = 10 * 60 * 1000;

// ─── Provider ───────────────────────────────────────

export function CreatorAuthProvider({ children }: { children: ReactNode }) {
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [showModal, setShowModal] = useState(false);
  const [pendingCallback, setPendingCallback] = useState<(() => void) | null>(null);

  const expiryRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Start/restart the countdown timer
  const startTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    expiryRef.current = Date.now() + AUTH_SESSION_MS;

    const update = () => {
      const remaining = Math.max(0, Math.floor((expiryRef.current - Date.now()) / 1000));
      setTimeRemaining(remaining);
      if (remaining <= 0) {
        setIsAuthorized(false);
        if (timerRef.current) clearInterval(timerRef.current);
      }
    };
    update();
    timerRef.current = setInterval(update, 1000);
  }, []);

  // Check if auth is enabled on the server
  const isAuthEnabled = useCallback(async (): Promise<boolean> => {
    const { data, error } = await supabase
      .from('platform_settings')
      .select('value')
      .eq('key', 'creator_auth_enabled')
      .maybeSingle();
    if (error || !data) return false;
    return data.value === 'true';
  }, []);

  // Verify password via RPC
  const verifyPassword = useCallback(async (password: string): Promise<boolean> => {
    setIsLoading(true);
    setError('');

    try {
      const { data, error: rpcError } = await supabase.rpc('verify_creator_auth', {
        p_password: password,
      });

      if (rpcError) {
        setError('Verification failed: ' + rpcError.message);
        setIsLoading(false);
        return false;
      }

      if (data === true) {
        setIsAuthorized(true);
        setError('');
        startTimer();
        setIsLoading(false);
        return true;
      } else {
        setError('Incorrect password');
        setIsLoading(false);
        return false;
      }
    } catch (e: any) {
      setError(e?.message || 'Verification error');
      setIsLoading(false);
      return false;
    }
  }, [startTimer]);

  // Set a new auth password (first time or change)
  const setPassword = useCallback(async (newPassword: string, oldPassword?: string): Promise<boolean> => {
    setIsLoading(true);
    setError('');

    try {
      const { data, error: rpcError } = await supabase.rpc('set_creator_auth', {
        p_new_password: newPassword,
        p_old_password: oldPassword || null,
      });

      if (rpcError) {
        setError('Failed: ' + rpcError.message);
        setIsLoading(false);
        return false;
      }

      if (data === true) {
        setIsAuthorized(true);
        setError('');
        startTimer();
        setIsLoading(false);
        return true;
      } else {
        setError(oldPassword ? 'Old password is incorrect' : 'Password must be at least 6 characters');
        setIsLoading(false);
        return false;
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to set password');
      setIsLoading(false);
      return false;
    }
  }, [startTimer]);

  // Disable auth
  const disableAuth = useCallback(async (password: string): Promise<boolean> => {
    setIsLoading(true);
    setError('');

    try {
      const { data, error: rpcError } = await supabase.rpc('disable_creator_auth', {
        p_password: password,
      });

      if (rpcError) {
        setError('Failed: ' + rpcError.message);
        setIsLoading(false);
        return false;
      }

      if (data === true) {
        setIsAuthorized(false);
        setError('');
        if (timerRef.current) clearInterval(timerRef.current);
        setIsLoading(false);
        return true;
      } else {
        setError('Incorrect password');
        setIsLoading(false);
        return false;
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to disable');
      setIsLoading(false);
      return false;
    }
  }, []);

  // Request auth for a critical action
  const requestAuth = useCallback((onSuccess?: () => void) => {
    // If already authorized and not expired, proceed immediately
    if (isAuthorized && Date.now() < expiryRef.current) {
      onSuccess?.();
      return;
    }
    // Otherwise show the modal
    setPendingCallback(() => onSuccess || null);
    setShowModal(true);
    setError('');
  }, [isAuthorized]);

  // Dismiss the modal without verifying
  const dismissRequest = useCallback(() => {
    setShowModal(false);
    setPendingCallback(null);
    setError('');
  }, []);

  // Clear auth (e.g., on logout)
  const clearAuth = useCallback(() => {
    setIsAuthorized(false);
    setError('');
    if (timerRef.current) clearInterval(timerRef.current);
    expiryRef.current = 0;
  }, []);

  return (
    <CreatorAuthContext.Provider
      value={{
        isAuthorized,
        isLoading,
        error,
        timeRemaining,
        requestAuth,
        verifyPassword,
        setPassword,
        disableAuth,
        clearAuth,
        dismissRequest,
        isAuthEnabled,
        showModal,
        pendingCallback: pendingCallback,
      }}
    >
      {children}
    </CreatorAuthContext.Provider>
  );
}

// ─── Hook ───────────────────────────────────────────

export function useCreatorAuth(): CreatorAuthContextType {
  const ctx = useContext(CreatorAuthContext);
  if (!ctx) throw new Error('useCreatorAuth must be used within CreatorAuthProvider');
  return ctx;
}
