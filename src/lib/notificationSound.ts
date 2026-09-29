// In-app alerts include a sound by default. A legacy per-device "off" choice
// is honoured so an existing user is never surprised by a new audible alert.
const prefix = "wehouse:notification-sound:";
let lastPlayed = 0;
let context: AudioContext | null = null;

export async function unlockNotificationAudio(): Promise<void> {
  try {
    context ??= new AudioContext();
    if (context.state !== "running") await context.resume();
  } catch { /* A device may block web audio; visible alerts still work. */ }
}

export function notificationSoundEnabled(userId: string): boolean {
  try { return localStorage.getItem(prefix + userId) !== "off"; }
  catch { return true; }
}

export function setNotificationSoundEnabled(userId: string, enabled: boolean): void {
  try { localStorage.setItem(prefix + userId, enabled ? "on" : "off"); }
  catch { /* Private browsing may deny local storage. */ }
  if (enabled) void playNotificationSound(userId, true);
}

export async function playNotificationSound(userId: string, preview = false): Promise<void> {
  if (!preview && (!notificationSoundEnabled(userId) || document.visibilityState !== "visible")) return;
  const now = Date.now();
  if (!preview && now - lastPlayed < 2500) return;
  try {
    await unlockNotificationAudio();
    if (!context || context.state !== "running") return;
    const start = context.currentTime;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.055, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.22);
    gain.connect(context.destination);
    const tone = context.createOscillator();
    tone.type = "sine";
    tone.frequency.setValueAtTime(720, start);
    tone.frequency.exponentialRampToValueAtTime(940, start + 0.14);
    tone.connect(gain);
    tone.start(start);
    tone.stop(start + 0.23);
    lastPlayed = now;
  } catch { /* Browsers can deny audio; the visible alert still works. */ }
}
