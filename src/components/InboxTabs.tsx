type InboxView = "chats" | "activity";

type Props = {
  value: InboxView;
  onChange: (value: InboxView) => void;
  chatCount?: number;
  activityCount?: number;
};

export default function InboxTabs({ value, onChange, chatCount = 0, activityCount = 0 }: Props) {
  const tabs: Array<{ id: InboxView; label: string; count: number }> = [
    { id: "chats", label: "Chats", count: chatCount },
    { id: "activity", label: "Activity", count: activityCount },
  ];

  return (
    <div
      className="grid grid-cols-2 gap-1 rounded-2xl border border-white/[.06] bg-[#0D1017] p-1"
      aria-label="Inbox views"
    >
      {tabs.map(({ id, label, count }) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          aria-current={value === id ? "page" : undefined}
          className={`relative min-h-11 rounded-xl text-xs font-semibold transition ${value === id ? "bg-violet-500 text-white shadow-[0_8px_24px_rgba(139,92,246,.18)]" : "text-[#747A8B] active:bg-white/[.035]"}`}
        >
          <span>{label}</span>
          {count > 0 && (
            <span className={`ml-2 inline-grid h-5 min-w-5 place-items-center rounded-full px-1 text-[8px] font-bold ${value === id ? "bg-white/[.18] text-white" : "bg-violet-500 text-white"}`}>
              {count > 99 ? "99+" : count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
