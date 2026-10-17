// Per-user, per-action throttle backed by public.consume_user_action_from_service.
// If the limiter itself is unavailable the action is allowed, so a throttle fault
// never blocks a legitimate payment; the provider and database checks still apply.
export type RateLimitResult = { allowed: boolean; retryAfterSeconds: number };

export async function consumeUserAction(
  // deno-lint-ignore no-explicit-any
  db: any,
  userId: string,
  action: string,
  maxAttempts: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  try {
    const { data, error } = await db.rpc("consume_user_action_from_service", {
      p_user_key: userId,
      p_action: action,
      p_max_attempts: maxAttempts,
      p_window_seconds: windowSeconds,
    });
    if (error || !data) return { allowed: true, retryAfterSeconds: 0 };
    return {
      allowed: data.allowed !== false,
      retryAfterSeconds: Number(data.retry_after_seconds || 0),
    };
  } catch {
    return { allowed: true, retryAfterSeconds: 0 };
  }
}
