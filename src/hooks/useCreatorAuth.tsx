import { createContext, useContext, useState, useCallback, useRef, type ReactNode } from 'react';
import { supabase } from '@/lib/supabase';

interface CreatorAuthContextType {
  requestAuth: (onSuccess?: () => void) => void;
  verifyPassword: (password: string) => Promise<boolean>;
  verifyMfa: (code: string) => Promise<boolean>;
  dismissRequest: () => void;
  clearAuth: () => void;
  showModal: boolean;
  needsMfa: boolean;
  isLoading: boolean;
  error: string;
}

const CreatorAuthContext = createContext<CreatorAuthContextType | null>(null);
const AUTH_SESSION_MS = 10 * 60 * 1000;

export function CreatorAuthProvider({ children }: { children: ReactNode }) {
  const [showModal, setShowModal] = useState(false);
  const [needsMfa, setNeedsMfa] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const expiryRef = useRef(0);
  const pendingCallbackRef = useRef<(() => void) | null>(null);
  const pendingFactorRef = useRef<string | null>(null);

  const finish = useCallback(() => {
    expiryRef.current = Date.now() + AUTH_SESSION_MS;
    setShowModal(false);
    setNeedsMfa(false);
    setError('');
    pendingFactorRef.current = null;
    const callback = pendingCallbackRef.current;
    pendingCallbackRef.current = null;
    callback?.();
  }, []);

  const requestAuth = useCallback((onSuccess?: () => void) => {
    if (expiryRef.current > Date.now()) {
      onSuccess?.();
      return;
    }
    pendingCallbackRef.current = onSuccess || null;
    pendingFactorRef.current = null;
    setNeedsMfa(false);
    setError('');
    setShowModal(true);
  }, []);

  const verifyPassword = useCallback(async (password: string): Promise<boolean> => {
    setIsLoading(true);
    setError('');
    try {
      const { data: userResult } = await supabase.auth.getUser();
      const user = userResult.user;
      if (!user?.email) {
        setError('Your WeHouse session has expired. Sign in again.');
        return false;
      }
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('role,deleted,suspended,banned')
        .eq('auth_id', user.id)
        .maybeSingle();
      if (profileError || !profile || profile.role !== 'creator' || profile.deleted || profile.suspended || profile.banned) {
        setError('Active Creator access is required.');
        return false;
      }

      const { error: passwordError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password,
      });
      if (passwordError) {
        setError('Your WeHouse account password is incorrect.');
        return false;
      }

      const factorsResult = await supabase.auth.mfa.listFactors();
      const assuranceResult = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      const factors = factorsResult.data as any;
      const verifiedTotp = (factors?.totp || factors?.all || []).find(
        (factor: any) => factor?.factor_type === 'totp' && factor?.status === 'verified',
      );
      const currentLevel = (assuranceResult.data as any)?.currentLevel;
      if (verifiedTotp && currentLevel !== 'aal2') {
        pendingFactorRef.current = verifiedTotp.id;
        setNeedsMfa(true);
        return false;
      }

      finish();
      return true;
    } catch {
      setError('Creator confirmation could not be completed. Try again.');
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [finish]);

  const verifyMfa = useCallback(async (code: string): Promise<boolean> => {
    const factorId = pendingFactorRef.current;
    if (!factorId) {
      setNeedsMfa(false);
      setError('Confirm your account password again.');
      return false;
    }
    if (!/^\d{6}$/.test(code.trim())) {
      setError('Enter the 6-digit authenticator code.');
      return false;
    }
    setIsLoading(true);
    setError('');
    try {
      const { error: mfaError } = await supabase.auth.mfa.challengeAndVerify({
        factorId,
        code: code.trim(),
      });
      if (mfaError) {
        setError('That authenticator code could not be verified.');
        return false;
      }
      finish();
      return true;
    } catch {
      setError('Authenticator verification failed. Try again.');
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [finish]);

  const dismissRequest = useCallback(() => {
    setShowModal(false);
    setNeedsMfa(false);
    pendingFactorRef.current = null;
    pendingCallbackRef.current = null;
    setError('');
  }, []);

  const clearAuth = useCallback(() => {
    expiryRef.current = 0;
    pendingFactorRef.current = null;
    setNeedsMfa(false);
  }, []);

  return (
    <CreatorAuthContext.Provider
      value={{ requestAuth, verifyPassword, verifyMfa, dismissRequest, clearAuth, showModal, needsMfa, isLoading, error }}
    >
      {children}
    </CreatorAuthContext.Provider>
  );
}

export function useCreatorAuth(): CreatorAuthContextType {
  const context = useContext(CreatorAuthContext);
  if (!context) throw new Error('useCreatorAuth must be used within CreatorAuthProvider');
  return context;
}
