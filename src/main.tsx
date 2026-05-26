import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { isNative } from '@/lib/native'

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

// ─── SERVICE WORKER REGISTRATION ──────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js')
      .then((reg) => {
        console.log('[PWA] Service Worker registered:', reg.scope);
        // Auto-update on page load
        reg.update().catch(() => {});
      })
      .catch((err) => {
        console.log('[PWA] Service Worker registration failed:', err);
      });
  });
}

// ─── RENDER ───────────────────────────────────────
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <NativeInit />
    <App />
  </StrictMode>,
)
