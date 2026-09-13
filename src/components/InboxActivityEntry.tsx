type Props = {
  unread?: number;
  detail?: string;
  onOpen: () => void;
};

export default function InboxActivityEntry({ unread = 0, detail = "Booking, payment and account updates", onOpen }: Props) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3 border-b border-white/[.06] py-3.5 text-left active:bg-white/[.025]"
      aria-label={`Open Activity${unread ? `, ${unread} unread` : ""}`}
    >
      <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-violet-500 text-white shadow-[0_8px_24px_rgba(124,58,237,.18)]">
        <ActivityIcon />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-[12px] font-semibold">Activity</p>
          {unread > 0 ? <span className="h-2 w-2 rounded-full bg-violet-400" /> : null}
        </div>
        <p className="mt-1 truncate text-[9px] text-[#707687]">{detail}</p>
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
