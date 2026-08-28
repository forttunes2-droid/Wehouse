import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { NavPage } from '@/types/nav';
import type { DesktopNavItem } from '@/lib/desktop-nav';

interface Props {
  children: ReactNode;
  navItems: DesktopNavItem[];
  activePage: NavPage;
  onNavigate: (page: NavPage) => void;
  userName?: string;
  userRole?: string;
  userAvatar?: string;
  onLogout?: () => void;
}

type MirroredTab = { label: string; button: HTMLButtonElement };

const ROOT_PAGES = new Set<NavPage>([
  'search',
  'saved',
  'my_reservations',
  'messages',
  'profile',
  'creator',
  'admin',
  'staff_dashboard',
  'worker_dashboard',
  'property_partner',
]);

const OWN_MOBILE_BACK = new Set<NavPage>([
  'roommate',
  'hotels',
  'worker_discovery',
  'worker_categories',
  'privacy_policy',
  'terms_of_service',
  'profile_edit',
  'privacy',
  'security',
  'detail',
  'hotel_detail',
  'hotel_booking',
  'hotel_reservation',
  'my_bookings',
  'my_reservations',
  'worker_verification',
  'worker_setup',
]);

const OPERATIONAL_ROLES = new Set(['creator', 'admin', 'staff', 'worker', 'property_partner']);
const DASHBOARD_OWNS_ACCOUNT = new Set(['creator', 'admin', 'staff', 'worker']);

