import { useSyncExternalStore } from 'react';
import { isNative } from '@/lib/native';

export type Appearance = 'system' | 'light' | 'dark';
const key = 'wehouse:appearance';
const eventName = 'wehouse:appearance-changed';

export function getAppearance(): Appearance {
  if (typeof window === 'undefined') return 'dark';
  try {
    const value = window.localStorage.getItem(key);
    return value === 'light' || value === 'dark' || value === 'system' ? value : 'dark';
  } catch { return 'dark'; }
}

export function resolvedAppearance(choice = getAppearance()): 'light' | 'dark' {
  return choice === 'system'
    ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
    : choice;
}

export function applyAppearance() {
  const resolved = resolvedAppearance();
  const root = document.documentElement;
  root.dataset.whTheme = resolved;
  root.classList.toggle('dark', resolved === 'dark');
  root.style.colorScheme = resolved;
  const color = resolved === 'dark' ? '#090B10' : '#F7F8FB';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color);
  if (isNative()) {
    void import('@capacitor/status-bar').then(({ StatusBar, Style }) =>
      Promise.allSettled([
        StatusBar.setStyle({ style: resolved === 'dark' ? Style.Light : Style.Dark }),
        StatusBar.setBackgroundColor({ color }),
      ])
    ).catch(() => {});
  }
  window.dispatchEvent(new Event(eventName));
}

export function setAppearance(choice: Appearance) {
  try { window.localStorage.setItem(key, choice); } catch { /* private storage */ }
  applyAppearance();
}

export function useAppearance(): Appearance {
  return useSyncExternalStore(
    (notify) => {
      window.addEventListener(eventName, notify);
      return () => window.removeEventListener(eventName, notify);
    },
    getAppearance,
    () => 'dark',
  );
}

export function startAppearanceSync() {
  applyAppearance();
  const media = window.matchMedia('(prefers-color-scheme: light)');
  media.addEventListener('change', applyAppearance);
  window.addEventListener('storage', (event) => {
    if (event.key === key) applyAppearance();
  });
}
