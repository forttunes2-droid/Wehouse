export type PropertyAssignment = {
  assignment_id: string;
  user_id: string;
  name?: string | null;
  username?: string | null;
  role: 'owner' | 'manager';
  status: 'invited' | 'active' | 'revoked' | 'declined';
  access_level?: 'operations' | 'full_hosting';
};
export type PropertyManagementState = {
  listing_id: string;
  management_mode: 'host' | 'wehouse' | null;
  wehouse_management_status: 'not_required' | 'requested' | 'approved' | 'declined' | null;
  management_host_user_id?: string | null;
  management_updated_at?: string | null;
  assignments: PropertyAssignment[];
};

/** Missing/mismatched data must not invent an operator or an empty team. */
export function parsePropertyManagement(value: unknown, listingId: string): PropertyManagementState {
  const row = value as PropertyManagementState | null;
  if (!row || row.listing_id !== listingId || !Array.isArray(row.assignments) ||
      ![null, 'host', 'wehouse'].includes(row.management_mode) ||
      ![null, 'not_required', 'requested', 'approved', 'declined'].includes(row.wehouse_management_status) ||
      (row.management_updated_at != null && (typeof row.management_updated_at !== 'string' || !Number.isFinite(Date.parse(row.management_updated_at)))) ||
      (row.management_updated_at && (!row.management_mode || !row.wehouse_management_status)))
    throw new Error('Property management details could not be confirmed');
  const ids = new Set<string>();
  for (const assignment of row.assignments) {
    if (!assignment || typeof assignment.assignment_id !== 'string' || !assignment.assignment_id || ids.has(assignment.assignment_id) ||
        typeof assignment.user_id !== 'string' || !assignment.user_id || !['owner', 'manager'].includes(assignment.role) ||
        !['invited', 'active', 'revoked', 'declined'].includes(assignment.status) ||
        (assignment.name != null && typeof assignment.name !== 'string') ||
        (assignment.username != null && typeof assignment.username !== 'string') ||
        (assignment.access_level != null && !['operations', 'full_hosting'].includes(assignment.access_level)))
      throw new Error('Property management team could not be confirmed');
    ids.add(assignment.assignment_id);
  }
  return row;
}

export function parseHostArrivalReceipt(value: unknown, reservationId: string) {
  const row = value as { id?: unknown; status?: unknown; occupancy_started_at?: unknown } | null;
  if (!row || row.id !== reservationId || row.status !== 'occupied' ||
      typeof row.occupancy_started_at !== 'string' || !Number.isFinite(Date.parse(row.occupancy_started_at)))
    throw new Error('Arrival confirmation could not be verified. Refresh this reservation before retrying.');
  return row;
}
