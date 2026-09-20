import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { withTimeout } from '@/lib/withTimeout';
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
  const [locating, setLocating] = useState(false);
  const [locationNotice, setLocationNotice] = useState('');
  const [suggestion, setSuggestion] = useState<{ state: string; city: string } | null>(null);
  const request = useRef(0);
  useEffect(() => () => { request.current += 1; }, []);
  useEffect(() => { request.current += 1; setSuggestion(null); setLocating(false); }, [value.state, value.city]);
  async function locate() {
    const id = ++request.current;
    setLocating(true); setLocationNotice(''); setSuggestion(null);
    try {
      if (!navigator.geolocation) throw new Error('Location is unavailable. Choose your State and Local Government below.');
      const position = await new Promise<GeolocationPosition>((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }));
      if (id !== request.current) return;
      const result = await withTimeout(supabase.functions.invoke('reverse-geocode', { body: { latitude: position.coords.latitude, longitude: position.coords.longitude } }), 10000, 'Address lookup timed out. Choose your region below.');
      if (id !== request.current) return;
      const clean = (text: string) => text.toLowerCase().replace(/\b(state|local government area|lga|municipality)\b/g, '').replace(/[^a-z]/g, '');
      const state = NIGERIA_STATES.find(row => clean(row.state) === clean(String(result.data?.state || '')));
      const city = state?.cities.find(row => clean(row) === clean(String(result.data?.city || ''))) || '';
      if (result.error || !state) throw new Error('We could not match your location. Choose your State and Local Government below.');
      setSuggestion({ state: state.state, city });
      setLocationNotice(city ? 'Check the suggested region before applying it.' : 'State found. Choose your Local Government after applying it.');
    } catch {
      if (id === request.current) setLocationNotice('Location could not be read. You can still choose your State and Local Government below.');
    } finally { if (id === request.current) setLocating(false); }
  }
  const cities = useMemo(() => getCitiesForState(value.state), [value.state]);
  const stateOptions = useMemo(() => NIGERIA_STATES.map((item) => ({ value: item.state, label: item.state })), []);
  const cityOptions = useMemo(() => cities.map((city) => ({ value: city, label: city })), [cities]);

  const update = (partial: Partial<LocationValue>) => onChange({ ...value, ...partial });

  return (
    <div className="space-y-3">
      <button type="button" disabled={disabled || locating} onClick={() => void locate()} className="min-h-11 text-sm font-semibold text-violet-300 disabled:opacity-50">{locating ? 'Finding your location…' : 'Use my location'}</button>
      {locationNotice && <p role="status" className="text-xs leading-5 text-[#A1A7B5]">{locationNotice}</p>}
      {suggestion && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 p-3"><span className="text-sm">{[suggestion.city, suggestion.state].filter(Boolean).join(', ')}</span><button type="button" disabled={disabled} onClick={() => { onChange({ ...value, state: suggestion.state, city: suggestion.city, area: '' }); setSuggestion(null); setLocationNotice('Region applied. Check the fields below.'); }} className="min-h-11 text-sm font-semibold text-violet-300">Use this region</button></div>}
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