function isWorkspaceRoot(role: string, page: NavPage) {
  if (role === 'creator') return page === 'creator';
  if (role === 'admin') return page === 'admin';
  if (role === 'staff') return page === 'staff_dashboard';
  if (role === 'worker') return page === 'worker_dashboard';
  if (role === 'property_partner') return page === 'property_partner';
  return false;
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
}: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [workspaceTabs, setWorkspaceTabs] = useState<MirroredTab[]>([]);
  const [activeWorkspaceTab, setActiveWorkspaceTab] = useState('');
  const [moreOpen, setMoreOpen] = useState(false);

  const role = userRole || '';
  const initials = (userName || 'U').charAt(0).toUpperCase();
  const showBack = !ROOT_PAGES.has(activePage);
  const showMobileBack = showBack && !OWN_MOBILE_BACK.has(activePage);
  const operational = OPERATIONAL_ROLES.has(role);
  const workspaceRoot = operational && isWorkspaceRoot(role, activePage);
  const dashboardOwnsAccount = DASHBOARD_OWNS_ACCOUNT.has(role);

  // Creator/Admin/Staff/Worker dashboards already own their Account entry and
  // sign-out surface. Do not mirror those actions again in the outer shell.
  const visibleNavItems = dashboardOwnsAccount
    ? navItems.filter((item) => item.id !== 'profile')
    : navItems;

  function back() {
    if (window.history.length > 1) window.history.back();
    else if (role === 'creator') onNavigate('creator');
    else if (role === 'admin') onNavigate('admin');
    else if (role === 'staff') onNavigate('staff_dashboard');
    else if (role === 'worker') onNavigate('worker_dashboard');
    else if (role === 'property_partner') onNavigate('property_partner');
    else onNavigate('search');
  }

  useEffect(() => {
    setMoreOpen(false);
  }, [activePage]);

  useEffect(() => {
    if (!workspaceRoot) {
      setWorkspaceTabs([]);
      setActiveWorkspaceTab('');
      return;
    }

    const content = document.querySelector('[data-desktop-content-root]') as HTMLElement | null;
    if (!content) return;

    let source: HTMLElement | null = null;
    let classObserver: MutationObserver | undefined;

    const clearSource = () => source?.classList.remove('workspace-primary-rail', 'hidden', 'lg:block');

    const attach = () => {
      const next = content.querySelector('header .scrollbar-hide') as HTMLElement | null;
      if (next === source) return;
      classObserver?.disconnect();
      clearSource();
      source = next;
      if (!source) {
        setWorkspaceTabs([]);
        setActiveWorkspaceTab('');
        return;
      }

      // The workspace owns one navigation model. On phone/tablet the mirrored
      // bottom rail is the primary control; the original header rail remains
      // visible only on desktop so the same tabs are never presented twice.
      source.classList.add('workspace-primary-rail', 'hidden', 'lg:block');
      const buttons = Array.from(source.querySelectorAll(':scope button')).filter(
        (node): node is HTMLButtonElement =>
          node instanceof HTMLButtonElement && Boolean(node.textContent?.trim()),
      );
      setWorkspaceTabs(buttons.map((button) => ({ label: button.textContent!.trim(), button })));

      const sync = () => {
        const selected = buttons.find((button) =>
          ['bg-violet-500', 'bg-violet-500', 'bg-cyan-500', 'bg-violet-500'].some((cls) =>
            button.className.includes(cls),
          ),
        );
        setActiveWorkspaceTab(selected?.textContent?.trim() || '');
      };

      sync();
      classObserver = new MutationObserver(sync);
      buttons.forEach((button) =>
        classObserver!.observe(button, { attributes: true, attributeFilter: ['class'] }),
      );
    };

    attach();
    const structureObserver = new MutationObserver(attach);
    structureObserver.observe(content, { subtree: true, childList: true });

    return () => {
      structureObserver.disconnect();
      classObserver?.disconnect();
      clearSource();
    };
  }, [activePage, workspaceRoot]);

  const mobilePlan = useMemo(() => {
    const by = (name: string) => workspaceTabs.find((tab) => tab.label === name);
    let direct: MirroredTab[] = [];
    let extra: MirroredTab[] = [];

    if (role === 'creator') {
      direct = ['Overview', 'Operations', 'Communications', 'Finance'].map(by).filter(Boolean) as MirroredTab[];
      extra = ['Analytics', 'Settings'].map(by).filter(Boolean) as MirroredTab[];
    } else if (role === 'admin') {
      direct = ['Overview', 'Operations', 'Communications', 'Issues'].map(by).filter(Boolean) as MirroredTab[];
    } else if (role === 'worker') {
      direct = ['Overview', 'Jobs', 'Schedule', 'Finance'].map(by).filter(Boolean) as MirroredTab[];
      extra = ['Professional Profile'].map(by).filter(Boolean) as MirroredTab[];
    } else if (role === 'property_partner') {
      direct = ['Properties', 'Communication', 'Finance'].map(by).filter(Boolean) as MirroredTab[];
    } else if (role === 'staff') {
      direct = workspaceTabs.slice(0, 4);
      extra = workspaceTabs.slice(4);
    }

    return { direct, extra };
  }, [role, workspaceTabs]);

  function openMirrored(tab: MirroredTab) {
    tab.button.click();
    setActiveWorkspaceTab(tab.label);
    setMoreOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  const accountItem = dashboardOwnsAccount ? undefined : navItems.find((item) => item.id === 'profile');
  const showWorkspaceBottom = workspaceRoot && workspaceTabs.length > 0;

  return (
    <div className="flex min-h-[100dvh] min-w-0 bg-[#0A0A0F]">
      <aside
        className={`fixed left-0 top-0 z-40 hidden h-screen flex-col border-r border-white/[.04] bg-[#08080C] transition-all duration-300 lg:flex ${
          collapsed ? 'w-[72px]' : 'w-[240px]'
        }`}
      >
        <div className="flex h-16 items-center border-b border-white/[.04] px-4">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-violet-500 to-violet-700">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <path d="M9 22V12h6v10" />
            </svg>
          </div>
          {!collapsed && <span className="ml-3 whitespace-nowrap text-sm font-bold text-white">WeHouse</span>}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="ml-auto grid h-7 w-7 place-items-center rounded-lg bg-[#1A1A24] text-[#5C5E72] hover:text-white"
            aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
          >
            {collapsed ? '›' : '‹'}
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-2 py-3">
          {visibleNavItems.map((item) => {
            const active = activePage === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onNavigate(item.id)}
                title={collapsed ? item.label : undefined}
                className={`relative flex h-10 w-full items-center gap-3 rounded-xl px-3 ${
                  active
                    ? 'border border-violet-500/20 bg-violet-500/10 text-violet-400'
                    : 'text-[#8A8B9C] hover:bg-white/[.03] hover:text-white'
                }`}
              >
                <span className="shrink-0">{item.icon(active)}</span>
                {!collapsed && (
                  <>
                    <span className="min-w-0 flex-1 truncate text-left text-[13px] font-medium">{item.label}</span>
                    {item.badge ? (
                      <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-red-500 text-[9px] font-bold text-white">
                        {item.badge > 9 ? '9+' : item.badge}
                      </span>
                    ) : null}
                  </>
                )}
              </button>
            );
          })}
        </nav>

        <div className="border-t border-white/[.04] p-3">
          <div className={`flex items-center gap-3 ${collapsed ? 'justify-center' : ''}`}>
            <div className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-violet-500 to-violet-700 text-xs font-bold text-white">
              {userAvatar ? <img src={userAvatar} alt="" className="h-full w-full object-cover" /> : initials}
            </div>
            {!collapsed && (
              <>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-white">{userName || 'User'}</p>
                  <p className="truncate text-[9px] capitalize text-[#5C5E72]">{role || 'User'}</p>
                </div>
                {!dashboardOwnsAccount && role !== 'property_partner' && onLogout && (
                  <button onClick={onLogout} title="Log out" className="text-[#5C5E72] hover:text-red-400">
                    ↪
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </aside>

      <div
        className={`flex min-h-[100dvh] min-w-0 flex-1 flex-col transition-all duration-300 lg:ml-[240px] ${
          collapsed ? 'lg:!ml-[72px]' : ''
        }`}
      >
        <header className="sticky top-0 z-30 hidden h-14 items-center justify-between border-b border-white/[.04] bg-[#0A0A0F]/80 px-6 backdrop-blur-xl lg:flex">
          <div className="flex min-w-0 items-center gap-2 text-[13px]">
            {showBack && (
              <button onClick={back} className="mr-1 rounded-lg border border-white/[.06] px-2 py-1 text-[#8A8B9C] hover:text-white">
                ← Back
              </button>
            )}
            <span className="text-[#5C5E72]">WeHouse</span>
            <span className="text-[#2A2A3A]">/</span>
            <span className="truncate font-medium capitalize text-white">{activePage.replace(/_/g, ' ')}</span>
          </div>
          <span className="text-[11px] capitalize text-[#5C5E72]">{role || 'User'}</span>
        </header>

        {showMobileBack && (
          <div className="border-b border-white/[.05] bg-[#0B0C12] px-4 py-2 lg:hidden">
            <button onClick={back} className="flex min-h-9 items-center gap-2 rounded-xl border border-white/[.07] bg-white/[.025] px-3 text-xs font-medium text-[#A8ABB8]">
              <span>←</span>
              <span>Back</span>
            </button>
          </div>
        )}

        <main
          data-desktop-content-root
          className={`min-w-0 flex-1 ${
            showWorkspaceBottom ? 'pb-[calc(4.5rem+env(safe-area-inset-bottom))] lg:pb-0' : ''
          }`}
        >
          {children}
        </main>
      </div>

      {showWorkspaceBottom && (
        <>
          {moreOpen && (
            <div className="fixed inset-0 z-[69] bg-black/55 lg:hidden" onClick={() => setMoreOpen(false)}>
              <div
                className="absolute inset-x-3 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] rounded-2xl border border-white/[.08] bg-[#11131B] p-2 shadow-2xl"
                onClick={(event) => event.stopPropagation()}
              >
                {mobilePlan.extra.map((tab) => (
                  <button
                    key={tab.label}
                    onClick={() => openMirrored(tab)}
                    className="flex min-h-12 w-full items-center justify-between rounded-xl px-4 text-left text-xs font-semibold text-[#D8DAE3] hover:bg-white/[.04]"
                  >
                    <span>{tab.label}</span>
                    <span className="text-[#626678]">›</span>
                  </button>
                ))}
                {accountItem && (
                  <button
                    onClick={() => {
                      setMoreOpen(false);
                      onNavigate('profile');
                    }}
                    className="flex min-h-12 w-full items-center justify-between rounded-xl px-4 text-left text-xs font-semibold text-[#D8DAE3] hover:bg-white/[.04]"
                  >
                    <span>Account</span>
                    <span className="text-[#626678]">›</span>
                  </button>
                )}
              </div>
            </div>
          )}

          <nav className="fixed inset-x-0 bottom-0 z-[70] border-t border-white/[.08] bg-[#090B12]/96 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden">
            <div className="mx-auto flex min-h-16 max-w-lg items-stretch px-1">
              {mobilePlan.direct.map((tab, index) => {
                const active = activeWorkspaceTab === tab.label;
                const display =
                  index === 0 && tab.label === 'Overview'
                    ? 'Home'
                    : tab.label === 'Property Requests'
                        ? 'Requests'
                        : tab.label === 'My Properties'
                          ? 'Properties'
                          : tab.label === 'Professional Profile'
                            ? 'Profile'
                            : tab.label;
                return (
                  <button
                    key={tab.label}
                    onClick={() => openMirrored(tab)}
                    className={`flex min-w-0 flex-1 flex-col items-center justify-center gap-1 px-1 py-2 text-[9px] font-semibold ${
                      active ? 'text-violet-300' : 'text-[#6E7282]'
                    }`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-violet-400' : 'bg-transparent'}`} />
                    <span className="max-w-full truncate">{display}</span>
                  </button>
                );
              })}
              {(mobilePlan.extra.length > 0 || accountItem) && (
                <button
                  onClick={() => accountItem && mobilePlan.extra.length === 0 ? onNavigate('profile') : setMoreOpen((value) => !value)}
                  className={`flex min-w-0 flex-1 flex-col items-center justify-center gap-1 px-1 py-2 text-[9px] font-semibold ${
                    moreOpen ? 'text-violet-300' : 'text-[#6E7282]'
                  }`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${moreOpen ? 'bg-violet-400' : 'bg-transparent'}`} />
                  <span>{accountItem && mobilePlan.extra.length === 0 ? 'Account' : 'More'}</span>
                </button>
              )}
            </div>
          </nav>
        </>
      )}
    </div>
  );
}
