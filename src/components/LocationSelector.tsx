import { useState, useMemo, useEffect } from 'react';
import { NIGERIA_STATES, getCitiesForState } from '@/data/nigeria-locations';

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
  const [searchCity, setSearchCity] = useState('');
  const [showCityPicker, setShowCityPicker] = useState(false);

  const cities = useMemo(() => getCitiesForState(value.state), [value.state]);

  // Reset city when state changes
  useEffect(() => {
    if (value.state && !cities.includes(value.city)) {
      onChange({ ...value, city: cities[0] || '', area: '' });
    }
  }, [value.state]);

  const filteredCities = useMemo(() => {
    if (!searchCity.trim()) return cities;
    return cities.filter((c) => c.toLowerCase().includes(searchCity.toLowerCase()));
  }, [cities, searchCity]);

  const update = (partial: Partial<LocationValue>) => {
    onChange({ ...value, ...partial });
  };

  return (
    <div className="space-y-3">
      {/* Country */}
      <div>
        <label className="text-[10px] text-[#5C5E72] mb-1 block uppercase tracking-wider font-medium">Country</label>
        <select
          value={value.country}
          onChange={(e) => update({ country: e.target.value })}
          disabled={disabled}
          className="w-full h-10 rounded-xl border border-[#2A2A3A] px-3 text-sm bg-[#1A1A24] text-white focus:border-[#3B82F6]/50 outline-none disabled:opacity-50"
        >
          <option value="Nigeria">Nigeria</option>
        </select>
      </div>

      {/* State */}
      <div>
        <label className="text-[10px] text-[#5C5E72] mb-1 block uppercase tracking-wider font-medium">State *</label>
        <select
          value={value.state}
          onChange={(e) => update({ state: e.target.value, city: '', area: '' })}
          disabled={disabled}
          className="w-full h-10 rounded-xl border border-[#2A2A3A] px-3 text-sm bg-[#1A1A24] text-white focus:border-[#3B82F6]/50 outline-none disabled:opacity-50"
        >
          <option value="">Select state</option>
          {NIGERIA_STATES.map((s) => (
            <option key={s.state} value={s.state}>{s.state}</option>
          ))}
        </select>
      </div>

      {/* City */}
      <div>
        <label className="text-[10px] text-[#5C5E72] mb-1 block uppercase tracking-wider font-medium">City *</label>
        {value.state ? (
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowCityPicker(!showCityPicker)}
              className="w-full h-10 rounded-xl border border-[#2A2A3A] px-3 text-sm bg-[#1A1A24] text-white text-left focus:border-[#3B82F6]/50 outline-none flex items-center justify-between"
            >
              <span className={value.city ? 'text-white' : 'text-[#5C5E72]'}>{value.city || 'Select city'}</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5C5E72" strokeWidth="2"><path d="M6 9l6 6 6-6" /></svg>
            </button>
            {showCityPicker && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-[#1A1A24] border border-[#2A2A3A] rounded-xl z-50 max-h-52 overflow-hidden">
                <div className="p-2 border-b border-[#2A2A3A]">
                  <input
                    autoFocus
                    value={searchCity}
                    onChange={(e) => setSearchCity(e.target.value)}
                    placeholder="Search city..."
                    className="w-full h-8 rounded-lg bg-[#12121A] border border-[#2A2A3A] text-white text-xs px-3 placeholder-[#5C5E72] outline-none focus:border-[#3B82F6]/50"
                  />
                </div>
                <div className="overflow-y-auto max-h-36 p-1">
                  {filteredCities.map((city) => (
                    <button
                      key={city}
                      type="button"
                      onClick={() => { update({ city }); setShowCityPicker(false); setSearchCity(''); }}
                      className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors ${
                        value.city === city ? 'bg-[#3B82F6]/20 text-[#3B82F6]' : 'text-white hover:bg-white/[0.03]'
                      }`}
                    >
                      {city}
                    </button>
                  ))}
                  {filteredCities.length === 0 && (
                    <div className="px-3 py-2 text-xs text-[#5C5E72]">No cities found</div>
                  )}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="w-full h-10 rounded-xl border border-[#2A2A3A] px-3 text-sm bg-[#1A1A24] text-[#5C5E72] flex items-center">
            Select a state first
          </div>
        )}
      </div>

      {/* Area */}
      <div>
        <label className="text-[10px] text-[#5C5E72] mb-1 block uppercase tracking-wider font-medium">Area <span className="normal-case text-[9px] opacity-60">(optional)</span></label>
        <input
          value={value.area}
          onChange={(e) => update({ area: e.target.value })}
          placeholder="e.g. Angwan Lambu, GRA"
          disabled={disabled}
          className="w-full h-10 rounded-xl border border-[#2A2A3A] px-3 text-sm bg-[#1A1A24] text-white placeholder-[#5C5E72] focus:border-[#3B82F6]/50 outline-none disabled:opacity-50"
        />
      </div>

      {/* Summary */}
      {(value.state || value.city) && (
        <div className="flex items-center gap-2 text-[10px] text-[#5C5E72]">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>
          {[value.city, value.state, value.country].filter(Boolean).join(', ')}
          {value.area && <span>· {value.area}</span>}
        </div>
      )}
    </div>
  );
}
