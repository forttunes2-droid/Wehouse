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
  if (enabled) void playNotificationSound(userId, { preview: true });
}

export type AlertTone = "chat" | "update" | "important";
type AlertOptions = { preview?: boolean; tone?: AlertTone; key?: string };

// Two-note WeHouse chime. Chat is soft, updates are neutral and money or
// security alerts are firmer so people can tell them apart without looking.
const tones: Record<AlertTone, { notes: [number, number]; peak: number; gap: number }> = {
  chat: { notes: [660, 880], peak: 0.035, gap: 0.09 },
  update: { notes: [720, 960], peak: 0.055, gap: 0.12 },
  important: { notes: [784, 1175], peak: 0.075, gap: 0.16 },
};
const MIN_GAP_MS = 4000;
const BURST_LIMIT = 3;
const BURST_WINDOW_MS = 60_000;
const recentKeys = new Map<string, number>();
const recentPlays: number[] = [];

export async function playNotificationSound(userId: string, options: AlertOptions | boolean = {}): Promise<void> {
  const opts: AlertOptions = typeof options === "boolean" ? { preview: options } : options;
  const preview = Boolean(opts.preview);
  if (!preview && (!notificationSoundEnabled(userId) || document.visibilityState !== "visible")) return;
  const now = Date.now();
  if (!preview) {
    // One chime per alert, never a repeating loop: the same alert key is
    // ignored, alerts are spaced out, and a burst is capped per minute.
    if (opts.key) {
      for (const [k, at] of recentKeys) if (now - at > BURST_WINDOW_MS) recentKeys.delete(k);
      if (recentKeys.has(opts.key)) return;
      recentKeys.set(opts.key, now);
    }
    if (now - lastPlayed < MIN_GAP_MS) return;
    while (recentPlays.length && now - recentPlays[0] > BURST_WINDOW_MS) recentPlays.shift();
    if (recentPlays.length >= BURST_LIMIT) return;
  }
  try {
    await unlockNotificationAudio();
    if (!context || context.state !== "running") return;
    const tone = tones[opts.tone || "update"];
    const start = context.currentTime;
    tone.notes.forEach((frequency, index) => {
      if (!context) return;
      const at = start + index * tone.gap;
      const gain = context.createGain();
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(tone.peak, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.2);
      gain.connect(context.destination);
      const osc = context.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(frequency, at);
      osc.connect(gain);
      osc.start(at);
      osc.stop(at + 0.22);
    });
    if (!preview) {
      lastPlayed = now;
      recentPlays.push(now);
    }
  } catch { /* Browsers can deny audio; the visible alert still works. */ }
}
