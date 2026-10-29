import DualRangeSlider, {type PriceRangeMode} from './DualRangeSlider';
import {PUBLIC_CATALOG_MAX_PRICE} from '@/lib/publicCatalogContract';

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

  const displayFloor = minValue === '' ? floor : Math.min(floor, minValue);
  const displayCeiling = Math.min(PUBLIC_CATALOG_MAX_PRICE,Math.max(ceiling,
    minValue === '' ? 0 : minValue + step,maxValue === '' ? 0 : maxValue + step));
  const selectedMin = minValue === '' ? displayFloor : Math.max(displayFloor, Math.min(minValue, displayCeiling - step));
  const selectedMax = maxValue === '' ? displayCeiling : Math.min(displayCeiling, Math.max(maxValue, selectedMin + step));
  const active = minValue !== '' || maxValue !== '';

  function change(nextMin: number, nextMax: number,mode?:PriceRangeMode) {
    onMinChange(mode?mode.minimumOpen?'':nextMin:nextMin <= displayFloor ? '' : nextMin);
    onMaxChange(mode?mode.maximumOpen?'':nextMax:nextMax >= displayCeiling ? '' : nextMax);
  }

  return (
    <section>
      <div className="mb-2 flex items-end justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-[var(--wh-text)]">{label}</p>
          {helper ? <p className="mt-1 text-xs leading-relaxed text-[var(--wh-text-secondary)]">{helper}</p> : null}
        </div>
        {active ? (
          <button type="button" onClick={() => { onMinChange(''); onMaxChange(''); }} className="min-h-11 shrink-0 text-xs font-semibold text-[var(--wh-accent-text)]">
            Clear
          </button>
        ) : null}
      </div>
      <DualRangeSlider min={selectedMin} max={selectedMax} floor={displayFloor} ceiling={displayCeiling} step={step} onChange={change}
        minimumOpen={minValue===''} maximumOpen={maxValue===''} maxCustomPrice={PUBLIC_CATALOG_MAX_PRICE}/>
      <p className="mt-2 text-xs leading-5 text-[var(--wh-text-secondary)]">Leave To empty for no maximum. You can type a price beyond the displayed range.</p>
    </section>
  );
}
