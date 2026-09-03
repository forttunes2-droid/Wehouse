type Option = { value: string; label: string };

export default function InlineFilterChips({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  ariaLabel: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="overflow-x-auto border-y border-white/[.07] py-3 scrollbar-hide"
    >
      <div className="flex min-w-max gap-2">
        {options.map((option) => {
          const active = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(option.value)}
              className={`min-h-9 rounded-full px-3.5 text-[9px] font-semibold transition ${
                active
                  ? "bg-violet-500 text-white"
                  : "border border-white/[.07] bg-white/[.025] text-[#858B9B]"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
