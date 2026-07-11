// ═══════════════════════════════════════════════════════════════
// DESKTOP LAYOUT WRAPPER
// Shows sidebar + header on desktop (≥1024px)
// Transparent on mobile/tablet (existing layout preserved)
// ═══════════════════════════════════════════════════════════════

import { useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import type { NavPage } from '@/types/nav';
import type { DesktopNavItem } from '@/lib/desktop-nav';

interface DesktopLayoutProps {
  children: ReactNode;
  navItems: DesktopNavItem[];
  activePage: NavPage;
  onNavigate: (page: NavPage) => void;
  userName?: string;
  userRole?: string;
  userAvatar?: string;
  onLogout?: () => void;
}

export default function DesktopLayout({
  children,
  navItems,
  activePage,
  onNavigate,
  userName,
  userRole,
  userAvatar,
  onLogout,
}: DesktopLayoutProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const check = () => setIsDesktop(window.innerWidth >= 1024);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // On mobile/tablet, just render children directly
  if (!isDesktop) {
    return <>{children}</>;
  }

  const initials = (userName || 'U').charAt(0).toUpperCase();

  return (
    <div className="min-h-[100dvh] bg-[#0A0A0F] flex">
      {/* SIDEBAR */}
      <aside className={`fixed left-0 top-0 h-screen bg-[#08080C] border-r border-white/[0.04] flex flex-col transition-all duration-300 z-40 ${collapsed ? 'w-[72px]' : 'w-[240px]'}`}>
        {/* Logo */}
        <div className="h-16 flex items-center px-4 border-b border-white/[0.04] gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-violet-700 flex items-center justify-center flex-shrink-0">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <polyline points="9 22 9 12 15 12 15 22" />
            </svg>
          </div>
          {!collapsed && <span className="text-sm font-bold text-white">WeHouse</span>}
          <button onClick={() => setCollapsed(!collapsed)} className="ml-auto w-6 h-6 rounded-md bg-[#1A1A24] flex items-center justify-center text-[#5C5E72] hover:text-white flex-shrink-0">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d={collapsed ? "M9 18l6-6-6-6" : "M15 18l-6-6 6-6"} />
            </svg>
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto scrollbar-thin">
          {navItems.map(item => {
            const isActive = activePage === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onNavigate(item.id)}
                className={`w-full flex items-center gap-3 px-3 h-10 rounded-xl transition-all relative ${
                  isActive ? 'bg-violet-500/10 text-violet-400' : 'text-[#8A8B9C] hover:text-white hover:bg-white/[0.03]'
                }`}
                title={collapsed ? item.label : undefined}
              >
                <span className="flex-shrink-0">{item.icon(isActive)}</span>
                {!collapsed && (
                  <>
                    <span className="text-[13px] font-medium whitespace-nowrap flex-1 text-left">{item.label}</span>
                    {item.badge ? (
                      <span className="w-5 h-5 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center flex-shrink-0">{item.badge > 9 ? '9+' : item.badge}</span>
                    ) : null}
                  </>
                )}
              </button>
            );
          })}
        </nav>

        {/* User */}
        <div className="p-3 border-t border-white/[0.04]">
          <div className={`flex items-center gap-3 ${collapsed ? 'justify-center' : ''}`}>
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-violet-700 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
              {userAvatar ? <img src={userAvatar} alt="" className="w-full h-full rounded-full object-cover" /> : initials}
            </div>
            {!collapsed && (
              <>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-white font-medium truncate">{userName || 'User'}</p>
                  <p className="text-[9px] text-[#5C5E72] capitalize">{userRole || 'User'}</p>
                </div>
                {onLogout && (
                  <button onClick={onLogout} className="text-[#5C5E72] hover:text-red-400 transition-colors" title="Logout">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></svg>
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </aside>

      {/* MAIN CONTENT */}
      <div className={`flex-1 flex flex-col min-h-[100dvh] transition-all duration-300 ${collapsed ? 'ml-[72px]' : 'ml-[240px]'}`}>
        {/* Top Header */}
        <header className="h-14 flex items-center justify-between px-6 border-b border-white/[0.04] bg-[#0A0A0F]/80 backdrop-blur-xl sticky top-0 z-30">
          <div className="flex items-center gap-2 text-[13px]">
            <span className="text-[#5C5E72]">WeHouse</span>
            <span className="text-[#2A2A3A]">/</span>
            <span className="text-white font-medium capitalize">{activePage.replace(/_/g, ' ')}</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[11px] text-[#5C5E72] capitalize">{userRole || 'User'}</span>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1">
          {children}
        </main>
      </div>
    </div>
  );
}
