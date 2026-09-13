import GoldTickBadge from '@/components/GoldTickBadge';

export default function WorkerProBadge({ compact = false }: { compact?: boolean }) {
  return (
    <span
      aria-label="WeHouse Pro subscriber"
      title="WeHouse Pro · optional monthly professional tools"
      className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-300/25 bg-amber-300/10 px-1.5 py-0.5 text-[8px] font-extrabold tracking-[.08em] text-amber-200"
    >
      <GoldTickBadge size="sm" title="WeHouse Pro" />
      {!compact && <span>PRO</span>}
    </span>
  );
}
