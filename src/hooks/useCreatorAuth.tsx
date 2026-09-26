import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { supabase } from '@/lib/supabase';

export type CreatorActionClass =
  | 'all_sensitive'
  | 'policy_publish'
  | 'staff_authority'
  | 'finance_exception'
  | 'private_evidence'
  | 'clean_launch_reset';

type ElevationCallback = (creatorElevationId: string) => void;

interface CreatorAuthContextType {
  /** Backward-compatible sensitive-action confirmation. */
  requestAuth: (onSuccess?: () => void) => void;
  /** Request a server-backed elevation grant for one sensitive action class. */
  requestElevation: (
    actionClass: CreatorActionClass,
    onSuccess: ElevationCallback,
  ) => void;
  verifySecret: (creatorSecret: string) => Promise<boolean>;
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

type CachedElevation = {
  id: string;
  actionClass: CreatorActionClass;
  expiresAt: number;
};

type StepUpResponse = {
  success?: boolean;
  needs_mfa?: boolean;
  creator_elevation_id?: string;
  expires_in_seconds?: number;
  error?: string;
};

export function CreatorAuthProvider({ children }: { children: ReactNode }) {
  const [showModal, setShowModal] = useState(false);
  const [needsMfa, setNeedsMfa] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const pendingCallbackRef = useRef<ElevationCallback | null>(null);
  const pendingActionRef = useRef<CreatorActionClass>('all_sensitive');
  const pendingSecretRef = useRef('');
  const cachedElevationRef = useRef<CachedElevation | null>(null);

  const finish = useCallback(
    (
      creatorElevationId: string,
      actionClass: CreatorActionClass,
      expiresInSeconds = 600,
    ) => {
      const ttl = Math.min(AUTH_SESSION_MS, Math.max(1, expiresInSeconds) * 1000);
      cachedElevationRef.current = {
        id: creatorElevationId,
        actionClass,
        expiresAt: Date.now() + ttl,
      };
      setShowModal(false);
      setNeedsMfa(false);
      setError('');
      pendingSecretRef.current = '';
      const callback = pendingCallbackRef.current;
      pendingCallbackRef.current = null;
      callback?.(creatorElevationId);
    },
    [],
  );

  const cachedFor = useCallback((actionClass: CreatorActionClass) => {
    const cached = cachedElevationRef.current;
    if (!cached || cached.expiresAt <= Date.now()) {
      cachedElevationRef.current = null;
      return null;
    }
    if (
      cached.actionClass === actionClass ||
      cached.actionClass === 'all_sensitive'
    ) {
      return cached.id;
    }
    return null;
  }, []);

  const requestElevation = useCallback(
    (actionClass: CreatorActionClass, onSuccess: ElevationCallback) => {
      const existing = cachedFor(actionClass);
      if (existing) {
        onSuccess(existing);
        return;
      }
      pendingActionRef.current = actionClass;
      pendingCallbackRef.current = onSuccess;
      pendingSecretRef.current = '';
      setNeedsMfa(false);
      setError('');
      setShowModal(true);
    },
    [cachedFor],
  );

  const requestAuth = useCallback(
    (onSuccess?: () => void) => {
      requestElevation('all_sensitive', () => onSuccess?.());
    },
    [requestElevation],
  );

  const invokeStepUp = useCallback(
    async (creatorSecret: string, otpCode = ''): Promise<boolean> => {
      const actionClass = pendingActionRef.current;
      const { data, error: invokeError } = await supabase.functions.invoke(
        'creator-step-up',
        {
          body: {
            creator_secret: creatorSecret,
            otp_code: otpCode,
            action_class: actionClass,
          },
        },
      );
      const result = (data || {}) as StepUpResponse;
      if (invokeError) {
        setError(invokeError.message || 'Creator confirmation could not be completed.');
        return false;
      }
      if (result.needs_mfa) {
        pendingSecretRef.current = creatorSecret;
        setNeedsMfa(true);
        setError('');
        return false;
      }
      if (!result.success || !result.creator_elevation_id) {
        setError(result.error || 'Creator confirmation failed.');
        return false;
      }
      finish(
        result.creator_elevation_id,
        actionClass,
        Number(result.expires_in_seconds || 600),
      );
      return true;
    },
    [finish],
  );

  const verifySecret = useCallback(
    async (creatorSecret: string): Promise<boolean> => {
      if (!creatorSecret) return false;
      setIsLoading(true);
      setError('');
      try {
        pendingSecretRef.current = creatorSecret;
        return await invokeStepUp(creatorSecret);
      } catch {
        setError('Creator confirmation could not be completed. Try again.');
        return false;
      } finally {
        setIsLoading(false);
      }
    },
    [invokeStepUp],
  );

  const verifyMfa = useCallback(
    async (code: string): Promise<boolean> => {
      const creatorSecret = pendingSecretRef.current;
      if (!creatorSecret) {
        setNeedsMfa(false);
        setError('Confirm your Creator security password again.');
        return false;
      }
      if (!/^\d{6}$/.test(code.trim())) {
        setError('Enter the 6-digit authenticator code.');
        return false;
      }
      setIsLoading(true);
      setError('');
      try {
        const factors = await supabase.auth.mfa.listFactors();
        if (factors.error) throw factors.error;
        const factor = factors.data.totp.find((item) => item.status === 'verified');
        if (!factor) {
          setNeedsMfa(false);
          setError('Set up an authenticator in Access & security first.');
          return false;
        }
        const verified = await supabase.auth.mfa.challengeAndVerify({
          factorId: factor.id,
          code: code.trim(),
        });
        if (verified.error) {
          setError('Authenticator code is incorrect.');
          return false;
        }
        // challengeAndVerify upgrades this exact signed-in session to AAL2.
        return await invokeStepUp(creatorSecret);
      } catch {
        setError('Authenticator verification failed. Try again.');
        return false;
      } finally {
        setIsLoading(false);
      }
    },
    [invokeStepUp],
  );

  const dismissRequest = useCallback(() => {
    setShowModal(false);
    setNeedsMfa(false);
    pendingSecretRef.current = '';
    pendingCallbackRef.current = null;
    setError('');
  }, []);

  const clearAuth = useCallback(() => {
    cachedElevationRef.current = null;
    pendingSecretRef.current = '';
    pendingCallbackRef.current = null;
    setNeedsMfa(false);
    setShowModal(false);
    setError('');
  }, []);

  return (
    <CreatorAuthContext.Provider
      value={{
        requestAuth,
        requestElevation,
        verifySecret,
        verifyMfa,
        dismissRequest,
        clearAuth,
        showModal,
        needsMfa,
        isLoading,
        error,
      }}
    >
      {children}
    </CreatorAuthContext.Provider>
  );
}

export function useCreatorAuth(): CreatorAuthContextType {
  const context = useContext(CreatorAuthContext);
  if (!context)
    throw new Error('useCreatorAuth must be used within CreatorAuthProvider');
  return context;
}
