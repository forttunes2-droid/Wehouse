import type { ReactNode } from 'react';
import type { NavPage } from '@/types/nav';

export interface DesktopNavItem { id: NavPage; label: string; icon: (active: boolean) => ReactNode; badge?: number; }
function icon(path: string) { return (active: boolean) => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={active ? '#A78BFA' : '#8A8B9C'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={path} /></svg>; }
const DASHBOARD = icon('M4 5h6v6H4z;14 5h6v6h-6z;4 15h6v4H4z;14 15h6v4h-6z');
const MESSAGES = icon('M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z');
const ACCOUNT = icon('M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2;12 3a4 4 0 0 1 0 8 4 4 0 0 1 0-8z');
const SEARCH = icon('M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z');
const SAVED = icon('M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z');
function badge(unreadCount: number) { return unreadCount > 0 ? unreadCount : undefined; }

// Creator, Admin and Worker already expose Account in their workspace header.
// Keep only one Account entry point instead of rendering the same destination twice.
export function getCreatorNav(): DesktopNavItem[] { return [{ id:'creator', label:'Creator', icon:DASHBOARD }]; }
export function getAdminNav(): DesktopNavItem[] { return [{ id:'admin', label:'Admin', icon:DASHBOARD }]; }
export function getWorkerNav(): DesktopNavItem[] { return [{ id:'worker_dashboard', label:'Worker', icon:DASHBOARD }]; }

// Staff has no duplicate header Account. Property Partner now uses the shared Account entry only.
export function getStaffNav(): DesktopNavItem[] { return [{ id:'staff_dashboard', label:'Staff Workspace', icon:DASHBOARD }, { id:'profile', label:'Account', icon:ACCOUNT }]; }
export function getPartnerNav(): DesktopNavItem[] { return [{ id:'property_partner', label:'Property Partner', icon:DASHBOARD }, { id:'profile', label:'Account', icon:ACCOUNT }]; }

export function getUserNav(unreadCount = 0): DesktopNavItem[] { return [{ id:'home', label:'Home', icon:DASHBOARD }, { id:'search', label:'Explore', icon:SEARCH }, { id:'saved', label:'Saved', icon:SAVED }, { id:'messages', label:'Messages', icon:MESSAGES, badge:badge(unreadCount) }, { id:'profile', label:'Account', icon:ACCOUNT }]; }
export function getNavForRole(role: string, unreadCount = 0): DesktopNavItem[] {
  switch (role) {
    case 'creator': return getCreatorNav();
    case 'admin': return getAdminNav();
    case 'staff': return getStaffNav();
    case 'worker': return getWorkerNav();
    case 'property_partner': return getPartnerNav();
    default: return getUserNav(unreadCount);
  }
}
