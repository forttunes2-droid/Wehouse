import { useEffect, useState } from 'react';
import { useCreatorAuth } from '@/hooks/useCreatorAuth';

export default function CreatorAuthModal() {
  const {
    showModal,
    needsMfa,
    isLoading,
    error,
    verifySecret,
    verifyMfa,
    dismissRequest,
  } = useCreatorAuth();
  const [creatorSecret, setCreatorSecret] = useState('');
  const [code, setCode] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (!showModal) {
      setCreatorSecret('');
      setCode('');
      setShowPassword(false);
    }
  }, [showModal]);

  useEffect(() => {
    if (needsMfa) setCode('');
  }, [needsMfa]);

  if (!showModal) return null;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (needsMfa) {
      if (!/^\d{6}$/.test(code.trim())) return;
      await verifyMfa(code.trim());
      return;
    }
    if (!creatorSecret) return;
    await verifySecret(creatorSecret);
  }

  return (
    <div className="fixed inset-0 z-[100100] flex items-end justify-center bg-[var(--wh-overlay)] p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <div className="w-full max-w-md rounded-t-3xl border border-[var(--wh-border)] bg-[var(--wh-surface)] p-5 text-[var(--wh-text)] shadow-2xl sm:rounded-3xl sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[9px] font-bold uppercase tracking-[.18em] text-[var(--wh-accent-text)]">Creator protection</p>
            <h2 className="mt-2 text-lg font-bold">{needsMfa ? 'Confirm authenticator' : 'Confirm Creator security'}</h2>
            <p className="mt-2 text-[10px] leading-5 text-[var(--wh-text-secondary)]">
              {needsMfa
                ? 'This Creator account has two-step verification enabled. Enter the current 6-digit authenticator code.'
                : 'Sensitive Creator actions require the separate Creator security password you enrolled. Your normal sign-in password is not used here.'}
            </p>
          </div>
          <button type="button" onClick={dismissRequest} disabled={isLoading} aria-label="Close Creator confirmation" className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-lg text-[var(--wh-text-muted)] hover:bg-[var(--wh-interactive)]">×</button>
        </div>

        <form onSubmit={submit} className="mt-6 space-y-4">
          {needsMfa ? (
            <label className="block">
              <span className="mb-1.5 block text-[10px] font-medium text-[var(--wh-text-secondary)]">Authenticator code</span>
              <input
                autoFocus
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                className="h-12 w-full rounded-xl border border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)] px-4 text-center text-lg font-semibold tracking-[.3em] outline-none focus:border-violet-500/50"
              />
            </label>
          ) : (
            <label className="block">
              <span className="mb-1.5 block text-[10px] font-medium text-[#A0A6B5]">Creator security password</span>
              <div className="relative">
                <input
                  autoFocus
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={creatorSecret}
                  onChange={(event) => setCreatorSecret(event.target.value)}
                  className="h-12 w-full rounded-xl border border-white/[.08] bg-[#171B24] px-4 pr-16 text-sm outline-none focus:border-violet-500/50"
                />
                <button type="button" onClick={() => setShowPassword((value) => !value)} className="absolute inset-y-0 right-3 text-[9px] font-semibold text-[var(--wh-accent-text)]">
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </label>
          )}

          {error ? <p className="rounded-xl border border-red-500/15 bg-red-500/[.06] p-3 text-[10px] text-red-300">{error}</p> : null}

          <button
            type="submit"
            disabled={isLoading || (needsMfa ? code.length !== 6 : !creatorSecret)}
            className="h-12 w-full rounded-xl bg-violet-500 text-xs font-semibold disabled:opacity-45"
          >
            {isLoading ? 'Confirming…' : needsMfa ? 'Verify and continue' : 'Confirm and continue'}
          </button>
        </form>

        <p className="mt-4 text-center text-[8px] leading-4 text-[var(--wh-text-muted)]">
          The Creator security password is verified server-side and is not stored in this browser. A successful confirmation expires after 10 minutes.
        </p>
      </div>
    </div>
  );
}
