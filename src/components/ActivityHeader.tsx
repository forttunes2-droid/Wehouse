import BackButton from '@/components/BackButton';

export default function ActivityHeader({ onBack, className = '' }: {
  onBack: () => void; className?: string;
}) {
  return <header className={`mx-auto mb-4 flex w-full max-w-5xl items-center gap-3 border-b border-[var(--wh-border-subtle)] px-4 pb-3 sm:px-5 lg:px-8 ${className}`}>
    <BackButton onClick={onBack} ariaLabel="Back to Inbox" className="!ml-0 !h-11 !w-11 shrink-0" />
    <h2 className="min-w-0 text-lg font-semibold leading-6 text-[var(--wh-text)]">Activity</h2>
  </header>;
}
