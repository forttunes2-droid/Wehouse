import { supabase } from './client';

/**
 * Get all platform settings, optionally filtered by category.
 */
export async function getPlatformSettings(category?: string) {
  const { data, error } = await supabase.rpc('get_all_settings_v2');
  if (error) throw error;
  const all = data || [];
  if (category) return all.filter((s: any) => s.category === category);
  return all;
}

/**
 * Get a single platform setting by key.
 */
export async function getPlatformSetting(key: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('get_setting_v2', {
    p_key: key,
  });
  if (error) throw error;
  return data || null;
}

/**
 * Update a platform setting (creator/admin only).
 */
export async function updatePlatformSetting(key: string, value: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('set_setting_v2', {
    p_key: key,
    p_value: value,
  });
  if (error) throw error;
  return data || false;
}

/**
 * Get typed setting value (parses numbers and booleans).
 */
export async function getTypedSetting<T = string>(key: string): Promise<T | null> {
  const raw = await getPlatformSetting(key);
  if (raw === null) return null;

  // Try boolean
  if (raw.toLowerCase() === 'true') return true as T;
  if (raw.toLowerCase() === 'false') return false as T;

  // Try number
  const num = parseFloat(raw);
  if (!isNaN(num) && raw.trim() !== '') return num as T;

  // Try JSON
  if (raw.startsWith('[') || raw.startsWith('{')) {
    try { return JSON.parse(raw) as T; } catch { /* not JSON */ }
  }

  return raw as T;
}
