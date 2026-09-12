import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './operational-workspaces.css'
import './worker-discovery-responsive.css'
import './chat-mobile.css'
import App from './App.tsx'
import ErrorBoundary from '@/components/ErrorBoundary'
import { isNative } from '@/lib/native'
import NativeSelectBridge from '@/components/NativeSelectBridge'
import NativeDateBridge from '@/components/NativeDateBridge'

function NativeInit() {
  useEffect(() => {
    if (!isNative()) return;
    import('@capacitor/status-bar').then(({ StatusBar, Style }) => {
      StatusBar.setStyle({ style: Style.Light }).catch(() => {});
      StatusBar.setBackgroundColor({ color: '#0A0A0F' }).catch(() => {});
    });
    import('@capacitor/splash-screen').then(({ SplashScreen }) => {
      setTimeout(() => { SplashScreen.hide().catch(() => {}); }, 1500);
    });
  }, []);
  return null;
}

function MobileViewportInit() {
  useEffect(() => {
    const root = document.documentElement;
    const viewport = window.visualViewport;

    const updateViewport = () => {
      const height = Math.max(1, Math.round(viewport?.height || window.innerHeight));
      const top = Math.max(0, Math.round(viewport?.offsetTop || 0));
      const keyboardOpen = window.innerHeight - height > 120;
      root.style.setProperty('--wh-visual-viewport-height', `${height}px`);
      root.style.setProperty('--wh-visual-viewport-top', `${top}px`);
      document.body.classList.toggle('wh-keyboard-open', keyboardOpen);

      if (keyboardOpen && document.activeElement instanceof HTMLTextAreaElement) {
        window.requestAnimationFrame(() => {
          document.activeElement instanceof HTMLTextAreaElement &&
            document.activeElement.scrollIntoView({ block: 'nearest' });
        });
      }
    };

    // On a phone the keyboard Enter key should create a new line. Sending is a
    // deliberate tap on the send control, matching modern mobile chat apps.
    const keepMobileEnterAsNewline = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
      if (!window.matchMedia('(pointer: coarse)').matches) return;
      const target = event.target;
      if (!(target instanceof HTMLTextAreaElement)) return;
      if (target.getAttribute('placeholder') !== 'Message') return;
      event.stopPropagation();
    };

    updateViewport();
    viewport?.addEventListener('resize', updateViewport);
    viewport?.addEventListener('scroll', updateViewport);
    window.addEventListener('resize', updateViewport);
    window.addEventListener('orientationchange', updateViewport);
    document.addEventListener('keydown', keepMobileEnterAsNewline, true);

    return () => {
      viewport?.removeEventListener('resize', updateViewport);
      viewport?.removeEventListener('scroll', updateViewport);
      window.removeEventListener('resize', updateViewport);
      window.removeEventListener('orientationchange', updateViewport);
      document.removeEventListener('keydown', keepMobileEnterAsNewline, true);
      document.body.classList.remove('wh-keyboard-open');
    };
  }, []);
  return null;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <NativeInit />
      <MobileViewportInit />
      <NativeSelectBridge />
      <NativeDateBridge />
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
