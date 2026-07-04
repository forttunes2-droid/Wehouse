import { useState, useRef, useCallback, useEffect } from 'react';

interface DualRangeSliderProps {
  min: number;
  max: number;
  floor: number;
  ceiling: number;
  step: number;
  onChange: (min: number, max: number) => void;
}

function formatCurrency(value: number): string {
  if (value >= 1000000) return `₦${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `₦${(value / 1000).toFixed(0)}k`;
  return `₦${value}`;
}

function formatCurrencyFull(value: number): string {
  return `₦${value.toLocaleString()}`;
}

export default function DualRangeSlider({
  min,
  max,
  floor,
  ceiling,
  step,
  onChange,
}: DualRangeSliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<'min' | 'max' | null>(null);

  // Clamp values
  const safeMin = Math.max(floor, Math.min(min, max - step));
  const safeMax = Math.max(min + step, Math.min(max, ceiling));

  const range = ceiling - floor;
  const minPercent = ((safeMin - floor) / range) * 100;
  const maxPercent = ((safeMax - floor) / range) * 100;

  const getValueFromPosition = useCallback(
    (clientX: number): number => {
      if (!trackRef.current) return floor;
      const rect = trackRef.current.getBoundingClientRect();
      const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
      const percent = x / rect.width;
      const raw = floor + percent * range;
      return Math.round(raw / step) * step;
    },
    [floor, range, step]
  );

  const handlePointerMove = useCallback(
    (clientX: number) => {
      if (!dragging) return;
      const val = getValueFromPosition(clientX);
      if (dragging === 'min') {
        const newMin = Math.max(floor, Math.min(val, safeMax - step));
        onChange(newMin, safeMax);
      } else {
        const newMax = Math.max(safeMin + step, Math.min(val, ceiling));
        onChange(safeMin, newMax);
      }
    },
    [dragging, floor, ceiling, step, safeMin, safeMax, getValueFromPosition, onChange]
  );

  // Mouse events
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => handlePointerMove(e.clientX);
    const onUp = () => setDragging(null);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragging, handlePointerMove]);

  // Touch events
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: TouchEvent) => {
      if (e.touches.length > 0) handlePointerMove(e.touches[0].clientX);
    };
    const onUp = () => setDragging(null);
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onUp);
    return () => {
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
    };
  }, [dragging, handlePointerMove]);

  const handleTrackClick = (e: React.MouseEvent | React.TouchEvent) => {
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const val = getValueFromPosition(clientX);
    // Move the closest handle
    const distToMin = Math.abs(val - safeMin);
    const distToMax = Math.abs(val - safeMax);
    if (distToMin < distToMax) {
      onChange(Math.max(floor, Math.min(val, safeMax - step)), safeMax);
    } else {
      onChange(safeMin, Math.max(safeMin + step, Math.min(val, ceiling)));
    }
  };

  return (
    <div className="w-full select-none">
      {/* Value Display */}
      <div className="flex items-center justify-between mb-3">
        <div className="text-center">
          <p className="text-[9px] text-[#5C5E72] uppercase tracking-wider mb-0.5">Min</p>
          <p className="text-sm font-bold text-[#3B82F6]">{formatCurrencyFull(safeMin)}</p>
        </div>
        <div className="flex-1 mx-3 h-px bg-[#1E1E2C]" />
        <div className="text-center">
          <p className="text-[9px] text-[#5C5E72] uppercase tracking-wider mb-0.5">Max</p>
          <p className="text-sm font-bold text-[#3B82F6]">{formatCurrencyFull(safeMax)}</p>
        </div>
      </div>

      {/* Slider Track */}
      <div
        ref={trackRef}
        className="relative h-10 flex items-center cursor-pointer touch-none"
        onClick={handleTrackClick}
        onTouchStart={handleTrackClick}
      >
        {/* Background track */}
        <div className="absolute inset-x-0 h-1.5 rounded-full bg-[#1A1A24]" />

        {/* Active range */}
        <div
          className="absolute h-1.5 rounded-full bg-gradient-to-r from-[#3B82F6] to-[#2563EB]"
          style={{ left: `${minPercent}%`, width: `${maxPercent - minPercent}%` }}
        />

        {/* Min Handle */}
        <div
          className={`absolute w-6 h-6 rounded-full bg-[#3B82F6] border-[3px] border-[#0A0A0F] shadow-lg shadow-blue-500/30 cursor-grab active:cursor-grabbing active:scale-110 transition-transform z-10 ${dragging === 'min' ? 'scale-110 ring-2 ring-blue-400/30' : ''}`}
          style={{ left: `${minPercent}%`, transform: 'translateX(-50%)' }}
          onMouseDown={(e) => { e.stopPropagation(); setDragging('min'); }}
          onTouchStart={(e) => { e.stopPropagation(); setDragging('min'); }}
        />

        {/* Max Handle */}
        <div
          className={`absolute w-6 h-6 rounded-full bg-[#3B82F6] border-[3px] border-[#0A0A0F] shadow-lg shadow-blue-500/30 cursor-grab active:cursor-grabbing active:scale-110 transition-transform z-10 ${dragging === 'max' ? 'scale-110 ring-2 ring-blue-400/30' : ''}`}
          style={{ left: `${maxPercent}%`, transform: 'translateX(-50%)' }}
          onMouseDown={(e) => { e.stopPropagation(); setDragging('max'); }}
          onTouchStart={(e) => { e.stopPropagation(); setDragging('max'); }}
        />
      </div>

      {/* Scale Labels */}
      <div className="flex justify-between mt-1">
        <span className="text-[9px] text-[#5C5E72]">{formatCurrency(floor)}</span>
        <span className="text-[9px] text-[#5C5E72]">{formatCurrency(ceiling)}</span>
      </div>

      {/* Manual Input Boxes */}
      <div className="grid grid-cols-2 gap-3 mt-4">
        <div>
          <label className="text-[9px] text-[#5C5E72] mb-1 block">Min (₦)</label>
          <input
            type="number"
            min={floor}
            max={ceiling}
            step={step}
            value={safeMin}
            onChange={(e) => {
              const val = Number(e.target.value);
              if (isNaN(val)) return;
              const clamped = Math.max(floor, Math.min(val, ceiling));
              // If min exceeds max, push max up to maintain gap
              const newMin = Math.min(clamped, safeMax - step);
              onChange(newMin, Math.max(newMin + step, safeMax));
            }}
            className="w-full h-10 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-xs px-3 focus:border-[#3B82F6]/50 outline-none"
          />
        </div>
        <div>
          <label className="text-[9px] text-[#5C5E72] mb-1 block">Max (₦)</label>
          <input
            type="number"
            min={floor}
            max={ceiling}
            step={step}
            value={safeMax}
            onChange={(e) => {
              const val = Number(e.target.value);
              if (isNaN(val)) return;
              const clamped = Math.max(floor, Math.min(val, ceiling));
              // If max drops below min, push min down to maintain gap
              const newMax = Math.max(clamped, safeMin + step);
              onChange(Math.min(safeMin, newMax - step), newMax);
            }}
            className="w-full h-10 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-xs px-3 focus:border-[#3B82F6]/50 outline-none"
          />
        </div>
      </div>
    </div>
  );
}
