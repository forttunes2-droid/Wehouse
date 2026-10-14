type LocationFilterFieldsProps = {
  region: string;
  locality: string;
  onRegionChange: (value: string) => void;
  onLocalityChange: (value: string) => void;
};

const inputClassName =
  "mt-1.5 h-11 w-full rounded-xl border border-[var(--wh-border-subtle)] bg-[var(--wh-bg)] px-3 text-sm text-[var(--wh-text)] placeholder:text-[var(--wh-text-muted)] focus:outline-none focus:ring-2 focus:ring-violet-400/70";

export default function LocationFilterFields({
  region,
  locality,
  onRegionChange,
  onLocalityChange,
}: LocationFilterFieldsProps) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <label className="min-w-0 text-[10px] font-semibold text-[var(--wh-text-secondary)]">
        Region or state
        <input
          type="text"
          autoComplete="address-level1"
          maxLength={100}
          value={region}
          onChange={(event) => onRegionChange(event.target.value)}
          placeholder="Any region"
          className={inputClassName}
        />
      </label>
      <label className="min-w-0 text-[10px] font-semibold text-[var(--wh-text-secondary)]">
        City or local area
        <input
          type="text"
          autoComplete="address-level2"
          maxLength={100}
          value={locality}
          onChange={(event) => onLocalityChange(event.target.value)}
          placeholder="Any city or area"
          className={inputClassName}
        />
      </label>
    </div>
  );
}
