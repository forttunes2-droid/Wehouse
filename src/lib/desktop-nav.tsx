// ═══════════════════════════════════════════════════════════════
// DESKTOP SIDEBAR NAVIGATION ITEMS — per role
// Each role gets their own sidebar nav items for desktop layout
// ═══════════════════════════════════════════════════════════════

import type { ReactNode } from 'react';
import type { NavPage } from '@/types/nav';

export interface DesktopNavItem {
  id: NavPage;
  label: string;
  icon: (active: boolean) => ReactNode;
  badge?: number;
}

// SVG icon helper
function icon(path: string) {
  return (active: boolean) => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={active ? '#A78BFA' : '#8A8B9C'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={path} />
    </svg>
  );
}

function icon2(p1: string, p2: string) {
  return (active: boolean) => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={active ? '#A78BFA' : '#8A8B9C'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={p1} /><path d={p2} />
    </svg>
  );
}

// ─── CREATOR NAV ───
// Messages removed per Stage 3.3: communication management belongs in Management
export function getCreatorNav(_unreadCount: number = 0): DesktopNavItem[] {
  return [
    { id: 'home', label: 'Home', icon: icon('M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z;9 22 9 12 15 12 15 22') },
    { id: 'creator', label: 'Dashboard', icon: icon2('M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', '9 22 9 12 15 12 15 22') },
    { id: 'management', label: 'Management', icon: icon('M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z') },
    { id: 'analytics', label: 'Analytics', icon: icon('M18 20V10M12 20V4M6 20v-6') },
    { id: 'profile', label: 'Account', icon: icon('M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2;12 3a4 4 0 0 1 0 8 4 4 0 0 1 0-8z') },
  ];
}

// ─── ADMIN NAV ───
export function getAdminNav(unreadCount: number = 0): DesktopNavItem[] {
  return [
    { id: 'home', label: 'Home', icon: icon('M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z;9 22 9 12 15 12 15 22') },
    { id: 'admin', label: 'Dashboard', icon: icon('M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z;9 22 9 12 15 12 15 22') },
    { id: 'management', label: 'Management', icon: icon('M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z') },
    { id: 'analytics', label: 'Analytics', icon: icon('M18 20V10M12 20V4M6 20v-6') },
    { id: 'messages', label: 'Messages', icon: icon('M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'), badge: unreadCount > 0 ? unreadCount : undefined },
    { id: 'profile', label: 'Account', icon: icon('M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2;12 3a4 4 0 0 1 0 8 4 4 0 0 1 0-8z') },
  ];
}

// ─── STAFF NAV ───
export function getStaffNav(unreadCount: number = 0): DesktopNavItem[] {
  return [
    { id: 'home', label: 'Home', icon: icon('M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z;9 22 9 12 15 12 15 22') },
    { id: 'staff_dashboard', label: 'Staff Hub', icon: icon('M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2;9 11V9a4 4 0 0 1 4-4h0a4 4 0 0 1 4 4v2') },
    { id: 'management', label: 'Management', icon: icon('M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z') },
    { id: 'messages', label: 'Messages', icon: icon('M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'), badge: unreadCount > 0 ? unreadCount : undefined },
    { id: 'profile', label: 'Account', icon: icon('M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2;12 3a4 4 0 0 1 0 8 4 4 0 0 1 0-8z') },
  ];
}

// ─── WORKER NAV ───
export function getWorkerNav(unreadCount: number = 0): DesktopNavItem[] {
  return [
    { id: 'home', label: 'Home', icon: icon('M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z;9 22 9 12 15 12 15 22') },
    { id: 'worker_dashboard', label: 'Dashboard', icon: icon('M13 2L3 14h9l-1 8 10-12h-9l1-8z') },
    { id: 'jobs', label: 'Jobs', icon: icon('M20 7h-4V4c0-1.103-.897-2-2-2h-4c-1.103 0-2 .897-2 2v3H4c-1.103 0-2 .897-2 2v11c0 1.103.897 2 2 2h16c1.103 0 2-.897 2-2V9c0-1.103-.897-2-2-2z') },
    { id: 'calendar', label: 'Calendar', icon: icon('M16 2v4;8 2v4;4 8h16;M4 6h16v14H4z') },
    { id: 'messages', label: 'Messages', icon: icon('M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'), badge: unreadCount > 0 ? unreadCount : undefined },
    { id: 'profile', label: 'Account', icon: icon('M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2;12 3a4 4 0 0 1 0 8 4 4 0 0 1 0-8z') },
  ];
}

// ─── PROPERTY PARTNER NAV ───
export function getPartnerNav(unreadCount: number = 0): DesktopNavItem[] {
  return [
    { id: 'home', label: 'Home', icon: icon('M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z;9 22 9 12 15 12 15 22') },
    { id: 'property_partner', label: 'Properties', icon: icon('M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z;9 22 9 12 15 12 15 22') },
    { id: 'messages', label: 'Messages', icon: icon('M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'), badge: unreadCount > 0 ? unreadCount : undefined },
    { id: 'profile', label: 'Account', icon: icon('M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2;12 3a4 4 0 0 1 0 8 4 4 0 0 1 0-8z') },
  ];
}

// ─── USER NAV ───
export function getUserNav(unreadCount: number = 0): DesktopNavItem[] {
  return [
    { id: 'home', label: 'Home', icon: icon('M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z;9 22 9 12 15 12 15 22') },
    { id: 'explore', label: 'Explore', icon: icon('M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z') },
    { id: 'search', label: 'Search', icon: icon('M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z') },
    { id: 'saved', label: 'Saved', icon: icon('M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z') },
    { id: 'messages', label: 'Messages', icon: icon('M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'), badge: unreadCount > 0 ? unreadCount : undefined },
    { id: 'profile', label: 'Account', icon: icon('M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2;12 3a4 4 0 0 1 0 8 4 4 0 0 1 0-8z') },
  ];
}

// ─── GET NAV FOR ROLE ───
export function getNavForRole(role: string, unreadCount: number = 0): DesktopNavItem[] {
  switch (role) {
    case 'creator':
    case 'creator_admin': return getCreatorNav(unreadCount);
    case 'admin': return getAdminNav(unreadCount);
    case 'staff': return getStaffNav(unreadCount);
    case 'worker': return getWorkerNav(unreadCount);
    case 'property_partner': return getPartnerNav(unreadCount);
    default: return getUserNav(unreadCount);
  }
}
