export default function WorkerTrustBadge({ trusted = false }: { trusted?: boolean }) {
  const label = trusted ? 'WeHouse Trusted' : 'WeHouse Reviewed';
  return (
    <span
      title={trusted ? 'Earned from eligible WeHouse performance and reviews' : 'Professional evidence reviewed by WeHouse'}
      className="inline-flex shrink-0 items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-300"
    >
      <span aria-hidden="true">✓</span>
      {label}
    </span>
  );
}
