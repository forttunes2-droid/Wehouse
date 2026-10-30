import AccountReviewEntry from '@/components/AccountReviewEntry';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { withTimeout } from '@/lib/withTimeout';

export default function SignedOutAccountHelp() {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [compose, setCompose] = useState(false);
  const [username, setUsername] = useState('');
  const [reference, setReference] = useState('');
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true); setError(false); setEmail(null);
    void withTimeout(supabase.rpc('get_public_account_support'), 12000, 'Support contact took too long.')
      .then(({ data, error }) => {
        if (error || !data || (data.email !== null && (typeof data.email !== 'string' ||
          !/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z0-9-]{2,}$/.test(data.email)))) {
          throw Error('Support contact unavailable');
        }
        if (active) setEmail(data.email);
      })
      .catch(() => { if (active) setError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open, attempt]);

  const ready = Boolean(username.trim() && reason.trim());
  const subject = 'WeHouse account access review';
  const body = [
    'Account review request',
    `Username: ${username.trim()}`,
    `Restriction or booking reference: ${reference.trim() || 'Not available'}`,
    '', 'Why I am requesting a review:', reason.trim(),
    '', 'Please confirm receipt and tell me whether any further information is required.',
  ].join('\n');
  const contact = email ? `mailto:${email}?subject=${encodeURIComponent(subject)}` : '';
  const field = 'mt-1 block min-h-11 w-full rounded-xl border border-[var(--auth-border)] bg-transparent px-3 py-2 text-[var(--auth-ink)]';

  return (
    <details className="rounded-xl border border-[var(--auth-border)] p-3 text-sm" onToggle={event => {
      if (event.currentTarget.open) setLoading(true);
      setOpen(event.currentTarget.open);
    }}>
      <summary className="min-h-10 cursor-pointer font-medium">Account access or suspension help</summary>
      <div className="mt-2 space-y-3 leading-6 text-[var(--auth-muted)]">
        {open&&<AccountReviewEntry signedIn={false}/>}
        <p>Use tracked account reviews above, or contact WeHouse by email if you cannot access them. Include your username and explain what happened. No password or verification code is needed in your message.</p>
        <p>A review request does not automatically restore access. WeHouse must review the restriction and reply with the decision. If access is restored, sign in again; previous device sessions remain closed.</p>
        {loading ? <p role="status">Loading the published support contact...</p>
          : error ? <p role="alert">Support contact could not be loaded.</p>
            : email ? <>
              <a className="inline-flex min-h-11 items-center break-all font-semibold text-[var(--auth-ink)] underline underline-offset-4" href={contact}>Email WeHouse about account access</a>
              <button type="button" aria-expanded={compose} onClick={() => setCompose(value => !value)} className="block min-h-11 font-semibold text-[var(--auth-ink)]">{compose ? 'Hide review request' : 'Prepare an account review request'}</button>
              {compose && <section aria-label="Account review request" className="space-y-3 border-t border-[var(--auth-border)] pt-3">
                <label className="block">Username <span aria-hidden="true">(required)</span><input autoComplete="username" required maxLength={100} value={username} onChange={event => setUsername(event.target.value)} className={field}/></label>
                <label className="block">Restriction or booking reference (optional)<input maxLength={150} value={reference} onChange={event => setReference(event.target.value)} className={field}/></label>
                <label className="block">Why should WeHouse review this restriction? <span aria-hidden="true">(required)</span><textarea required maxLength={2000} rows={4} value={reason} onChange={event => setReason(event.target.value)} className={field}/></label>
                <p className="text-xs">Explain what happened and any incorrect information or changes WeHouse should consider. Do not include passwords, verification codes, full identity numbers or bank details.</p>
                {ready ? <a href={`${contact}&body=${encodeURIComponent(body)}`} className="inline-flex min-h-11 items-center font-semibold text-[var(--auth-ink)] underline underline-offset-4">Open review request in email</a> : <button type="button" disabled className="min-h-11 font-semibold opacity-50">Open review request in email</button>}
                <p className="text-xs">This prepares an email on your device. You must send it from your email app. This screen cannot confirm delivery or track the review. Keep WeHouse’s reply and reference for follow-up. Resetting your password does not lift a suspension.</p>
              </section>}
            </> : <p>The public support address has not been published yet.</p>}
        {!loading && (error || !email) && <button type="button" onClick={() => setAttempt(value => value + 1)} className="min-h-11 font-semibold text-[var(--auth-ink)]">Refresh support contact</button>}
      </div>
    </details>
  );
}
