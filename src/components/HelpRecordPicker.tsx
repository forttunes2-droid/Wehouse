import { useId, useState } from "react";
import { ChevronRight, Search } from "lucide-react";
import { filterHelpRecords, helpTargetKey, helpRecordStatus, helpRecordType, type HelpTarget } from "@/lib/helpTargets";

type Props = {
  title: string; targets: HelpTarget[]; includeHistory?: boolean;
  onChoose: (target: HelpTarget) => void; onAccount?: () => void;
};
/** Selecting an owned record opens its existing support composer; never sends. */
export default function HelpRecordPicker({ title, targets, onChoose, onAccount, includeHistory = false }: Props) {
  const [query, setQuery] = useState(""), [history, setHistory] = useState(includeHistory), [limit, setLimit] = useState(6);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchId = useId();
  const rows = filterHelpRecords(targets, query, history);
  const hasHistory = filterHelpRecords(targets,"",true).length > filterHelpRecords(targets,"",false).length;
  const showDate = (item: HelpTarget) => {
    const date = item.record_date || item.updated_at;
    return date && Number.isFinite(Date.parse(date)) ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(date)) : "";
  };
  return <section aria-label={title} className="space-y-3">
    {targets.length > 0 && <div className="flex min-h-11 items-center justify-between gap-3">
      <p className="text-sm text-[#A7ADBA]">Message WeHouse</p>
      <button type="button" aria-label="Search your records" aria-expanded={searchOpen || targets.length > 6} aria-controls={searchId} onClick={() => {if (searchOpen) setQuery("");setSearchOpen(value => !value);}} className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-[#C4BCD8] focus-visible:outline focus-visible:outline-violet-300"><Search size={18} /></button>
    </div>}
    {(searchOpen || targets.length > 6) && <label id={searchId} className="block"><span className="sr-only">Search your records</span><input autoFocus={searchOpen} value={query} onChange={event => {setQuery(event.target.value);setLimit(6);}} placeholder="Search your records" className="min-h-12 w-full rounded-xl border border-white/10 bg-[#151820] px-3 text-base outline-none focus:border-violet-400" /></label>}
    <div className="divide-y divide-white/[.08] border-y border-white/[.08]">
      {onAccount && <button type="button" onClick={onAccount} className="flex min-h-16 w-full items-center justify-between gap-3 py-4 text-left text-sm"><span>Not about a specific booking or job</span><ChevronRight size={18} className="shrink-0 text-[#A7ADBA]" /></button>}
      {rows.slice(0,limit).map(item => <button key={helpTargetKey(item)} type="button" data-help-target={helpTargetKey(item)} onClick={() => onChoose(item)} className="flex min-h-20 w-full items-center gap-4 py-4 text-left focus-visible:outline focus-visible:outline-violet-300">
        <span className="min-w-0 flex-1"><span className="block break-words text-base font-medium">{item.label}</span><span className="mt-1 block text-sm leading-6 text-[#A7ADBA]">{[helpRecordType(item),helpRecordStatus(item),showDate(item)].filter(Boolean).join(" · ")}</span></span>
        <ChevronRight size={18} aria-hidden="true" className="shrink-0 text-[#A7ADBA]" />
      </button>)}
    </div>
    {targets.length > 0 && rows.length === 0 && <p className="py-3 text-sm leading-6 text-[#A7ADBA]">{query ? "No records match your search." : "No current bookings or jobs."}</p>}
    <div className="flex flex-wrap items-center justify-between gap-3">
      {!includeHistory && hasHistory && <button type="button" aria-pressed={history} onClick={() => {setHistory(value => !value);setLimit(6);}} className="min-h-11 text-sm font-medium text-violet-300">{history ? "Show current only" : "Include past bookings and jobs"}</button>}
      {rows.length > limit && <button type="button" onClick={() => setLimit(n => n+6)} className="min-h-11 text-sm font-medium text-violet-300">Show more</button>}
    </div>
  </section>;
}
