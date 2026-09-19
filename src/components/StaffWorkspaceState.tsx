import BackButton from '@/components/BackButton';

export default function StaffWorkspaceState({ title, text, onAccount, onLogout, onRetry }: {
  title: string;
  text: string;
  onAccount?: () => void;
  onLogout: () => void;
  onRetry?: () => void;
}) {
  return <main className="min-h-[100dvh] bg-[#0E0C12] px-5 py-8 text-white sm:px-8">
    <div className="mx-auto w-full max-w-xl">
      <header>
        <p className="text-xs font-semibold text-violet-300">WeHouse Team</p>
        <div className="mt-4 flex items-center gap-2">
          {onAccount && <BackButton onClick={onAccount} ariaLabel="Back to Account" />}
          <h1 className="text-xl font-semibold">{title}</h1>
        </div>
        <p className="mt-3 text-sm leading-6 text-[#AAA3B3]" role={onRetry ? 'alert' : 'status'}>{text}</p>
      </header>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        {onRetry && <button onClick={onRetry} className="min-h-11 rounded-xl bg-violet-600 px-5 text-sm font-semibold hover:bg-violet-500">Try again</button>}
        {onAccount && <button onClick={onAccount} className="min-h-11 px-3 text-sm text-violet-300 hover:text-white">Account</button>}
        <button onClick={onLogout} className="min-h-11 px-3 text-sm text-[#AAA3B3] hover:text-white">Sign out</button>
      </div>
    </div>
  </main>;
}
