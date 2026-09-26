// Registered by both native projects and allowlisted in Supabase Auth settings.
export const NATIVE_OAUTH_REDIRECT = 'com.wehouse.app://auth-callback/';

type VerificationContext = 'signup' | 'password_recovery' | 'new_device';

export function parseNativeOAuthCallback(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'com.wehouse.app:' || url.hostname !== 'auth-callback' || url.pathname !== '/') return null;
    const context = url.searchParams.get('verify');
    return {
      context: context === 'signup' || context === 'password_recovery' || context === 'new_device'
        ? context as VerificationContext : null,
      code: url.searchParams.get('code') || '',
      error: url.searchParams.get('error_description') || url.searchParams.get('error') || '',
    };
  } catch { return null; }
}
