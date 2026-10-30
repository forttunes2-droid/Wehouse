// Per-user, per-action throttle backed by public.consume_user_action_from_service.
// Deny by default when the shared limiter cannot confirm the request budget.
// An explicit fail-open policy is reserved for non-sensitive operations.
export type RateLimitResult = { allowed: boolean; retryAfterSeconds: number };

export async function consumeUserAction(
  // deno-lint-ignore no-explicit-any
  db: any,
  userId: string,
  action: string,
  maxAttempts: number,
  windowSeconds: number,
  failClosed = true,
): Promise<RateLimitResult> {
  const unavailable = { allowed: !failClosed, retryAfterSeconds: failClosed ? 30 : 0 };
  if (!userId?.trim() || !action?.trim() || !Number.isSafeInteger(maxAttempts) || maxAttempts < 1 ||
    !Number.isSafeInteger(windowSeconds) || windowSeconds < 1) return { allowed: false, retryAfterSeconds: 30 };
  try {
    const { data, error } = await db.rpc("consume_user_action_from_service", {
      p_user_key: userId,
      p_action: action,
      p_max_attempts: maxAttempts,
      p_window_seconds: windowSeconds,
    });
    if (error || !data || typeof data.allowed !== 'boolean') return unavailable;
    const retry = Number(data.retry_after_seconds);
    return {
      allowed: data.allowed,
      retryAfterSeconds: data.allowed ? 0 : Number.isFinite(retry) && retry > 0 ? Math.min(windowSeconds, Math.ceil(retry)) : 30,
    };
  } catch {
    return unavailable;
  }
}
