type Props = { compact?: boolean; label?: string; className?: string };

export default function WeHouseLoadingState({ compact = false, label = "Loading WeHouse", className = "" }: Props) {
  return (
    <div
      role="status"
      aria-label={label}
      className={`wh-loading-state flex w-full items-center justify-center ${compact ? "min-h-24" : "min-h-[45vh]"} ${className}`}
    >
      <div className="w-full max-w-xs px-6 text-center">
        <div className="mx-auto grid h-11 w-11 place-items-center rounded-[14px] border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] shadow-sm">
          <span aria-hidden="true" className="h-4 w-4 rounded-full border-2 border-[var(--wh-text-muted)] border-t-violet-400" />
        </div>
        <p className="mt-4 text-xs font-medium text-[var(--wh-text-secondary)]">{label}</p>
        <div aria-hidden="true" className="mx-auto mt-3 h-1 w-28 overflow-hidden rounded-full bg-[var(--wh-interactive)]">
          <span className="block h-full w-1/2 rounded-full bg-violet-400/70 wh-loading-progress" />
        </div>
      </div>
    </div>
  );
}
