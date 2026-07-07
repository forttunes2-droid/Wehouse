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
const STORAGE_KEY = 'wh_creator_pw_hash';

// Simple hash function — NOT for high security, just creator action protection
function simpleHash(str: string): string {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return String(h === 0 ? 1 : Math.abs(h)); // never return 0 hash
}

// Check if a password hash exists in localStorage
function hasStoredPassword(): boolean {
  try {
    return !!localStorage.getItem(STORAGE_KEY);
  } catch { return false; }
}

// Verify password against stored hash
function verifyStoredPassword(password: string): boolean {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return false;
    return stored === simpleHash(password);
  } catch { return false; }
}

// Store password hash
function storePasswordHash(password: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, simpleHash(password));
  } catch { /* silently fail */ }
}

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

    // APP-FIRST: Check localStorage password (set in-app)
    if (hasStoredPassword()) {
      if (verifyStoredPassword(password)) {
        expiryRef.current = Date.now() + AUTH_SESSION_MS;
        setIsLoading(false); setShowModal(false);
        const cb = pendingCallbackRef.current; pendingCallbackRef.current = null; cb?.();
        return true;
      }
      setError('Incorrect password'); setIsLoading(false); return false;
    }

    // FALLBACK: Try SQL function for legacy passwords
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setError('Not logged in'); setIsLoading(false); return false; }

    try {
      const { data, error: rpcErr } = await supabase.rpc('creator_auth_verify_v3', {
        p_auth_id: user.id,
        p_password: password,
      });
      if (!rpcErr && data === true) {
        expiryRef.current = Date.now() + AUTH_SESSION_MS;
        setIsLoading(false); setShowModal(false);
        const cb = pendingCallbackRef.current; pendingCallbackRef.current = null; cb?.();
        return true;
      }
    } catch {
      // SQL function may not exist
    }

    setError('Incorrect password'); setIsLoading(false); return false;
  }, []);

  const setPassword = useCallback(async (newPassword: string, oldPassword?: string): Promise<boolean> => {
    setIsLoading(true);
    setError('');

    // If a password already exists, verify old password first
    if (hasStoredPassword() && oldPassword) {
      if (!verifyStoredPassword(oldPassword)) {
        setError('Current password is incorrect'); setIsLoading(false); return false;
      }
    }

    // Also try SQL fallback for legacy
    if (!hasStoredPassword() && oldPassword) {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        try {
          const { data: verified } = await supabase.rpc('creator_auth_verify_v3', {
            p_auth_id: user.id,
            p_password: oldPassword,
          });
          if (!verified) { setError('Current password is incorrect'); setIsLoading(false); return false; }
        } catch {
          // SQL may not exist
        }
      }
    }

    // Store new password in localStorage (APP-FIRST approach)
    storePasswordHash(newPassword);

    // Also try to store via SQL for backup
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase.rpc('creator_auth_set_v3', {
          p_auth_id: user.id,
          p_password: newPassword,
        });
      }
    } catch {
      // SQL may fail, localStorage is primary
    }

    expiryRef.current = Date.now() + AUTH_SESSION_MS;
    setIsLoading(false); setShowModal(false);
    const cb = pendingCallbackRef.current; pendingCallbackRef.current = null; cb?.();
    return true;
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
