type Props = {
  label: string;
  minimum: number;
  maximum: number;
  minValue: number | '';
  maxValue: number | '';
  onMinChange: (value: number | '') => void;
  onMaxChange: (value: number | '') => void;
};

function money(value: number) {
  return `₦${Math.round(value).toLocaleString()}`;
}

function stepFor(minimum: number, maximum: number) {
  const span = Math.max(0, maximum - minimum);
  if (span >= 10_000_000) return 100_000;
  if (span >= 2_000_000) return 50_000;
  if (span >= 500_000) return 10_000;
  if (span >= 100_000) return 5_000;
  return 1_000;
}

export default function DiscoveryPriceRangeSlider({ label, minimum, maximum, minValue, maxValue, onMinChange, onMaxChange }: Props) {
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || maximum <= minimum) return null;

  const step = stepFor(minimum, maximum);
  const selectedMin = minValue === '' ? minimum : Math.max(minimum, Math.min(minValue, maximum));
  const selectedMax = maxValue === '' ? maximum : Math.max(minimum, Math.min(maxValue, maximum));
  const low = Math.min(selectedMin, selectedMax);
  const high = Math.max(selectedMin, selectedMax);
  const filtered = minValue !== '' || maxValue !== '';

  function setLow(next: number) {
    const safe = Math.min(next, high);
    onMinChange(safe <= minimum ? '' : safe);
  }

  function setHigh(next: number) {
    const safe = Math.max(next, low);
    onMaxChange(safe >= maximum ? '' : safe);
  }

  return (
    <section className="rounded-2xl border border-white/[.07] bg-[#151922] p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-medium text-[#7B8190]">{label}</p>
          <p className="mt-1 text-sm font-bold text-white">{filtered ? `${money(low)} – ${money(high)}` : `${money(minimum)} – ${money(maximum)}`}</p>
          <p className="mt-1 text-[8px] text-[#62697A]">Range comes from prices currently available on WeHouse.</p>
        </div>
        {filtered ? <button type="button" onClick={() => { onMinChange(''); onMaxChange(''); }} className="text-[9px] font-semibold text-violet-300">Clear</button> : null}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block rounded-xl border border-white/[.055] bg-black/10 p-3">
          <span className="flex items-center justify-between text-[8px] text-[#747B8C]"><span>Minimum</span><strong className="font-semibold text-[#C7CBD5]">{money(low)}</strong></span>
          <input type="range" min={minimum} max={maximum} step={step} value={low} onChange={event => setLow(Number(event.target.value))} className="mt-3 h-2 w-full cursor-pointer accent-violet-500" aria-label={`${label} minimum`} />
        </label>
        <label className="block rounded-xl border border-white/[.055] bg-black/10 p-3">
          <span className="flex items-center justify-between text-[8px] text-[#747B8C]"><span>Maximum</span><strong className="font-semibold text-[#C7CBD5]">{money(high)}</strong></span>
          <input type="range" min={minimum} max={maximum} step={step} value={high} onChange={event => setHigh(Number(event.target.value))} className="mt-3 h-2 w-full cursor-pointer accent-violet-500" aria-label={`${label} maximum`} />
        </label>
      </div>
    </section>
  );
}
