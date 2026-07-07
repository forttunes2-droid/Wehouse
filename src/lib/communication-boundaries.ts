// ═══════════════════════════════════════════════════════════
// PART 4 — COMMUNICATION BOUNDARIES
// Per Constitution: We House controls who can communicate with whom
// ═══════════════════════════════════════════════════════════

/**
 * Communication rules per Constitution Part 4:
 *
 * USER can communicate with:
 *   ✓ Workers (they provide services directly)
 *   ✓ Roommates
 *   ✓ We House Support
 *   ✗ Property Partners (NEVER — We House manages everything)
 *
 * PROPERTY PARTNER can communicate with:
 *   ✓ Creator
 *   ✓ Admin
 *   ✓ Operations Staff
 *   ✓ Finance Staff
 *   ✓ Support Staff
 *   ✓ Assigned Field Officer
 *   ✗ Users/Customers (NEVER)
 *
 * WORKER can communicate with:
 *   ✓ Users/Customers (direct — they perform the service)
 *
 * SUPPORT can communicate with:
 *   ✓ Everyone (Users, Workers, Property Partners, Staff, Creator)
 *
 * ADMIN/CREATOR can communicate with:
 *   ✓ Everyone
 */

export type CommunicatorRole =
  | 'user'
  | 'worker'
  | 'property_partner'
  | 'staff'
  | 'admin'
  | 'creator'
  | 'support';

// Who each role can INITIATE communication with
const COMMUNICATION_RULES: Record<CommunicatorRole, CommunicatorRole[]> = {
  // Users can talk to workers, support (roommate handled separately)
  user: ['worker', 'support'],

  // Workers talk directly to users (customers) — they provide the service
  worker: ['user', 'support'],

  // Property partners ONLY talk to We House internal staff — NEVER customers
  property_partner: ['creator', 'admin', 'staff', 'support'],

  // Staff talks to everyone in their scope
  staff: ['user', 'worker', 'property_partner', 'creator', 'admin', 'support'],

  // Admin talks to everyone
  admin: ['user', 'worker', 'property_partner', 'staff', 'creator', 'support'],

  // Creator talks to everyone
  creator: ['user', 'worker', 'property_partner', 'staff', 'admin', 'support'],

  // Support talks to everyone
  support: ['user', 'worker', 'property_partner', 'staff', 'admin', 'creator'],
};

/**
 * Check if a user with `userRole` can initiate communication
 * with a target user who has `targetRole`.
 *
 * Returns { allowed: true } or { allowed: false, reason: string }
 */
export function canCommunicate(
  userRole: CommunicatorRole | string,
  targetRole: CommunicatorRole | string
): { allowed: boolean; reason: string } {
  const normalizedUserRole = normalizeRole(userRole);
  const normalizedTargetRole = normalizeRole(targetRole);

  const allowedTargets = COMMUNICATION_RULES[normalizedUserRole] || [];

  if (allowedTargets.includes(normalizedTargetRole)) {
    return { allowed: true, reason: '' };
  }

  // Generate specific rejection reason
  if (normalizedUserRole === 'user' && normalizedTargetRole === 'property_partner') {
    return {
      allowed: false,
      reason: 'Property listings are managed by We House. Contact Support for any property enquiries.',
    };
  }

  if (normalizedUserRole === 'property_partner' && normalizedTargetRole === 'user') {
    return {
      allowed: false,
      reason: 'Property Partners cannot communicate directly with customers. We House manages all customer communication.',
    };
  }

  return {
    allowed: false,
    reason: `${normalizedUserRole} cannot initiate communication with ${normalizedTargetRole} per platform policy.`,
  };
}

/**
 * Get a user-friendly message explaining why communication is blocked
 */
export function getCommunicationBlockMessage(
  userRole: CommunicatorRole | string,
  targetRole: CommunicatorRole | string
): string {
  const result = canCommunicate(userRole, targetRole);
  if (result.allowed) return '';
  return result.reason;
}

/**
 * Check if a conversation between two roles should be created.
 * Used before createConversation() or getOrCreateConversation().
 */
export function validateConversation(
  userRole: CommunicatorRole | string,
  targetRole: CommunicatorRole | string,
  conversationType?: string
): { valid: boolean; error?: string } {
  // Support conversations are always allowed (users can reach support)
  if (conversationType === 'partner_support' || conversationType === 'support') {
    return { valid: true };
  }

  const result = canCommunicate(userRole, targetRole);
  if (!result.allowed) {
    return { valid: false, error: result.reason };
  }

  return { valid: true };
}

// Normalize role strings to match CommunicatorRole
function normalizeRole(role: string): CommunicatorRole {
  const r = role?.toLowerCase().trim() || '';
  if (r === 'property_partner' || r === 'property partner' || r === 'partner') return 'property_partner';
  if (r === 'property_partner_staff') return 'staff'; // Treat staff sub-roles as staff
  if (r === 'worker') return 'worker';
  if (r === 'user') return 'user';
  if (r === 'admin') return 'admin';
  if (r === 'creator') return 'creator';
  if (r === 'support' || r === 'support_staff') return 'support';
  if (r === 'staff' || r.startsWith('staff')) return 'staff';
  return 'user'; // Default
}
