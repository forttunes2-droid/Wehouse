import BackButton from '@/components/BackButton';

export default function ActivityHeader({ onBack, className = '' }: {
  onBack: () => void; className?: string;
}) {
  return <header className={`mb-4 flex items-center gap-3 border-b border-[var(--wh-border-subtle)] pb-3 ${className}`}>
    <BackButton onClick={onBack} ariaLabel="Back" className="!ml-0 !h-11 !w-11 shrink-0" />
    <h2 className="min-w-0 text-lg font-semibold leading-6 text-[var(--wh-text)]">Activity</h2>
  </header>;
}
