// Test-only UI flag. All auth/database clients remain the original localhost
// client. This exercises Login's actual conditional render, not a hidden banner.
export * from '../../src/lib/supabase/client';
export const isTestEnvironment = new URLSearchParams(window.location.search)
  .get('presentation_environment') !== 'live';
