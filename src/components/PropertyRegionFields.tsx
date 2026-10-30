import LocationChoice from '@/components/RoommateLocationChoice';
import { regionDataset } from '@/data/locations';

type Props = {
  countryCode: string;
  state: string;
  area: string;
  onChange: (value: { propertyState: string; propertyCity: string }) => void;
};

/** Region lists are country-specific; a profile's home location is not the property location. */
export default function PropertyRegionFields({ countryCode, state, area, onChange }: Props) {
  const regions = regionDataset(countryCode);
  const region = regions?.find(row => row.state.toLowerCase() === state.trim().toLowerCase());
  const inputClass = 'min-h-12 w-full rounded-xl border border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)] px-3 text-sm text-[var(--wh-text)]';
  return <>
    <div className="min-w-0 space-y-1">
      <p className="text-xs text-[var(--wh-text-secondary)]">State *</p>
      {regions ? <LocationChoice label="Property state" value={state} options={regions.map(row => row.state)} onChange={next => onChange({ propertyState: next, propertyCity: next === state ? area : '' })}/>
        : <input aria-label="Property state" autoComplete="address-level1" maxLength={100} className={inputClass} value={state} onChange={event => onChange({ propertyState: event.target.value, propertyCity: '' })}/>}
    </div>
    <div className="min-w-0 space-y-1">
      <p className="text-xs text-[var(--wh-text-secondary)]">{countryCode === 'NG' ? 'Local government area (LGA) *' : 'City or local area *'}</p>
      {regions ? <LocationChoice label="Property LGA" value={area} options={region?.cities || []} disabled={!region} onChange={next => onChange({ propertyState: region!.state, propertyCity: next })}/>
        : <input aria-label="Property city or local area" autoComplete="address-level2" maxLength={100} className={inputClass} value={area} onChange={event => onChange({ propertyState: state, propertyCity: event.target.value })}/>}
      {regions && !region && <p className="text-xs text-[var(--wh-text-secondary)]">Choose a state first to see its LGAs.</p>}
      {region && area && !region.cities.includes(area) && <p className="text-xs text-[var(--wh-text-secondary)]">The saved city or area is shown. Choose its LGA from the list; keep the neighbourhood in the street address.</p>}
    </div>
  </>;
}
