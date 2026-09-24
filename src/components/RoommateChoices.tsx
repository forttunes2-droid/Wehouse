import { useId } from "react";
export function RoommateChoice({ title, value, options, onChange }: { title: string; value: string; options: Array<[string, string]>; onChange: (value: string) => void }) {
  const id = useId();
  return <fieldset className="space-y-3"><legend id={id} className="text-sm font-medium text-[#D3D6DF]">{title}</legend><div className="flex flex-wrap gap-2">{options.filter(([key]) => key !== "").map(([key, label]) => <button type="button" key={key} aria-pressed={value === key} onClick={() => onChange(key)} className={`min-h-11 rounded-xl border px-4 py-2 text-sm transition-colors ${value === key ? "border-violet-400 bg-violet-500/15 text-violet-100" : "border-white/10 bg-transparent text-[#B5BBC8]"}`}>{label}</button>)}{value && options.some(([key]) => key === "") && <button type="button" onClick={() => onChange("")} className="min-h-11 px-2 text-sm text-[#A7ADBA]">Clear</button>}</div></fieldset>;
}
