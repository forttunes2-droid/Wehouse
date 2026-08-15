import { useMemo } from 'react';
import { NIGERIA_STATES, getCitiesForState } from '@/data/nigeria-locations';
import SearchableSelect from '@/components/SearchableSelect';

interface LocationValue {
  country: string;
  state: string;
  city: string;
  area: string;
}

interface LocationSelectorProps {
  value: LocationValue;
  onChange: (v: LocationValue) => void;
  disabled?: boolean;
}

export default function LocationSelector({ value, onChange, disabled }: LocationSelectorProps) {
  const cities = useMemo(() => getCitiesForState(value.state), [value.state]);
  const stateOptions = useMemo(() => NIGERIA_STATES.map((item) => ({ value: item.state, label: item.state })), []);
  const cityOptions = useMemo(() => cities.map((city) => ({ value: city, label: city })), [cities]);

  const update = (partial: Partial<LocationValue>) => onChange({ ...value, ...partial });

  return (
    <div className="space-y-3">
      <div>
        <span className="mb-1.5 block text-[10px] font-medium text-[#7B8190]">Country</span>
        <div className="flex h-11 items-center rounded-xl border border-white/[0.08] bg-[#181B24] px-3 text-xs text-[#D6D9E1]">Nigeria</div>
      </div>

      <SearchableSelect
        label="State *"
        value={value.state}
        onChange={(state) => update({ state, city: '', area: '' })}
        options={stateOptions}
        placeholder="Choose state"
        searchPlaceholder="Search state, e.g. Nasarawa"
        disabled={disabled}
        emptyText="No State matches your search"
      />

      <SearchableSelect
        label="Local Government *"
        value={value.city}
        onChange={(city) => update({ city })}
        options={cityOptions}
        placeholder={value.state ? 'Choose LGA' : 'Choose State first'}
        searchPlaceholder="Search Local Government"
        disabled={disabled || !value.state}
        emptyText="No Local Government matches your search"
      />

      <label className="block">
        <span className="mb-1.5 block text-[10px] font-medium text-[#7B8190]">Area <span className="text-[#5E6473]">(optional)</span></span>
        <input
          value={value.area}
          onChange={(event) => update({ area: event.target.value })}
          placeholder="GRA, Angwan Lambu…"
          disabled={disabled}
          className="h-11 w-full rounded-xl border border-white/[0.08] bg-[#181B24] px-3 text-xs text-white outline-none placeholder:text-[#5E6473] focus:border-violet-500/40 disabled:opacity-40"
        />
      </label>

      {(value.state || value.city) ? (
        <div className="flex items-center gap-2 text-[10px] text-[#656B7A]">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="text-violet-300"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
          {[value.city, value.state].filter(Boolean).join(', ')}{value.area ? ` · ${value.area}` : ''}
        </div>
      ) : null}
    </div>
  );
}
