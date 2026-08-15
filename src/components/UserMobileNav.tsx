import type { NavPage } from '@/types/nav';
import type { DesktopNavItem } from '@/lib/desktop-nav';

type Props = { items: DesktopNavItem[]; activePage: NavPage; onNavigate: (page: NavPage) => void; };

const FULL_SCREEN_USER_PAGES = new Set<NavPage>(['chat','profile_edit','privacy','security','hotel_booking','hotel_reservation','payment_return']);
export function userMobileNavVisible(page: NavPage) { return !FULL_SCREEN_USER_PAGES.has(page); }

function isActive(item: DesktopNavItem, page: NavPage) {
  if (item.id === 'home') return page === 'home';
  if (item.id === 'explore') return ['explore','search','worker_discovery','worker_categories','hotels','hotel_detail','roommate'].includes(page);
  if (item.id === 'saved') return page === 'saved';
  if (item.id === 'messages') return page === 'messages' || page === 'chat';
  if (item.id === 'profile') return ['profile','account','profile_edit','privacy','security'].includes(page);
  return item.id === page;
}

export default function UserMobileNav({ items, activePage, onNavigate }: Props) {
  if (!userMobileNavVisible(activePage)) return null;
  return <><style>{'.bottom-nav{display:none!important}'}</style><nav className="wh-user-bottom-nav fixed inset-x-0 bottom-0 z-[80] border-t border-white/[.08] bg-[#090B12]/97 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden" aria-label="User navigation"><div className="mx-auto flex min-h-16 max-w-lg items-stretch px-1">{items.map(item=>{const active=isActive(item,activePage);return <button key={item.id} type="button" onClick={()=>onNavigate(item.id)} aria-current={active?'page':undefined} className={`relative flex min-w-0 flex-1 flex-col items-center justify-center gap-1 px-1 py-2 text-[9px] font-semibold transition ${active?'text-violet-300':'text-[#6E7485]'}`}><span className={`grid h-7 w-7 place-items-center rounded-xl ${active?'bg-violet-500/10':''}`}>{item.icon(active)}</span><span className="max-w-full truncate">{item.label}</span>{active&&<span className="absolute bottom-1 h-1 w-1 rounded-full bg-violet-400"/>}{item.badge?<span className="absolute right-[18%] top-1 grid h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[8px] font-bold text-white">{item.badge>9?'9+':item.badge}</span>:null}</button>})}</div></nav></>;
}
