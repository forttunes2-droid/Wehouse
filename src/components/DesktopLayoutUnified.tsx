import { useState } from 'react';
import type { ReactNode } from 'react';
import UserMobileNav, { userMobileNavVisible } from '@/components/UserMobileNav';
import type { NavPage } from '@/types/nav';
import type { DesktopNavItem } from '@/lib/desktop-nav';

type Props = { children: ReactNode; navItems: DesktopNavItem[]; activePage: NavPage; onNavigate: (page: NavPage) => void; userName?: string; userRole?: string; userAvatar?: string; onLogout?: () => void; };

const ROOT_PAGES = new Set<NavPage>([
  'home','explore','search','saved','messages','profile','roommate','hotels','hotel_detail','worker_discovery','worker_categories',
  'creator','admin','staff_dashboard','worker_dashboard','property_partner',
]);
const OWN_MOBILE_BACK = new Set<NavPage>([
  'privacy_policy','terms_of_service','profile_edit','privacy','security','detail','hotel_booking','hotel_reservation','my_bookings','my_reservations','worker_verification','worker_setup','new_listing','payment_return',
]);
const OPERATIONAL_ROLES = new Set(['creator','admin','staff','worker','property_partner']);

function userDesktopItemActive(item: DesktopNavItem, page: NavPage) {
  if (item.id === 'explore') return ['explore','search','worker_discovery','worker_categories','hotels','hotel_detail','roommate'].includes(page);
  if (item.id === 'messages') return page === 'messages' || page === 'chat';
  if (item.id === 'profile') return ['profile','account','profile_edit','privacy','security'].includes(page);
  return item.id === page;
}

export default function DesktopLayoutUnified({ children, navItems, activePage, onNavigate, userName, userRole, userAvatar }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const role = userRole || 'user';
  const operational = OPERATIONAL_ROLES.has(role);
  const userMobileNav = role === 'user' && userMobileNavVisible(activePage);
  const showBack = !ROOT_PAGES.has(activePage);
  const showMobileBack = showBack && !OWN_MOBILE_BACK.has(activePage);
  const initials = (userName || 'U').charAt(0).toUpperCase();
  function back(){ if(window.history.length>1)window.history.back();else onNavigate(operational?roleRoot(role):'home'); }
  return <div className="min-h-[100dvh] min-w-0 bg-[#080A0F] text-white">
    {!operational&&<aside className={`fixed left-0 top-0 z-40 hidden h-screen flex-col border-r border-white/[.05] bg-[#080A0F] transition-all duration-300 lg:flex ${collapsed?'w-[72px]':'w-[240px]'}`}><div className="flex h-16 items-center border-b border-white/[.05] px-4"><button onClick={()=>onNavigate('home')} className="flex min-w-0 items-center" aria-label="WeHouse home"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-violet-500 text-white shadow-lg shadow-violet-500/10"><HomeIcon/></span>{!collapsed&&<span className="ml-3 truncate text-sm font-bold tracking-tight">WeHouse</span>}</button><button onClick={()=>setCollapsed(value=>!value)} className="ml-auto grid h-8 w-8 place-items-center rounded-xl border border-white/[.06] bg-white/[.025] text-[#777D8F] hover:text-white" aria-label={collapsed?'Expand navigation':'Collapse navigation'}>{collapsed?'›':'‹'}</button></div><nav className="flex-1 space-y-1 overflow-y-auto px-2 py-3">{navItems.map(item=>{const active=userDesktopItemActive(item,activePage);return <button key={item.id} onClick={()=>onNavigate(item.id)} title={collapsed?item.label:undefined} aria-current={active?'page':undefined} className={`relative flex h-11 w-full items-center gap-3 rounded-xl px-3 transition ${active?'border border-violet-500/20 bg-violet-500/10 text-violet-300':'text-[#858A9B] hover:bg-white/[.035] hover:text-white'}`}><span className="shrink-0">{item.icon(active)}</span>{!collapsed&&<span className="min-w-0 flex-1 truncate text-left text-[12px] font-semibold">{item.label}</span>}{!collapsed&&item.badge?<span className="grid h-5 min-w-5 place-items-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">{item.badge>9?'9+':item.badge}</span>:null}</button>})}</nav><div className="border-t border-white/[.05] p-3"><div className={`flex items-center gap-3 ${collapsed?'justify-center':''}`}><div className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-xl bg-[#151923] text-xs font-bold text-white">{userAvatar?<img src={userAvatar} alt="" className="h-full w-full object-cover"/>:initials}</div>{!collapsed&&<div className="min-w-0"><p className="truncate text-xs font-semibold">{userName||'WeHouse user'}</p><p className="mt-0.5 truncate text-[9px] capitalize text-[#666C7E]">{role.replace(/_/g,' ')}</p></div>}</div></div></aside>}
    <div className={`${!operational?`lg:ml-[240px] ${collapsed?'lg:!ml-[72px]':''}`:''} min-h-[100dvh] min-w-0 transition-all duration-300`}>
      {showBack&&<div className={`sticky top-0 z-[55] border-b border-white/[.05] bg-[#080A0F]/95 px-4 py-2 backdrop-blur-xl sm:px-5 lg:px-8 ${showMobileBack?'':'hidden lg:block'}`}><div className="mx-auto flex min-h-10 max-w-7xl items-center justify-between gap-3"><button onClick={back} className="flex min-h-9 items-center gap-2 rounded-xl border border-white/[.07] bg-white/[.025] px-3 text-[10px] font-semibold text-[#A8ADBB] hover:bg-white/[.04] hover:text-white"><span>←</span><span>Back</span></button><div className="flex items-center gap-2 text-[10px] text-[#676D7E]"><span className="font-bold text-[#AAB0BE]">WeHouse</span><span>/</span><span className="capitalize">{activePage.replace(/_/g,' ')}</span></div></div></div>}
      {!showBack&&!operational&&<header className="sticky top-0 z-30 hidden h-14 items-center justify-between border-b border-white/[.05] bg-[#080A0F]/92 px-6 backdrop-blur-xl lg:flex"><div className="text-[12px] font-semibold text-[#AAB0BE]">WeHouse</div><div className="text-[10px] capitalize text-[#666C7E]">{activePage.replace(/_/g,' ')}</div></header>}
      <main data-desktop-content-root className={`min-w-0 ${userMobileNav?'pb-[calc(4.5rem+env(safe-area-inset-bottom))] lg:pb-0':''}`}>{children}</main>
    </div>
    {role==='user'&&<UserMobileNav items={navItems} activePage={activePage} onNavigate={onNavigate}/>} 
  </div>;
}
function roleRoot(role:string):NavPage{if(role==='creator')return'creator';if(role==='admin')return'admin';if(role==='staff')return'staff_dashboard';if(role==='worker')return'worker_dashboard';if(role==='property_partner')return'property_partner';return'home'}
function HomeIcon(){return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10.5V20h13v-9.5"/><path d="M9.5 20v-5h5v5"/></svg>}
