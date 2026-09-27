type Result = { error?: unknown; data?: unknown };
/** A sign-out response alone is insufficient. Finish checks the actual Auth session
 * store and commits device-history cleanup + one audit record transactionally. */
export async function finishRecoveryCleanup(signOut: () => PromiseLike<Result>, finish: () => PromiseLike<Result>, pause: (ms:number) => Promise<void>): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try { await signOut(); } catch { /* Verify real state even after a lost response. */ }
    try { const result = await finish(); if (!result.error && result.data === true) return true; } catch { /* No false success. */ }
    if (attempt < 2) await pause(150 * (attempt + 1));
  }
  return false;
}
