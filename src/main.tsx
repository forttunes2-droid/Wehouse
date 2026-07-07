import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import ErrorBoundary from '@/components/ErrorBoundary'
import { isNative } from '@/lib/native'

// ─── CHUNK LOAD FAILURE RECOVERY ──────────────────
// If old cached HTML references old JS filenames, catch the error and reload
window.addEventListener('error', function(e) {
  const msg = e.message || '';
  if (msg.includes('Loading chunk') || msg.includes('Loading CSS chunk') || msg.includes('Failed to fetch dynamically imported module')) {
    console.error('[Chunk Load Error]', msg);
    // Clear any cached state and reload
    sessionStorage.removeItem('sw_done');
    window.location.reload();
  }
});
// Also catch unhandled promise rejections (React.lazy failures)
window.addEventListener('unhandledrejection', function(e) {
  const reason = e.reason?.message || String(e.reason);
  if (reason.includes('Failed to fetch') || reason.includes('dynamically imported module') || reason.includes('Loading chunk')) {
    console.error('[Chunk Load Rejection]', reason);
    sessionStorage.removeItem('sw_done');
    window.location.reload();
  }
});

// ─── NATIVE INIT ──────────────────────────────────
function NativeInit() {
  useEffect(() => {
    if (!isNative()) return;

    // Dynamically import Capacitor plugins (avoiding SSR/bundle issues on web)
    import('@capacitor/status-bar').then(({ StatusBar, Style }) => {
      StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
      StatusBar.setBackgroundColor({ color: '#0A0A0F' }).catch(() => {});
    });

    import('@capacitor/splash-screen').then(({ SplashScreen }) => {
      // Splash screen auto-hides via config, but we can hide it manually when ready
      setTimeout(() => {
        SplashScreen.hide().catch(() => {});
      }, 1500);
    });
  }, []);

  return null;
}

// ─── RENDER ───────────────────────────────────────
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <NativeInit />
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
