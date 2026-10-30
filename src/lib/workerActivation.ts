/** Validates the canonical activation receipt before UI state is derived from it. */
export function assertWorkerActivation(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Setup status could not be confirmed. Please try again.');
  }
  const data = value as Record<string, unknown>;
  const required = ['live', 'reviewed', 'profile_complete', 'identity_passed', 'evidence_saved', 'submitted',
    'marketplace_enabled', 'identity_required', 'identity_gate_satisfied',
    'identity_captured', 'identity_current', 'identity_recurring_required'];
  if (typeof data.worker_status !== 'string' || !data.worker_status.trim() ||
      required.some(key => typeof data[key] !== 'boolean') ||
      (data.rejection_reason !== null && typeof data.rejection_reason !== 'string') ||
      (data.live === true && data.reviewed !== true)) {
    throw new Error('Setup status could not be confirmed. Please try again.');
  }
}
