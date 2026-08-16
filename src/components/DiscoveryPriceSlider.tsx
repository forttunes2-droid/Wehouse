type Props = {
  label: string;
  minimum: number;
  maximum: number;
  value: number | '';
  onChange: (value: number | '') => void;
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

export default function DiscoveryPriceSlider({ label, minimum, maximum, value, onChange }: Props) {
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || maximum <= minimum) return null;

  const step = stepFor(minimum, maximum);
  const selected = value === '' ? maximum : Math.max(minimum, Math.min(value, maximum));
  const filtered = value !== '' && selected < maximum;

  return (
    <section className="rounded-2xl border border-white/[.07] bg-[#151922] p-3.5">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-medium text-[#7B8190]">{label}</p>
          <p className="mt-1 text-sm font-bold text-white">{filtered ? `Up to ${money(selected)}` : 'Any price'}</p>
        </div>
        {filtered ? (
          <button type="button" onClick={() => onChange('')} className="text-[9px] font-semibold text-violet-300">Clear</button>
        ) : null}
      </div>

      <input
        type="range"
        min={minimum}
        max={maximum}
        step={step}
        value={selected}
        onChange={(event) => {
          const next = Number(event.target.value);
          onChange(next >= maximum ? '' : next);
        }}
        className="mt-4 h-2 w-full cursor-pointer accent-violet-500"
        aria-label={label}
      />

      <div className="mt-1.5 flex justify-between text-[8px] text-[#62697A]">
        <span>{money(minimum)}</span>
        <span>{money(maximum)}</span>
      </div>
    </section>
  );
}
