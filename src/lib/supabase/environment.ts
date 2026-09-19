// Project identities and browser publishable keys are public configuration.
// This boundary prevents deployment mistakes; database permissions still decide access.
export const PRODUCTION_SUPABASE_URL = 'https://rkrhnkhppeihvmuwvsvn.supabase.co';
const PRODUCTION_PUBLISHABLE_KEY = 'sb_publishable_PhMsGwc_jy21ICg11jQsVg_uwT2dhKQ';

export function resolveSupabaseEnvironment(host: string, configuredUrl: string, configuredKey: string) {
  const hostname = host.toLowerCase();
  const production = hostname === 'wehouse.com.ng' || hostname === 'www.wehouse.com.ng';
  const url = configuredUrl.trim();
  const key = configuredKey.trim();
  // Keep the existing official-domain fallback atomic: never mix half of one
  // project's configuration with half of another project's configuration.
  if ((!url || !key) && !(production && !url && !key)) {
    throw new Error('WeHouse configuration is incomplete. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY together for this environment.');
  }
  let endpoint: URL;
  try { endpoint = new URL(url || PRODUCTION_SUPABASE_URL); }
  catch { throw new Error('WeHouse Supabase URL is invalid.'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname);
  if ((endpoint.protocol !== 'https:' && !(local && endpoint.protocol === 'http:')) ||
      endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== '/') {
    throw new Error('WeHouse Supabase URL must be a secure project origin.');
  }
  const productionProject = endpoint.hostname.replace(/\.$/, '') === new URL(PRODUCTION_SUPABASE_URL).hostname;
  if (!production && productionProject) {
    throw new Error('Safety stop: a non-production WeHouse host cannot connect to the production Supabase project.');
  }
  if (production && endpoint.origin !== PRODUCTION_SUPABASE_URL) {
    throw new Error('Safety stop: the live WeHouse website must connect to the production Supabase project.');
  }
  return { url: endpoint.origin, key: key || PRODUCTION_PUBLISHABLE_KEY, isTestEnvironment: !production };
}
