/** One booking command at a time; errors retain the booking and release its controls. */
export function createBookingActionRunner() {
  let active = false;
  return async (id: string, work: () => Promise<unknown>, busy: (id: string | null) => void,
    recover: (error: unknown) => Promise<void>) => {
    if (active) return;
    active = true;
    busy(id);
    try { await work(); }
    catch (error) { await recover(error); }
    finally { active = false; busy(null); }
  };
}
