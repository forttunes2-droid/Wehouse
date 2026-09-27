import BackButton from '@/components/BackButton';

export default function ActivityHeader({ onBack, subtitle, className = '' }: {
  onBack: () => void; subtitle: string; className?: string;
}) {
  return <header className={`mb-4 flex items-center gap-3 border-b border-white/[.06] pb-3 ${className}`}>
    <BackButton onClick={onBack} ariaLabel="Back to Inbox" className="!ml-0 !h-11 !w-11 shrink-0" />
    <div className="min-w-0">
      <p className="text-[11px] font-semibold uppercase tracking-[.12em] text-violet-300">Inbox</p>
      <h2 className="mt-0.5 text-lg font-semibold leading-6 text-white">Activity</h2>
      <p className="mt-0.5 text-xs leading-5 text-[#A1A6B5]">{subtitle}</p>
    </div>
  </header>;
}
