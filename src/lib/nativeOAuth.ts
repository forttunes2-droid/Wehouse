import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { isNative } from '@/lib/native';
import { supabase } from '@/lib/supabase/client';
import { parseNativeOAuthCallback } from '@/lib/nativeOAuthRedirect';

let registration: Promise<void> | null = null;
async function handleReturn(value: string) {
  const callback = parseNativeOAuthCallback(value);
  if (!callback) return;
  await Browser.close().catch(() => {});
  let error = callback.error;
  if (!error && callback.code) {
    try {
      const result = await supabase.auth.exchangeCodeForSession(callback.code);
      error = result.error?.message || '';
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Account confirmation failed';
    }
  } else if (!error) {
    error = 'Account confirmation did not return a code';
  }
  window.dispatchEvent(new CustomEvent('wh-native-oauth-return', {
    detail: { context: callback.context, error },
  }));
}

export function registerNativeOAuthHandler() {
  if (!isNative()) return Promise.resolve();
  if (!registration) registration = (async () => {
    await App.addListener('appUrlOpen', ({ url }) => { void handleReturn(url); });
    const launch = await App.getLaunchUrl();
    if (launch?.url) await handleReturn(launch.url);
  })().catch((cause) => {
    registration = null;
    throw cause;
  });
  return registration;
}

export async function openNativeOAuth(url: string) {
  const destination = new URL(url);
  if (destination.protocol !== 'https:') throw new Error('Sign-in destination must be secure');
  await registerNativeOAuthHandler();
  await Browser.open({ url: destination.toString() });
}
