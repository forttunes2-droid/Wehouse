import { Check } from 'lucide-react';

type Props = {
  identityPassed: boolean;
  skillVideoSaved: boolean;
  identityRequired?: boolean;
  readinessPassed?: boolean; // Retained for existing callers; not an approval signal.
};

// Rendered only after the server confirms a complete professional profile.
export default function WorkerVerificationChecklist({ identityPassed, skillVideoSaved, identityRequired = false }: Props) {
  const items = [
    ...(identityRequired ? [{ label: 'Private identity check', done: identityPassed }] : []),
    { label: 'Service Worker profile', done: true },
    { label: 'Skill/work video', done: skillVideoSaved },
  ];
  const firstPending = items.findIndex(item => !item.done);
  const completed = items.filter(item => item.done).length;

  return (
    <section aria-label="Service Worker review requirements" className="rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-[var(--wh-text)]">Review requirements</h3>
          <p className="mt-1 text-sm text-[var(--wh-text-secondary)]">Free onboarding and professional work evidence</p>
        </div>
        <span aria-label={`${completed} of ${items.length} requirements complete`} className="shrink-0 text-sm font-semibold text-[var(--wh-accent-text)]">{completed}/{items.length}</span>
      </div>
      <ol className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {items.map((item, index) => {
          const active = !item.done && index === firstPending;
          return (
            <li key={item.label} aria-current={active ? 'step' : undefined} className={`flex min-h-16 items-center gap-3 rounded-xl border px-3 py-3 transition-colors duration-150 motion-reduce:transition-none ${item.done ? 'border-emerald-500/20 bg-emerald-500/5' : active ? 'border-violet-500/25 bg-violet-500/5' : 'border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)]'}`}>
              <span aria-hidden="true" className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-semibold ${item.done ? 'bg-emerald-600 text-white' : active ? 'bg-violet-600 text-white' : 'bg-[var(--wh-interactive)] text-[var(--wh-text-secondary)]'}`}>
                {item.done ? <Check size={16} /> : index + 1}
              </span>
              <span className="min-w-0 text-sm font-medium text-[var(--wh-text)]">{item.label}<span className="sr-only">{item.done ? ': complete' : ': incomplete'}</span></span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
