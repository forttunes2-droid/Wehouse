type Settings = Record<string, string>;
type Snapshot = { settings: Settings; loading: boolean };

export function createPlatformSettingsStore(loader: () => Promise<Settings>) {
  let snapshot: Snapshot = { settings: {}, loading: true };
  let cached = false;
  let generation = 0;
  let pending: Promise<Settings> | null = null;
  const listeners = new Set<() => void>();
  function publish(next: Snapshot) { snapshot = next; listeners.forEach(listener => listener()); }
  function load(): Promise<Settings> {
    if (cached) return Promise.resolve(snapshot.settings);
    if (pending) return pending;
    const version = generation;
    const request = Promise.resolve().then(loader).then(settings => {
      if (version === generation) { cached = true; publish({ settings, loading: false }); }
      return settings;
    }).catch(() => {
      // Retain confirmed values after a transient failure and allow a retry.
      if (version === generation) publish({ ...snapshot, loading: false });
      return snapshot.settings;
    }).finally(() => { if (pending === request) pending = null; });
    pending = request;
    return request;
  }
  function refresh() {
    generation++; cached = false; pending = null;
    publish({ ...snapshot, loading: true });
    return load();
  }
  return {
    load, refresh,
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
