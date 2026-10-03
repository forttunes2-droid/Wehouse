type Props = {
  identityPassed: boolean;
  skillVideoSaved: boolean;
  identityRequired?: boolean;
  readinessPassed?: boolean; // deprecated rollout compatibility; intentionally ignored
};

export default function WorkerVerificationChecklist({ identityPassed, skillVideoSaved, identityRequired = false }: Props) {
  const items = [
    ...(identityRequired ? [{ label: 'Private identity check', done: identityPassed }] : []),
    { label: 'Service Worker profile', done: true },
    { label: 'Skill/work video', done: skillVideoSaved },
  ];
  const firstPending = items.findIndex((item) => !item.done);

  return <section className="rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-3">
    <div className="mb-3 flex items-center justify-between gap-3"><div><p className="text-[8px] font-bold uppercase tracking-[.16em] text-[var(--wh-text-muted)]">SERVICE PROVIDER REVIEW</p><p className="mt-1 text-[10px] text-[var(--wh-text-secondary)]">Free onboarding and professional work evidence</p></div><span className="text-[9px] font-semibold text-violet-300">{items.filter(item=>item.done).length}/{items.length}</span></div>
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">{items.map((item,index)=>{const active=!item.done&&index===firstPending;return <div key={item.label} className={`flex min-h-14 items-center gap-2 rounded-xl border px-3 py-2.5 ${item.done?'border-emerald-500/15 bg-emerald-500/[.04]':active?'border-violet-500/18 bg-violet-500/[.045]':'border-[var(--wh-border-subtle)] bg-black/10'}`}><span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[8px] font-bold ${item.done?'bg-emerald-500 text-[#03120A]':active?'bg-violet-500 text-white':'bg-[var(--wh-interactive)] text-[var(--wh-text-muted)]'}`}>{item.done?'✓':index+1}</span><span className={`text-[8px] font-medium leading-tight ${item.done?'text-emerald-300':active?'text-violet-200':'text-[var(--wh-text-muted)]'}`}>{item.label}</span></div>})}</div>
  </section>;
}
