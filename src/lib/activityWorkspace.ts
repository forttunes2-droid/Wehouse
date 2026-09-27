const OPERATIONS = ['property_operations', 'field_operations', 'worker_operations', 'finance_operations', 'security_operations', 'support'];
/** Mirrors the server's workspace aliases. Never infer delivery from a person's
 * highest role: a Creator or Partner also has an independent Personal feed. */
export function activityWorkspaceMatches(requested: string, delivered: unknown): boolean {
  if (typeof delivered !== 'string' || !delivered) return false;
  if (requested === 'personal') return ['personal', 'account'].includes(delivered);
  if (['partner', 'property_partner'].includes(requested)) return ['partner', 'property_partner'].includes(delivered);
  if (['hotel', 'hotel_staff'].includes(requested)) return ['hotel', 'hotel_staff'].includes(delivered);
  if (requested === 'staff') return delivered === 'staff' || OPERATIONS.includes(delivered);
  if (OPERATIONS.includes(requested)) return delivered === requested || delivered === 'staff';
  return requested === delivered;
}
