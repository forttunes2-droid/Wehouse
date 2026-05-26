import { useState, useMemo } from 'react';
import { NIGERIA_STATES } from '@/data/nigeria-locations';

interface RoommateLocationSelectorProps {
  value: {
    preferred_state: string;
    preferred_lga: string;
    preferred_area: string;
  };
  onChange: (v: {
    preferred_state: string;
    preferred_lga: string;
    preferred_area: string;
  }) => void;
}

export default function RoommateLocationSelector({ value, onChange }: RoommateLocationSelectorProps) {
  const [selectedState, setSelectedState] = useState(value.preferred_state || '');

  const states = useMemo(() => NIGERIA_STATES.map(s => s.state).sort(), []);

  const lgas = useMemo(() => {
    if (!selectedState) return [];
    const found = NIGERIA_STATES.find(s => s.state === selectedState);
    return found?.cities || [];
  }, [selectedState]);

  const handleStateChange = (state: string) => {
    setSelectedState(state);
    onChange({ preferred_state: state, preferred_lga: '', preferred_area: '' });
  };

  const handleLgaChange = (lga: string) => {
    onChange({ ...value, preferred_lga: lga });
  };

  const handleAreaChange = (area: string) => {
    onChange({ ...value, preferred_area: area });
  };

  return (
    <div className="space-y-3">
      {/* State */}
      <div>
        <label className="text-[10px] text-[#5C5E72] mb-1.5 block font-medium">State</label>
        <select
          value={selectedState}
          onChange={(e) => handleStateChange(e.target.value)}
          className="w-full h-11 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm px-4 focus:border-[#3B82F6]/50 outline-none appearance-none cursor-pointer"
        >
          <option value="">Select state...</option>
          {states.map(state => (
            <option key={state} value={state}>{state}</option>
          ))}
        </select>
      </div>

      {/* LGA / City — filtered by state */}
      {selectedState && (
        <div className="animate-fadeIn">
          <label className="text-[10px] text-[#5C5E72] mb-1.5 block font-medium">Local Government / City</label>
          <select
            value={value.preferred_lga}
            onChange={(e) => handleLgaChange(e.target.value)}
            className="w-full h-11 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm px-4 focus:border-[#3B82F6]/50 outline-none appearance-none cursor-pointer"
          >
            <option value="">Select area...</option>
            {lgas.map(lga => (
              <option key={lga} value={lga}>{lga}</option>
            ))}
          </select>
        </div>
      )}

      {/* Exact Area / Street — free text */}
      {value.preferred_lga && (
        <div className="animate-fadeIn">
          <label className="text-[10px] text-[#5C5E72] mb-1.5 block font-medium">Exact Area / Street (Optional)</label>
          <input
            type="text"
            value={value.preferred_area}
            onChange={(e) => handleAreaChange(e.target.value)}
            placeholder="e.g. Agwan Lambu, Angwan Rukuba"
            className="w-full h-11 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm px-4 placeholder-[#5C5E72] focus:border-[#3B82F6]/50 outline-none"
          />
          <p className="text-[9px] text-[#5C5E72] mt-1">Be specific — helps find closer roommates</p>
        </div>
      )}
    </div>
  );
}
