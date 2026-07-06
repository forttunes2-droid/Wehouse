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
  // Diagnostic info
  diag: { userId: string | null; functionExists: boolean | null };
}

const CreatorAuthContext = createContext<CreatorAuthContextType | null>(null);

const AUTH_SESSION_MS = 30 * 60 * 1000;

/**
 * Get the STABLE creator identifier (user_id / WHU-XXXXX).
 * NEVER uses the Supabase UUID directly because it can change between
 * devices, sessions, or if cookies are cleared.
 *
 * Strategy:
 * 1. Get current Supabase auth user
 * 2. Look up profile by auth_id → get stable user_id
 * 3. Fallback: look up by email + role='creator'
 * 4. Return the stable user_id (WHU-XXXXX)
 */
async function getStableCreatorId(): Promise<string | null> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    // Try matching by auth_id first (normal case)
    const { data: p1 } = await supabase
      .from('profiles')
      .select('user_id')
      .eq('auth_id', user.id)
      .maybeSingle();

    if (p1?.user_id) return p1.user_id;

    // Fallback: match by email + role='creator' (handles NULL auth_id)
    const { data: p2 } = await supabase
      .from('profiles')
      .select('user_id')
      .eq('email', user.email)
      .eq('role', 'creator')
      .maybeSingle();

    if (p2?.user_id) return p2.user_id;

    // Last resort: any profile with role='creator'
    const { data: p3 } = await supabase
      .from('profiles')
      .select('user_id')
      .eq('role', 'creator')
      .maybeSingle();

    return p3?.user_id || null;
  } catch {
    return null;
  }
}

export function CreatorAuthProvider({ children }: { children: ReactNode }) {
  const [showModal, setShowModal] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [diag, setDiag] = useState<{ userId: string | null; functionExists: boolean | null }>({ userId: null, functionExists: null });

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

    // Get STABLE user_id (WHU-XXXXX), not Supabase UUID
    const stableId = await getStableCreatorId();
    if (!stableId) {
      setError('Not logged in as creator');
      setIsLoading(false);
      return false;
    }
    setDiag(d => ({ ...d, userId: stableId }));

    // Try v2 function first, fallback to old function name
    let rpcError: any = null;
    let data: any = null;

    // Try v2
    const v2Result = await supabase.rpc('verify_creator_auth_v2', {
      p_user_id: stableId,
      p_password: password,
    });
    data = v2Result.data;
    rpcError = v2Result.error;

    // If v2 doesn't exist, try old name
    if (rpcError?.message?.includes('does not exist') || rpcError?.message?.includes('Could not find')) {
      const oldResult = await supabase.rpc('verify_creator_auth', {
        p_user_id: stableId,
        p_password: password,
      });
      data = oldResult.data;
      rpcError = oldResult.error;
      setDiag(d => ({ ...d, functionExists: !oldResult.error }));
    } else {
      setDiag(d => ({ ...d, functionExists: true }));
    }

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

    // Get STABLE user_id (WHU-XXXXX)
    const stableId = await getStableCreatorId();
    if (!stableId) {
      setError('Not logged in as creator');
      setIsLoading(false);
      return false;
    }
    setDiag(d => ({ ...d, userId: stableId }));

    // If oldPassword provided (change mode), verify it first
    if (oldPassword) {
      const { data: verified, error: verifyErr } = await supabase.rpc('verify_creator_auth_v2', {
        p_user_id: stableId,
        p_password: oldPassword,
      });
      // Fallback to old function name
      if (verifyErr?.message?.includes('does not exist')) {
        const oldResult = await supabase.rpc('verify_creator_auth', {
          p_user_id: stableId,
          p_password: oldPassword,
        });
        if (!oldResult.data) {
          setError('Current password is incorrect');
          setIsLoading(false);
          return false;
        }
      } else if (!verified) {
        setError('Current password is incorrect');
        setIsLoading(false);
        return false;
      }
    }

    // Try v2 first, fallback to old
    let rpcError: any = null;
    let data: any = null;

    const v2Result = await supabase.rpc('set_creator_auth_v2', {
      p_user_id: stableId,
      p_password: newPassword,
    });
    data = v2Result.data;
    rpcError = v2Result.error;

    if (rpcError?.message?.includes('does not exist') || rpcError?.message?.includes('Could not find')) {
      const oldResult = await supabase.rpc('set_creator_auth', {
        p_user_id: stableId,
        p_password: newPassword,
      });
      data = oldResult.data;
      rpcError = oldResult.error;
    }

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
    <CreatorAuthContext.Provider
      value={{ requestAuth, verifyPassword, setPassword, dismissRequest, clearAuth, showModal, isLoading, error, diag }}
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
