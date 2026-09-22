/** One history entry per visible profile layer; never change the workspace URL. */
type ProfileMarker = { id: string; parent: ProfileMarker | null };
type ProfileState = Record<string, unknown> & { whProfileScreen?: ProfileMarker };
const screens: string[] = [];
export const isTopProfileScreen = (id: string) => screens.at(-1) === id;

export function bindProfileScreenHistory(win: Window, id: string, onClose: () => void) {
  let active = true;
  let closing = false;
  const current = (win.history.state || {}) as ProfileState;
  const marker: ProfileMarker = current.whProfileScreen?.id === id
    ? current.whProfileScreen
    : { id, parent: current.whProfileScreen || null };
  if (current.whProfileScreen?.id !== id) {
    win.history.pushState({ ...current, whProfileScreen: marker }, "");
  }
  screens.push(id);
  const finish = () => {
    if (!active) return;
    active = false;
    onClose();
  };
  const pop = (event: PopStateEvent) => {
    if (!active || !isTopProfileScreen(id) || event.state?.whProfileScreen?.id === id) return;
    event.stopImmediatePropagation();
    finish();
  };
  win.addEventListener("popstate", pop, true);
  return {
    dismiss() {
      if (!active || closing || !isTopProfileScreen(id)) return;
      closing = true;
      if (win.history.state?.whProfileScreen?.id === id) win.history.back();
      else finish();
    },
    dispose() {
      active = false;
      win.removeEventListener("popstate", pop, true);
      const index = screens.lastIndexOf(id);
      if (index !== -1) screens.splice(index, 1);
      // StrictMode immediately attaches the same layer again. Only clean a
      // stale marker when navigation really unmounted the layer.
      queueMicrotask(() => {
        if (screens.includes(id) || win.history.state?.whProfileScreen?.id !== id) return;
        const state = { ...win.history.state } as ProfileState;
        if (marker.parent) state.whProfileScreen = marker.parent;
        else delete state.whProfileScreen;
        win.history.replaceState(state, "");
      });
    },
  };
}
