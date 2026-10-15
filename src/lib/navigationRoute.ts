import type { NavPage } from "@/types/nav";

export type NavigationRouteParams = {
  id?: string;
  hotelId?: string;
  roomId?: string;
  ratePlanId?: string;
  checkIn?: string;
  checkOut?: string;
  conversationId?: string;
  peerId?: string;
  bookingId?: string;
  roommateId?: string;
  category?: string;
  companionId?: string;
};

export type ParsedNavigationRoute = {
  page: string;
  params: NavigationRouteParams;
};

export const RESTORABLE_NAVIGATION_PAGES: NavPage[] = [
  "search",
  "saved",
  "followed_searches",
  "roommate",
  "activity",
  "profile",
  "account",
  "privacy",
  "security",
  "devices",
  "creator",
  "admin",
  "staff_dashboard",
  "worker_dashboard",
  "worker_verification",
  "worker_setup",
  "worker_discovery",
  "worker_categories",
  "new_listing",
  "hotels",
  "detail",
  "hotel_detail",
  "hotel_booking",
  "property_partner",
  "hosting",
  "hotel_operations",
  "my_bookings",
  "my_reservations",
  "conversation",
  "messages",
  "notifications",
  "chat",
  "profile_edit",
  "privacy_policy",
  "terms_of_service",
  "payment_return",
];

const PARAM_LIMITS: Record<keyof NavigationRouteParams, number> = {
  id: 512,
  hotelId: 20,
  roomId: 20,
  ratePlanId: 20,
  checkIn: 10,
  checkOut: 10,
  conversationId: 512,
  peerId: 512,
  bookingId: 512,
  roommateId: 512,
  category: 100,
  companionId: 512,
};

function cleanParams(value: unknown): NavigationRouteParams {
  if (!value || typeof value !== "object") return {};
  const source = value as Record<string, unknown>;
  const params: NavigationRouteParams = {};
  for (const [key, limit] of Object.entries(PARAM_LIMITS) as [keyof NavigationRouteParams, number][]) {
    const item = source[key];
    if (typeof item !== "string") continue;
    const clean = item.trim().slice(0, limit);
    if (clean) params[key] = clean;
  }
  return params;
}

export function parseNavigationRoute(hash: string): ParsedNavigationRoute | null {
  const value = hash.replace(/^#\/?/, "");
  if (!value) return null;
  const separator = value.indexOf("?");
  const page = (separator === -1 ? value : value.slice(0, separator)).trim();
  if (!page || page.includes("/")) return null;
  const search = separator === -1 ? "" : value.slice(separator + 1);
  const query = new URLSearchParams(search);
  const params = cleanParams(Object.fromEntries(query.entries()));
  return { page, params };
}

export function buildNavigationHash(page: string, value?: unknown): string {
  const params = cleanParams(value);
  const query = new URLSearchParams();
  for (const [key, item] of Object.entries(params)) query.set(key, item);
  const suffix = query.toString();
  return `#${page}${suffix ? `?${suffix}` : ""}`;
}

export function parseNavigationRouteParams(value: unknown): NavigationRouteParams {
  return cleanParams(value);
}

export function isRestorableNavigationPage(page: string): page is NavPage {
  return RESTORABLE_NAVIGATION_PAGES.includes(page as NavPage);
}

export function identityEntryRoute(hash: string, roleRoot: string): ParsedNavigationRoute {
  const route = parseNavigationRoute(hash);
  return route && isRestorableNavigationPage(route.page)
    ? route
    : { page: roleRoot, params: {} };
}
