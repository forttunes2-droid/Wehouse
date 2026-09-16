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
  const pendingPasswordRef = useRef('');
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
      pendingPasswordRef.current = '';
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
      pendingPasswordRef.current = '';
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
    async (password: string, otpCode = ''): Promise<boolean> => {
      const actionClass = pendingActionRef.current;
      const { data, error: invokeError } = await supabase.functions.invoke(
        'creator-step-up',
        {
          body: {
            password,
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
        pendingPasswordRef.current = password;
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

  const verifyPassword = useCallback(
    async (password: string): Promise<boolean> => {
      if (!password) return false;
      setIsLoading(true);
      setError('');
      try {
        pendingPasswordRef.current = password;
        return await invokeStepUp(password);
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
      const password = pendingPasswordRef.current;
      if (!password) {
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
        return await invokeStepUp(password, code.trim());
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
    pendingPasswordRef.current = '';
    pendingCallbackRef.current = null;
    setError('');
  }, []);

  const clearAuth = useCallback(() => {
    cachedElevationRef.current = null;
    pendingPasswordRef.current = '';
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
        verifyPassword,
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
