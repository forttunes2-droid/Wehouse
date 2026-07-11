// ═══════════════════════════════════════════════════════════════
// STATE + LGA DEPENDENT DROPDOWN
// Select state first → LGA dropdown auto-populates
// Used in all location forms across WeHouse
// ═══════════════════════════════════════════════════════════════

import { useState, useEffect, useMemo } from 'react';
import { NIGERIA_STATES, getLGAsForState } from '@/lib/nigeria-states';

interface StateLgaDropdownProps {
  stateValue: string;
  lgaValue: string;
  onStateChange: (state: string) => void;
  onLgaChange: (lga: string) => void;
  statePlaceholder?: string;
  lgaPlaceholder?: string;
  disabled?: boolean;
  className?: string;
}

export default function StateLgaDropdown({
  stateValue,
  lgaValue,
  onStateChange,
  onLgaChange,
  statePlaceholder = 'Select State',
  lgaPlaceholder = 'Select Local Government',
  disabled = false,
  className = '',
}: StateLgaDropdownProps) {
  const [internalState, setInternalState] = useState(stateValue);

  // Sync internal state with prop
  useEffect(() => {
    setInternalState(stateValue);
  }, [stateValue]);

  // Get LGAs for selected state
  const availableLGAs = useMemo(() => {
    if (!internalState) return [];
    return getLGAsForState(internalState);
  }, [internalState]);

  // Reset LGA when state changes
  const handleStateChange = (newState: string) => {
    setInternalState(newState);
    onStateChange(newState);
    // Reset LGA to empty when state changes
    onLgaChange('');
  };

  const selectClass = `w-full h-10 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm px-3 outline-none focus:border-violet-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors appearance-none`;

  return (
    <div className={`grid grid-cols-1 sm:grid-cols-2 gap-3 ${className}`}>
      {/* State Dropdown */}
      <div className="relative">
        <label className="text-[10px] text-[#5C5E72] font-medium uppercase tracking-wider mb-1 block">
          State *
        </label>
        <div className="relative">
          <select
            value={internalState}
            onChange={e => handleStateChange(e.target.value)}
            disabled={disabled}
            className={selectClass}
          >
            <option value="">{statePlaceholder}</option>
            {NIGERIA_STATES.map(state => (
              <option key={state.code} value={state.name}>
                {state.name}
              </option>
            ))}
          </select>
          {/* Dropdown arrow */}
          <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#5C5E72" strokeWidth="2">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </div>
        </div>
      </div>

      {/* LGA Dropdown */}
      <div className="relative">
        <label className="text-[10px] text-[#5C5E72] font-medium uppercase tracking-wider mb-1 block">
          Local Government *
        </label>
        <div className="relative">
          <select
            value={lgaValue}
            onChange={e => onLgaChange(e.target.value)}
            disabled={disabled || !internalState || availableLGAs.length === 0}
            className={selectClass}
          >
            <option value="">{lgaPlaceholder}</option>
            {availableLGAs.map(lga => (
              <option key={lga} value={lga}>
                {lga}
              </option>
            ))}
          </select>
          <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#5C5E72" strokeWidth="2">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </div>
        </div>
        {!internalState && (
          <p className="text-[9px] text-[#5C5E72] mt-1">Select a state first</p>
        )}
      </div>
    </div>
  );
}
