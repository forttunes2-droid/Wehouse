import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './operational-workspaces.css'
import './worker-discovery-responsive.css'
import App from './App.tsx'
import ErrorBoundary from '@/components/ErrorBoundary'
import NativeSelectBridge from '@/components/NativeSelectBridge'
import { isNative } from '@/lib/native'

function NativeInit() {
  useEffect(() => {
    if (!isNative()) return;
    import('@capacitor/status-bar').then(({ StatusBar, Style }) => {
      StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
      StatusBar.setBackgroundColor({ color: '#0A0A0F' }).catch(() => {});
    });
    import('@capacitor/splash-screen').then(({ SplashScreen }) => {
      setTimeout(() => { SplashScreen.hide().catch(() => {}); }, 1500);
    });
  }, []);
  return null;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <NativeInit />
      <NativeSelectBridge />
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
