import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

// In-memory cache for platform settings (loaded once per session)
let cachedSettings: Record<string, string> | null = null;
let cachePromise: Promise<Record<string, string>> | null = null;

async function loadSettingsInternal(): Promise<Record<string, string>> {
  if (cachedSettings) return cachedSettings;
  if (cachePromise) return cachePromise;

  cachePromise = (async () => {
    try {
      const { data, error } = await supabase.rpc('get_all_settings_v2');
      if (error || !data) {
        console.warn('[PlatformSettings] Failed to load, using defaults:', error?.message);
        return {};
      }
      const map: Record<string, string> = {};
      data.forEach((s: any) => { map[s.key] = s.value || ''; });
      cachedSettings = map;
      return map;
    } catch (e) {
      console.warn('[PlatformSettings] Error loading:', e);
      return {};
    }
  })();

  return cachePromise;
}

export function invalidateSettingsCache() {
  cachedSettings = null;
  cachePromise = null;
}

// Hook for reactive access
export function usePlatformSettings() {
  const [settings, setSettings] = useState<Record<string, string>>(cachedSettings || {});
  const [loading, setLoading] = useState(!cachedSettings);

  useEffect(() => {
    let mounted = true;
    loadSettingsInternal().then(map => {
      if (mounted) { setSettings(map); setLoading(false); }
    });
    return () => { mounted = false; };
  }, []);

  const refresh = useCallback(() => {
    invalidateSettingsCache();
    setLoading(true);
    loadSettingsInternal().then(map => { setSettings(map); setLoading(false); });
  }, []);

  const getValue = useCallback((key: string, fallback: string = ''): string => {
    return settings[key] ?? fallback;
  }, [settings]);

  const getNumber = useCallback((key: string, fallback: number = 0): number => {
    const val = settings[key];
    if (!val) return fallback;
    const n = parseFloat(val);
    return isNaN(n) ? fallback : n;
  }, [settings]);

  const getBoolean = useCallback((key: string, fallback: boolean = false): boolean => {
    return settings[key] === 'true' ? true : settings[key] === 'false' ? false : fallback;
  }, [settings]);

  return { settings, loading, refresh, getValue, getNumber, getBoolean };
}

// Synchronous access (returns cached value or fallback)
export function getSetting(key: string, fallback: string = ''): string {
  return cachedSettings?.[key] ?? fallback;
}

export function getSettingNumber(key: string, fallback: number = 0): number {
  const val = cachedSettings?.[key];
  if (!val) return fallback;
  const n = parseFloat(val);
  return isNaN(n) ? fallback : n;
}

export function getSettingBoolean(key: string, fallback: boolean = false): boolean {
  const val = cachedSettings?.[key];
  return val === 'true' ? true : val === 'false' ? false : fallback;
}

// Pre-load settings at app startup
export function preloadSettings(): Promise<Record<string, string>> {
  return loadSettingsInternal();
}
