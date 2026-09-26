// Loaded only by tests/browser/vite.config.ts; production never imports this file.
import { useEffect, useState } from 'react';
import type { Profile } from '../../src/types';
export { canCreateListings, isCreator, isAdmin, isStaff, hasAdminAccess, canSendAnnouncements, getScope, isGlobal } from '../../src/hooks/useAuth';
export const fixtureProfile = {
  user_id: 'experience-creator', auth_id: '77777777-1111-4111-8111-111111111111',
  email: 'experience@example.invalid', full_name: 'Experience Reviewer', username: 'reviewer',
  role: 'creator', profile_complete: true, account_kind: 'consumer', state: 'Nasarawa',
  local_government: 'Lafia', city: 'Lafia', avatar_url: null,
} as unknown as Profile;
export function useAuth() {
  const mode = new URLSearchParams(window.location.search).get('fixture');
  const [ready, setReady] = useState(mode !== 'arrival');
  useEffect(() => {
    const done = () => setReady(true);
    window.addEventListener('qa-auth-ready', done);
    return () => window.removeEventListener('qa-auth-ready', done);
  }, []);
  return {
    profile: mode === 'login' ? null : fixtureProfile,
    page: mode === 'login' ? 'login' as const : 'creator' as const,
    isLoading: !ready, error: '', kickedOut: false, pendingDevice: null,
    handleLoginSuccess: async () => {}, handleSetupComplete: () => {},
    logout: async () => {}, clearError: () => {},
  };
}
