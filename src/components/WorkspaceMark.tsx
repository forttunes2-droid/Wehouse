import {
  ArrowLeftRight, Banknote, Bell, BriefcaseBusiness, Building2, CalendarCheck, ClipboardCheck, Crown, FileText, Heart,
  Home, Hotel, LifeBuoy, LogOut, Megaphone, Search, ShieldCheck, Sparkles, SunMoon, UserCheck, UserRound, Users, Wrench,
  type LucideIcon,
} from "lucide-react";
import type { WorkspaceName } from "@/lib/workspacePresentation";

// One icon per thing, used in Account, the workspace switcher and Notifications.
const WORKSPACE_ICONS: Record<WorkspaceName, LucideIcon> = {
  personal: UserRound,
  worker: Wrench,
  property_partner: Building2,
  hosting: Home,
  hotel: Hotel,
  creator: Crown,
  admin: ShieldCheck,
  staff: BriefcaseBusiness,
};

const ACCOUNT_ICONS = {
  switch: ArrowLeftRight, pro: Sparkles, sponsored: Megaphone, help: LifeBuoy, saved: Heart, followed: Search,
  notifications: Bell, appearance: SunMoon, security: ShieldCheck, legal: FileText, signout: LogOut,
  offerServices: Wrench, listProperty: Building2, details: UserRound,
} as const;

const KIND_ICONS: Record<string, LucideIcon> = {
  "Team access": UserCheck, "Followed search": Search, Security: ShieldCheck, Money: Banknote, Inspection: ClipboardCheck,
  Work: Wrench, Property: Building2, Booking: CalendarCheck, Roommates: Users, WeHouse: Bell,
};

export function WorkspaceIcon({ workspace, size = 18 }: { workspace: WorkspaceName; size?: number }) {
  const Icon = WORKSPACE_ICONS[workspace] || BriefcaseBusiness;
  return <Icon size={size} strokeWidth={1.8} aria-hidden="true" />;
}
export function AccountIcon({ name, size = 18 }: { name: keyof typeof ACCOUNT_ICONS; size?: number }) {
  const Icon = ACCOUNT_ICONS[name];
  return <Icon size={size} strokeWidth={1.8} aria-hidden="true" />;
}
export function ActivityKindIcon({ kind, size = 17 }: { kind: string; size?: number }) {
  const Icon = KIND_ICONS[kind] || Bell;
  return <Icon size={size} strokeWidth={1.8} aria-hidden="true" />;
}
