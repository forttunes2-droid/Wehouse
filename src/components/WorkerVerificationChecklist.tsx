type Props = {
  identityPassed: boolean;
  paymentConfirmed: boolean;
  skillVideoSaved: boolean;
  readinessPassed?: boolean; // deprecated rollout compatibility; intentionally ignored
};

export default function WorkerVerificationChecklist({ identityPassed, paymentConfirmed, skillVideoSaved }: Props) {
  const items = [
    { label: 'Private face check', done: identityPassed },
    { label: 'Verification fee', done: paymentConfirmed },
    { label: 'Skill/work video', done: skillVideoSaved },
  ];
  const firstPending = items.findIndex((item) => !item.done);

  return <section className="rounded-2xl border border-white/[.06] bg-[#0D1118] p-3">
    <div className="mb-3 flex items-center justify-between gap-3"><div><p className="text-[8px] font-bold uppercase tracking-[.16em] text-[#686F7F]">WORKER VERIFICATION</p><p className="mt-1 text-[10px] text-[#8A90A0]">Identity, payment and real professional evidence</p></div><span className="text-[9px] font-semibold text-violet-300">{items.filter(item=>item.done).length}/3</span></div>
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">{items.map((item,index)=>{const active=!item.done&&index===firstPending;return <div key={item.label} className={`flex min-h-14 items-center gap-2 rounded-xl border px-3 py-2.5 ${item.done?'border-emerald-500/15 bg-emerald-500/[.04]':active?'border-violet-500/18 bg-violet-500/[.045]':'border-white/[.05] bg-black/10'}`}><span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[8px] font-bold ${item.done?'bg-emerald-500 text-[#03120A]':active?'bg-violet-500 text-white':'bg-white/[.05] text-[#636A7A]'}`}>{item.done?'✓':index+1}</span><span className={`text-[8px] font-medium leading-tight ${item.done?'text-emerald-300':active?'text-violet-200':'text-[#676E7E]'}`}>{item.label}</span></div>})}</div>
  </section>;
}
