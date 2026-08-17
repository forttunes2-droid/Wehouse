import DualRangeSlider from './DualRangeSlider';

type Props = {
  label: string;
  floor: number;
  ceiling: number;
  step: number;
  minValue: number | '';
  maxValue: number | '';
  onMinChange: (value: number | '') => void;
  onMaxChange: (value: number | '') => void;
  helper?: string;
};

export default function DiscoveryPriceRangeSlider({
  label,
  floor,
  ceiling,
  step,
  minValue,
  maxValue,
  onMinChange,
  onMaxChange,
  helper,
}: Props) {
  if (!Number.isFinite(floor) || !Number.isFinite(ceiling) || ceiling <= floor || step <= 0) return null;

  const selectedMin = minValue === '' ? floor : Math.max(floor, Math.min(minValue, ceiling - step));
  const selectedMax = maxValue === '' ? ceiling : Math.min(ceiling, Math.max(maxValue, selectedMin + step));
  const active = minValue !== '' || maxValue !== '';

  function change(nextMin: number, nextMax: number) {
    onMinChange(nextMin <= floor ? '' : nextMin);
    onMaxChange(nextMax >= ceiling ? '' : nextMax);
  }

  return (
    <section>
      <div className="mb-2 flex items-end justify-between gap-3">
        <div>
          <p className="text-[9px] font-semibold uppercase tracking-wide text-[#74798A]">{label}</p>
          {helper ? <p className="mt-1 text-[9px] leading-relaxed text-[#606777]">{helper}</p> : null}
        </div>
        {active ? (
          <button type="button" onClick={() => { onMinChange(''); onMaxChange(''); }} className="shrink-0 text-[9px] font-semibold text-violet-300">
            Clear
          </button>
        ) : null}
      </div>
      <DualRangeSlider min={selectedMin} max={selectedMax} floor={floor} ceiling={ceiling} step={step} onChange={change} />
    </section>
  );
}
