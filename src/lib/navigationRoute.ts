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
  friendId?: string;
  experienceId?: string;
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
  "account_reviews", "security",
  "devices",
  "creator",
  "admin",
  "staff_dashboard",
  "worker_dashboard",
  "worker_verification",
  "worker_setup",
  "worker_discovery",
  "worker_categories",
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
  friendId: 512,
  experienceId: 36,
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

/** Reuse the existing guest return slot across email/Google/Apple redirects.
 * Only an expiring public activity ID survives; never a booking or recipient. */
export function guestActivityReturn(id:unknown,now=Date.now()):string|null {
  return typeof id==='string'&&/^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(id)
    ?JSON.stringify({kind:'experience',id,expires:now+10*60_000}):null;
}
export function guestReturnDestination(raw:string,now=Date.now()):ParsedNavigationRoute|null {
  const tabs:Record<string,string>={bookings:'my_reservations',inbox:'conversation',account:'profile',roommate:'roommate',services:'worker_discovery'};
  if(tabs[raw])return{page:tabs[raw],params:{}};
  try{const v=JSON.parse(raw);if(v?.kind!=='experience'||!Number.isFinite(v.expires)||v.expires<=now||v.expires>now+10*60_000||!guestActivityReturn(v.id,now))return null;
    return{page:'worker_discovery',params:{experienceId:v.id}};
  }catch{return null;}
}
