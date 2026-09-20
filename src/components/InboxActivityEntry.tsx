type Props = {
  compact?: boolean;
  unread?: number;
  detail?: string;
  onOpen: () => void;
};

export default function InboxActivityEntry({ compact = true, unread = 0, detail = "Booking, payment and account updates", onOpen }: Props) {
  if (compact) return <button type="button" onClick={onOpen} className="flex min-h-11 items-center gap-2 text-sm font-semibold text-violet-300" aria-label={`Open Activity${unread ? `, ${unread} unread` : ''}`}><ActivityIcon /><span>Activity</span>{unread > 0 && <span className="rounded-full bg-violet-500 px-1.5 py-0.5 text-xs text-white">{unread > 99 ? '99+' : unread}</span>}</button>;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3 border-b border-white/[.06] py-3.5 text-left active:bg-white/[.025]"
      aria-label={`Open Activity${unread ? `, ${unread} unread` : ""}`}
    >
      <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white/[.05] text-violet-300">
        <ActivityIcon />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold">Activity</p>
          {unread > 0 ? <span className="h-2 w-2 rounded-full bg-violet-400" /> : null}
        </div>
        <p className="mt-1 text-xs leading-5 text-[#A1A1AA]">{detail}</p>
      </div>
      {unread > 0 ? (
        <span className="grid min-h-5 min-w-5 place-items-center rounded-full bg-violet-500 px-1.5 text-[8px] font-bold text-white">
          {unread > 99 ? "99+" : unread}
        </span>
      ) : null}
      <span className="text-lg text-[#62697A]">›</span>
    </button>
  );
}

function ActivityIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
      <path d="M10 21h4" />
    </svg>
  );
}
