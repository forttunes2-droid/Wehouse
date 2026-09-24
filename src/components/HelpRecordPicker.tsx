import { useId, useState } from "react";
import { filterHelpRecords, helpTargetKey, helpRecordStatus, helpRecordType, type HelpTarget } from "@/lib/helpTargets";

type Props = { title: string; targets: HelpTarget[]; value: string; setValue: (value: string) => void; allowAccount?: boolean; includeHistory?: boolean };
export default function HelpRecordPicker({ title, targets, value, setValue, allowAccount = false, includeHistory = false }: Props) {
  const [query, setQuery] = useState(""), [history, setHistory] = useState(includeHistory), [limit, setLimit] = useState(6);
  const id = useId();
  const rows = filterHelpRecords(targets, query, history);
  const selected = targets.find(item => helpTargetKey(item) === value);
  const showDate = (item: HelpTarget) => {
    const date = item.record_date || item.updated_at;
    return date && Number.isFinite(Date.parse(date)) ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(date)) : "";
  };
  return <section aria-label={title} className="space-y-4">
    <h2 className="text-base font-semibold">{title}</h2>
    {targets.length > 0 && <div className="flex flex-wrap gap-3"><label className="min-w-[160px] flex-1"><span className="sr-only">Search your records</span><input value={query} onChange={event => { setQuery(event.target.value); setLimit(6); }} placeholder="Search your records" className="min-h-12 w-full rounded-xl border border-white/10 bg-[#151820] px-3 text-base outline-none focus:border-violet-400" /></label>{!includeHistory && <label><span className="sr-only">Records to show</span><select aria-label="Records to show" value={history ? "all" : "current"} onChange={event => { setHistory(event.target.value === "all"); setLimit(6); }} className="min-h-12 rounded-xl border border-white/10 bg-[#151820] px-3 text-sm"><option value="current">Current records</option><option value="all">Include past records</option></select></label>}</div>}
    <fieldset className="divide-y divide-white/10 border-y border-white/10"><legend className="sr-only">Select a record</legend>
      {allowAccount && <label className="flex min-h-14 cursor-pointer items-center gap-3 py-3"><input type="radio" name={id} checked={!value} onChange={() => setValue("")} className="h-5 w-5 accent-violet-500" /><span className="text-sm">No specific booking or job</span></label>}
      {rows.slice(0, limit).map(item => <label key={helpTargetKey(item)} className="flex min-h-16 cursor-pointer items-start gap-3 py-4"><input type="radio" name={id} value={helpTargetKey(item)} checked={value === helpTargetKey(item)} onChange={() => setValue(helpTargetKey(item))} className="mt-1 h-5 w-5 shrink-0 accent-violet-500" /><span className="min-w-0"><span className="block break-words text-base font-medium">{item.label}</span><span className="mt-1 block text-sm leading-6 text-[#A7ADBA]">{[helpRecordType(item), helpRecordStatus(item), showDate(item)].filter(Boolean).join(" · ")}</span></span></label>)}
    </fieldset>
    {targets.length > 0 && rows.length === 0 && <p className="text-sm leading-6 text-[#A7ADBA]">{query ? "No records match your search." : "No current records. Older bookings are available under Include past records."}</p>}
    {rows.length > limit && <button type="button" onClick={() => setLimit(n => n + 6)} className="min-h-11 text-sm font-medium text-violet-300">Show more records</button>}
    {selected && !rows.slice(0, limit).some(item => helpTargetKey(item) === value) && <p className="text-sm text-[#A7ADBA]">Selected: {selected.label} <button type="button" onClick={() => setValue("")} className="min-h-11 px-2 text-violet-300">Clear selection</button></p>}
  </section>;
}
