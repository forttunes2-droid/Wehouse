import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './operational-workspaces.css'
import './worker-discovery-responsive.css'
import './chat-mobile.css'
import { Toaster } from 'sonner'
import ErrorBoundary from '@/components/ErrorBoundary'
import { isNative } from '@/lib/native'
import NativeSelectBridge from '@/components/NativeSelectBridge'
import NativeDateBridge from '@/components/NativeDateBridge'

function NativeInit() {
  useEffect(() => { document.documentElement.dataset.whReactMounted = "true"; }, []);
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
          if (document.activeElement instanceof HTMLTextAreaElement) {
            document.activeElement.scrollIntoView({ block: 'nearest' });
          }
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

function assertBrowserEnvironmentBeforeAppLoad() {
  const configuredUrl = String(import.meta.env.VITE_SUPABASE_URL || '').trim();
  const configuredKey = String(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim();
  const host = window.location.hostname.toLowerCase();
  const productionHost = host === 'wehouse.com.ng' || host === 'www.wehouse.com.ng';
  const productionProject = 'rkrhnkhppeihvmuwvsvn.supabase.co';

  if ((!configuredUrl || !configuredKey) && !(productionHost && !configuredUrl && !configuredKey)) {
    throw new Error('WeHouse configuration is incomplete. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY together for this environment.');
  }
  if (configuredUrl) {
    let endpoint: URL;
    try { endpoint = new URL(configuredUrl); }
    catch { throw new Error('WeHouse Supabase URL is invalid.'); }
    const configuredProduction = endpoint.hostname.replace(/\.$/, '') === productionProject;
    if (!productionHost && configuredProduction) {
      throw new Error('Safety stop: a non-production WeHouse host cannot connect to the production Supabase project.');
    }
    if (productionHost && endpoint.hostname.replace(/\.$/, '') !== productionProject) {
      throw new Error('Safety stop: the live WeHouse website must connect to the production Supabase project.');
    }
  }
}

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('WeHouse root element is missing');
const appRoot = rootElement;

async function mountWeHouse() {
  assertBrowserEnvironmentBeforeAppLoad();
  const { default: App } = await import('./App.tsx');
  createRoot(appRoot).render(
  <StrictMode>
    <ErrorBoundary>
      <NativeInit />
      <MobileViewportInit />
      <NativeSelectBridge />
      <NativeDateBridge />
      <App />
      <Toaster position="top-center" theme="dark" visibleToasts={1} duration={3200}
        offset="max(12px, env(safe-area-inset-top))" mobileOffset="max(12px, env(safe-area-inset-top))"
        style={{ zIndex: 2147483647 }} toastOptions={{ style: { background: "#17151E", color: "#F4F1F8", borderColor: "#38313F", borderRadius: '14px', padding: '12px 14px', fontSize: '13px', lineHeight: '1.4' } }} />
    </ErrorBoundary>
  </StrictMode>,
  )
}

void mountWeHouse()
