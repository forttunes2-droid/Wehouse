import { useSyncExternalStore } from 'react';
import { isNative } from '@/lib/native';

export type Appearance = 'system' | 'light' | 'dark';
export type ResolvedAppearance = 'light' | 'dark';
const key = 'wehouse:appearance';
const eventName = 'wehouse:appearance-changed';

function systemAppearance(): ResolvedAppearance {
  try {
    return window.matchMedia?.('(prefers-color-scheme: dark)')?.matches ? 'dark' : 'light';
  } catch { return 'dark'; }
}

export function getAppearance(): Appearance {
  if (typeof window === 'undefined') return 'system';
  try {
    const value = window.localStorage.getItem(key);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch { return 'system'; }
}

export function resolvedAppearance(choice = getAppearance()): ResolvedAppearance {
  return choice === 'light' || choice === 'dark' ? choice : systemAppearance();
}

export function applyAppearance() {
  const resolved = resolvedAppearance();
  const root = document.documentElement;
  root.dataset.whTheme = resolved;
  root.classList.toggle('dark', resolved === 'dark');
  root.style.colorScheme = resolved;
  const color = resolved === 'dark' ? '#090B10' : '#F7F8FB';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color);
  document.querySelector('meta[name="background-color"]')?.setAttribute('content', color);
  if (isNative()) {
    void import('@capacitor/status-bar').then(({ StatusBar, Style }) =>
      Promise.allSettled([
        StatusBar.setStyle({ style: resolved === 'dark' ? Style.Dark : Style.Light }),
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
    () => 'system',
  );
}

export function startAppearanceSync() {
  applyAppearance();
  const media = window.matchMedia?.('(prefers-color-scheme: dark)');
  media?.addEventListener?.('change', () => {
    if (getAppearance() !== 'system') return;
    applyAppearance();
    window.dispatchEvent(new Event(eventName));
  });
  window.addEventListener('storage', (event) => {
    if (event.key === key) {
      applyAppearance();
      window.dispatchEvent(new Event(eventName));
    }
  });
}
