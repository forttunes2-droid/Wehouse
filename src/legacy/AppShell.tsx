// ═══════════════════════════════════════════════════════════════
// RESPONSIVE APP SHELL
// Desktop: Sidebar (left) + Top Header + Main Content
// Tablet: Collapsible sidebar or top nav
// Mobile: Bottom nav (current behavior)
// ═══════════════════════════════════════════════════════════════

import { useState, useMemo } from 'react';
import type { ReactNode } from 'react';
import type { NavPage } from '@/types/nav';

interface NavItem {
  id: NavPage;
  label: string;
  icon: (active: boolean) => ReactNode;
  badge?: number;
}

interface AppShellProps {
  children: ReactNode;
  navItems: NavItem[];
  activePage: NavPage;
  onNavigate: (page: NavPage) => void;
  topBar?: ReactNode;
  userName?: string;
  userRole?: string;
  userAvatar?: string;
  onLogout?: () => void;
}

export default function AppShell({
  children,
  navItems,
  activePage,
  onNavigate,
  topBar,
  userName,
  userRole,
  userAvatar,
  onLogout,
}: AppShellProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Check if we're on desktop
  const isDesktop = typeof window !== 'undefined' && window.innerWidth >= 1024;

  const initials = (userName || 'U').charAt(0).toUpperCase();

  // Filter nav items to only those that should show in sidebar/bottom nav
  const visibleNavItems = useMemo(() => navItems, [navItems]);

  return (
    <div className="min-h-[100dvh] bg-[#0A0A0F] flex">
      {/* ═══ DESKTOP SIDEBAR (≥1024px) ═══ */}
      <aside
        className={`
          hidden lg:flex flex-col fixed left-0 top-0 h-screen
          bg-[#08080C] border-r border-white/[0.04]
          transition-all duration-300 z-40
          ${sidebarCollapsed ? 'w-[72px]' : 'w-[240px]'}
        `}
      >
        {/* Logo */}
        <div className="h-16 flex items-center px-4 border-b border-white/[0.04]">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-violet-700 flex items-center justify-center flex-shrink-0">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <polyline points="9 22 9 12 15 12 15 22" />
            </svg>
          </div>
          {!sidebarCollapsed && (
            <span className="ml-3 text-sm font-bold text-white whitespace-nowrap">WeHouse</span>
          )}
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="ml-auto w-6 h-6 rounded-md bg-[#1A1A24] flex items-center justify-center text-[#5C5E72] hover:text-white transition-colors flex-shrink-0"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d={sidebarCollapsed ? "M9 18l6-6-6-6" : "M15 18l-6-6 6-6"} />
            </svg>
          </button>
        </div>

        {/* Nav Items */}
        <nav className="flex-1 py-3 px-2 space-y-1 overflow-y-auto scrollbar-thin">
          {visibleNavItems.map(item => {
            const isActive = activePage === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onNavigate(item.id)}
                className={`
                  w-full flex items-center gap-3 px-3 h-10 rounded-xl transition-all
                  ${isActive
                    ? 'bg-violet-500/10 text-violet-400 border border-violet-500/20'
                    : 'text-[#8A8B9C] hover:text-white hover:bg-white/[0.03]'
                  }
                `}
                title={sidebarCollapsed ? item.label : undefined}
              >
                <span className="flex-shrink-0">{item.icon(isActive)}</span>
                {!sidebarCollapsed && (
                  <>
                    <span className="text-[13px] font-medium whitespace-nowrap flex-1 text-left">{item.label}</span>
                    {item.badge ? (
                      <span className="w-5 h-5 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center flex-shrink-0">
                        {item.badge > 9 ? '9+' : item.badge}
                      </span>
                    ) : null}
                  </>
                )}
                {sidebarCollapsed && item.badge ? (
                  <span className="absolute top-1 right-1 w-3.5 h-3.5 rounded-full bg-red-500 text-white text-[7px] font-bold flex items-center justify-center">
                    {item.badge > 9 ? '9' : item.badge}
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>

        {/* User section at bottom */}
        <div className="p-3 border-t border-white/[0.04]">
          <div className={`flex items-center gap-3 ${sidebarCollapsed ? 'justify-center' : ''}`}>
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-violet-700 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
              {userAvatar ? (
                <img src={userAvatar} alt="" className="w-full h-full rounded-full object-cover" />
              ) : (
                initials
              )}
            </div>
            {!sidebarCollapsed && (
              <div className="flex-1 min-w-0">
                <p className="text-xs text-white font-medium truncate">{userName || 'User'}</p>
                <p className="text-[9px] text-[#5C5E72] capitalize">{userRole || 'User'}</p>
              </div>
            )}
            {!sidebarCollapsed && onLogout && (
              <button onClick={onLogout} className="text-[#5C5E72] hover:text-red-400 transition-colors flex-shrink-0" title="Logout">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </aside>

      {/* ═══ MAIN CONTENT AREA ═══ */}
      <div className={`
        flex-1 flex flex-col min-h-[100dvh]
        lg:ml-[240px] transition-all duration-300
        ${sidebarCollapsed ? 'lg:!ml-[72px]' : ''}
      `}>
        {/* Top Header Bar — Desktop only */}
        <header className="hidden lg:flex items-center justify-between h-16 px-6 border-b border-white/[0.04] bg-[#0A0A0F]/80 backdrop-blur-xl sticky top-0 z-30">
          <div className="flex items-center gap-4">
            {/* Breadcrumb showing current page */}
            <div className="flex items-center gap-2 text-[13px]">
              <span className="text-[#5C5E72]">WeHouse</span>
              <span className="text-[#2A2A3A]">/</span>
              <span className="text-white font-medium capitalize">
                {activePage.replace(/_/g, ' ')}
              </span>
            </div>
          </div>

          {/* Right side actions */}
          <div className="flex items-center gap-3">
            {topBar}
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 page-transition">
          {children}
        </main>
      </div>

      {/* ═══ MOILE/TABLET: Bottom Nav (keep existing) ═══ */}
      {/* This is rendered separately in App.tsx to maintain existing mobile behavior */}

      {/* ═══ MOBILE: Top bar with hamburger for tablet ═══ */}
      <div className="lg:hidden">
        {/* Mobile menu overlay */}
        {mobileMenuOpen && (
          <div className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm" onClick={() => setMobileMenuOpen(false)}>
            <div className="absolute right-0 top-0 h-full w-[280px] bg-[#0A0A0F] border-l border-white/[0.04] p-4" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-6">
                <span className="text-sm font-bold text-white">Menu</span>
                <button onClick={() => setMobileMenuOpen(false)} className="w-8 h-8 rounded-lg bg-[#1A1A24] flex items-center justify-center text-[#5C5E72]">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <nav className="space-y-1">
                {visibleNavItems.map(item => {
                  const isActive = activePage === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => { onNavigate(item.id); setMobileMenuOpen(false); }}
                      className={`w-full flex items-center gap-3 px-3 h-11 rounded-xl transition-all ${
                        isActive ? 'bg-violet-500/10 text-violet-400' : 'text-[#8A8B9C] hover:text-white hover:bg-white/[0.03]'
                      }`}
                    >
                      {item.icon(isActive)}
                      <span className="text-sm font-medium">{item.label}</span>
                      {item.badge ? (
                        <span className="ml-auto w-5 h-5 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">
                          {item.badge > 9 ? '9+' : item.badge}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </nav>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
