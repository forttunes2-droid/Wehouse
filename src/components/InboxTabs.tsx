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
    <div className="grid grid-cols-2 border-b border-white/[.07]" aria-label="Inbox views">
      {tabs.map(({ id, label, count }) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          aria-current={value === id ? "page" : undefined}
          className={`relative min-h-12 text-xs font-semibold ${value === id ? "text-white" : "text-[#747A8B]"}`}
        >
          <span>{label}</span>
          {count > 0 && (
            <span className="ml-2 inline-grid h-5 min-w-5 place-items-center rounded-full bg-violet-500 px-1 text-[8px] font-bold text-white">
              {count > 99 ? "99+" : count}
            </span>
          )}
          {value === id && <span className="absolute inset-x-8 bottom-0 h-0.5 rounded-full bg-violet-400" />}
        </button>
      ))}
    </div>
  );
}
