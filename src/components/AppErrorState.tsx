import BrandIdentity from '@/components/BrandIdentity';

export default function AppErrorState({ onRetry, loadFailure = false }: {
  onRetry: () => void;
  loadFailure?: boolean;
}) {
  const offline = loadFailure && typeof navigator !== 'undefined' && !navigator.onLine;
  return (
    <main id="main-content" tabIndex={-1} className="flex min-h-[100dvh] items-center justify-center bg-[var(--wh-bg)] px-6 py-10 text-[var(--wh-text)]">
      <div className="w-full max-w-md space-y-5 rounded-3xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-6 text-center sm:p-8">
        <div className="flex justify-center"><BrandIdentity mark className="h-14 w-14" /></div>
        <div role="alert" className="space-y-3">
          <h1 className="text-xl font-semibold">{offline ? 'You’re offline' : loadFailure ? 'This screen couldn’t load' : 'We couldn’t open this screen'}</h1>
          <p className="text-sm leading-6 text-[var(--wh-text-secondary)]">
            {loadFailure
              ? 'Check your connection, then refresh WeHouse. If the app was recently updated, refreshing loads the current version.'
              : 'Refresh WeHouse to try again. If a payment was interrupted, check its status before paying again.'}
          </p>
        </div>
        <button type="button" onClick={onRetry} className="min-h-12 rounded-xl bg-violet-600 px-6 text-sm font-semibold text-white transition-colors hover:bg-violet-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--wh-accent-text)] motion-reduce:transition-none">
          Refresh WeHouse
        </button>
      </div>
    </main>
  );
}
