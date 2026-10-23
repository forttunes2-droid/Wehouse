import { propertyRecordKey } from './propertyNavigation';
export type BookingActivityKind = 'apartments' | 'hotels' | 'services';
export type InternalDestination = { operation: 'properties' | 'bookings' | 'workers' | 'security' | 'finance'; id?: string; bookingKind?: BookingActivityKind };
/** A typed destination is a navigation hint. The destination RPC still checks
 * the current actor, workspace grant and coverage before exposing any record. */
export function internalActivityDestination(page: string, id?: string): InternalDestination | null {
  const route = page.toLowerCase().replace(/-/g, '_');
  if (route === 'hotel_detail') return { operation: 'properties', ...(id ? { id: propertyRecordKey('hotel', id) } : {}) };
  if (['detail', 'listing_detail'].includes(route)) return { operation: 'properties', ...(id ? { id: propertyRecordKey('listing', id) } : {}) };
  if (['inspection', 'property_inspection'].includes(route)) return { operation: 'properties', ...(id ? { id: propertyRecordKey('inspection', id) } : {}) };
  if (route === 'operations_properties' || route === 'property_operations') return { operation: 'properties', ...(id ? { id } : {}) };
  if (route === 'hotel_booking') return { operation: 'bookings', bookingKind: 'hotels', ...(id ? { id } : {}) };
  if (route === 'service_booking') return { operation: 'bookings', bookingKind: 'services', ...(id ? { id } : {}) };
  if (['my_reservations', 'my_bookings', 'reservation', 'property_booking', 'operations_bookings', 'booking'].includes(route)) return { operation: 'bookings', ...(id ? { id } : {}) };
  if (['worker', 'worker_operations', 'operations_workers', 'worker_profile', 'worker_verification'].includes(route)) return { operation: 'workers', ...(id ? { id } : {}) };
  if (['security', 'security_operations'].includes(route)) return { operation: 'security', ...(id ? { id } : {}) };
  if (['finance', 'finance_operations', 'operations_finance', 'payouts'].includes(route)) return { operation: 'finance', ...(id ? { id } : {}) };
  return null;
}
