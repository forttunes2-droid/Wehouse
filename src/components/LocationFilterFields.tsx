import SearchableSelect from '@/components/SearchableSelect';
import { regionDataset } from '@/data/locations';
import { getRegionalDefaults } from '@/lib/regional';

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
  const country = getRegionalDefaults().countryCode;
  const dataset = regionDataset(country);
  if (dataset) return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <SearchableSelect label={country === 'NG' ? 'State' : 'Region or state'} value={region}
        options={[{value:'',label:'Any region'},...dataset.map(item=>({value:item.state,label:item.state}))]}
        onChange={value=>{onRegionChange(value);onLocalityChange('');}}
        placeholder="Any region" searchPlaceholder="Search regions" emptyText="No matching region"/>
      <SearchableSelect label={country === 'NG' ? 'Local Government' : 'City or local area'} value={locality}
        options={[{value:'',label:'Any local area'},...(dataset.find(item=>item.state===region)?.cities||[]).map(city=>({value:city,label:city}))]}
        onChange={onLocalityChange} disabled={!region} placeholder={region?'Any local area':'Choose a region first'}
        searchPlaceholder="Search local areas" emptyText="No matching local area"/>
    </div>
  );
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
