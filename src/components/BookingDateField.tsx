import { displayDate } from "@/lib/displayDate";

export default function BookingDateField({ label, value, min, max, onChange }: {
  label: string; value: string; min?: string; max?: string; onChange: (value: string) => void;
}) {
  return <label className="block min-w-0">
    <span className="mb-2 block text-xs text-[#A1A1AA]">{label}</span>
    <span className="relative flex min-h-12 items-center rounded-xl border border-white/15 bg-white/[.04] px-3 text-sm focus-within:border-violet-400 focus-within:ring-1 focus-within:ring-violet-400">
      <span aria-hidden="true">{value ? displayDate(value) : "Choose date"}</span>
      <input type="date" aria-label={label} value={value} min={min} max={max}
        onChange={event => onChange(event.target.value)}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
    </span>
  </label>;
}
