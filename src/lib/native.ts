// ─── NATIVE HELPERS ───────────────────────────────
// Bridge between web and Capacitor native features

export const isNative = (): boolean => {
  return typeof (window as any).Capacitor !== 'undefined';
};

export const isAndroid = (): boolean => {
  return isNative() && (window as any).Capacitor?.getPlatform() === 'android';
};

export const isIOS = (): boolean => {
  return isNative() && (window as any).Capacitor?.getPlatform() === 'ios';
};

// ─── CAMERA ───────────────────────────────────────
export async function takePhoto(): Promise<string | null> {
  if (!isNative()) return null;

  try {
    const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera');
    const photo = await Camera.getPhoto({
      quality: 85,
      allowEditing: true,
      resultType: CameraResultType.DataUrl,
      source: CameraSource.Prompt, // Lets user choose camera or gallery
      width: 800,
      height: 800,
    });
    return photo.dataUrl || null;
  } catch {
    return null;
  }
}

// ─── GEOLOCATION ──────────────────────────────────
export async function getCurrentPosition(): Promise<{ lat: number; lng: number } | null> {
  if (!isNative()) return null;

  try {
    const { Geolocation } = await import('@capacitor/geolocation');
    const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: true });
    return { lat: pos.coords.latitude, lng: pos.coords.longitude };
  } catch {
    return null;
  }
}

// ─── STATUS BAR ───────────────────────────────────
export async function setStatusBar(color: string = '#0A0A0F', dark: boolean = true) {
  if (!isNative()) return;

  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    await StatusBar.setBackgroundColor({ color });
    await StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light });
  } catch {
    // Ignore on web
  }
}

// ─── HAPTIC FEEDBACK ──────────────────────────────
export function haptic(style: 'light' | 'medium' | 'heavy' = 'light') {
  if (!isNative()) return;

  try {
    const patterns: Record<string, number> = {
      light: 10,
      medium: 20,
      heavy: 30,
    };
    if (navigator.vibrate) {
      navigator.vibrate(patterns[style] || 10);
    }
  } catch {
    // Ignore
  }
}
