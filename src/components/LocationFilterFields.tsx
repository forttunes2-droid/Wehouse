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
  const regional = getRegionalDefaults();
  const country = regional.countryCode;
  const regionLabel=country==='NG'?'State':'Region or state';
  const anyRegion=country==='NG'?'Any state':'Any region';
  const locationHeading=<div className="sm:col-span-2"><h3 className="text-sm font-semibold text-[var(--wh-text)]">Location</h3><p className="mt-1 text-xs text-[var(--wh-text-secondary)]">{regional.countryName}</p></div>;
  const dataset = regionDataset(country);
  if (dataset) return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {locationHeading}
      <SearchableSelect label={regionLabel} value={region}
        options={[{value:'',label:anyRegion},...dataset.map(item=>({value:item.state,label:item.state}))]}
        onChange={value=>{onRegionChange(value);onLocalityChange('');}}
        placeholder={anyRegion} searchPlaceholder={country==='NG'?'Search states':'Search regions'} emptyText={`No matching ${country==='NG'?'state':'region'}`}/>
      <SearchableSelect label={country === 'NG' ? 'Local area (LGA)' : 'City or local area'} value={locality}
        options={[{value:'',label:'Any local area'},...(dataset.find(item=>item.state===region)?.cities||[]).map(city=>({value:city,label:city}))]}
        onChange={onLocalityChange} disabled={!region} placeholder={region?'Any local area':`Choose a ${country==='NG'?'state':'region'} first`}
        searchPlaceholder="Search local areas" emptyText="No matching local area"/>
    </div>
  );
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {locationHeading}
      <label className="min-w-0 text-sm font-semibold text-[var(--wh-text-secondary)]">
        Region or state
        <input
          type="text"
          autoComplete="address-level1"
          maxLength={100}
          value={region}
          onChange={(event) => {onRegionChange(event.target.value);onLocalityChange('');}}
          placeholder="Any region"
          className={inputClassName}
        />
      </label>
      <label className="min-w-0 text-sm font-semibold text-[var(--wh-text-secondary)]">
        City or local area
        <input
          type="text"
          autoComplete="address-level2"
          maxLength={100}
          value={locality}
          disabled={!region.trim()}
          onChange={(event) => onLocalityChange(event.target.value)}
          placeholder="Any city or area"
          className={inputClassName}
        />
      </label>
    </div>
  );
}
