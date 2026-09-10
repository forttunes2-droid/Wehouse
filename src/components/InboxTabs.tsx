type InboxView = "chats" | "activity";

type Props = {
  value: InboxView;
  onChange: (value: InboxView) => void;
  chatCount?: number;
  activityCount?: number;
};

export default function InboxTabs({ value, onChange, chatCount = 0, activityCount = 0 }: Props) {
  const tabs: Array<{ id: InboxView; label: string; count: number }> = [
    { id: "chats", label: "Messages", count: chatCount },
    { id: "activity", label: "Activity", count: activityCount },
  ];

  return (
    <nav
      className="grid grid-cols-2 border-b border-white/[.07]"
      aria-label="Inbox views"
      role="tablist"
    >
      {tabs.map(({ id, label, count }) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          role="tab"
          aria-selected={value === id}
          className={`relative min-h-12 text-xs font-semibold transition ${value === id ? "text-white after:absolute after:inset-x-8 after:bottom-0 after:h-0.5 after:rounded-full after:bg-violet-400" : "text-[#747A8B] active:text-[#A8ADBA]"}`}
        >
          <span>{label}</span>
          {count > 0 && (
            <span className="ml-2 inline-grid h-5 min-w-5 place-items-center rounded-full bg-violet-500 px-1 text-[8px] font-bold text-white">
              {count > 99 ? "99+" : count}
            </span>
          )}
        </button>
      ))}
    </nav>
  );
}
