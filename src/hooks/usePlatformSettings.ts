import { useCallback, useSyncExternalStore } from 'react';
import { supabase } from '@/lib/supabase';
import { createPlatformSettingsStore } from '@/lib/platformSettingsStore';

const store = createPlatformSettingsStore(async () => {
  const { data, error } = await supabase.rpc('get_all_settings_v2');
  if (error || !Array.isArray(data)) throw error || new Error('Settings unavailable');
  return Object.fromEntries(data.map((row: { key: string; value: string }) => [row.key, row.value ?? '']));
});
let subscriberCount = 0;
let refreshTimer: ReturnType<typeof setInterval> | undefined;
function refreshVisible() { if (document.visibilityState === 'visible') void store.refresh(); }
function subscribe(listener: () => void) {
  const unsubscribe = store.subscribe(listener);
  if (subscriberCount++ === 0) {
    window.addEventListener('focus', refreshVisible);
    document.addEventListener('visibilitychange', refreshVisible);
    // One bounded refresh for all consumers; hidden tabs do no periodic work.
    refreshTimer = setInterval(refreshVisible, 60_000);
  }
  void store.load();
  return () => {
    unsubscribe();
    if (--subscriberCount === 0) {
      window.removeEventListener('focus', refreshVisible);
      document.removeEventListener('visibilitychange', refreshVisible);
      clearInterval(refreshTimer);
    }
  };
}
export function invalidateSettingsCache() { void store.refresh(); }
export function usePlatformSettings() {
  const { settings, loading } = useSyncExternalStore(subscribe, store.getSnapshot, store.getSnapshot);
  const refresh = useCallback(() => { void store.refresh(); }, []);
  const getValue = useCallback((key: string, fallback = '') => settings[key] ?? fallback, [settings]);
  const getNumber = useCallback((key: string, fallback = 0) => numberValue(settings[key], fallback), [settings]);
  const getBoolean = useCallback((key: string, fallback = false) => booleanValue(settings[key], fallback), [settings]);
  return { settings, loading, refresh, getValue, getNumber, getBoolean };
}
function numberValue(value: string | undefined, fallback: number) { const n = Number.parseFloat(value || ''); return Number.isFinite(n) ? n : fallback; }
function booleanValue(value: string | undefined, fallback: boolean) { return value === 'true' ? true : value === 'false' ? false : fallback; }
export function getSetting(key: string, fallback = '') { return store.getSnapshot().settings[key] ?? fallback; }
export function getSettingNumber(key: string, fallback = 0) { return numberValue(store.getSnapshot().settings[key], fallback); }
export function getSettingBoolean(key: string, fallback = false) { return booleanValue(store.getSnapshot().settings[key], fallback); }
export function preloadSettings() { return store.load(); }
