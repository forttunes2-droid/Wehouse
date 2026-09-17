type Props = {
  latitude: number;
  longitude: number;
  label?: string;
  height?: number;
  approximate?: boolean;
  showDirections?: boolean;
  editable?: boolean;
  onPositionChange?: (point: { latitude: number; longitude: number }) => void;
};

/**
 * Compatibility surface for older callers.
 *
 * Human-facing WeHouse screens are address-first. Raw latitude/longitude and
 * device accuracy remain technical data for server-side verification,
 * distance calculations and provider integrations; they are not rendered or
 * editable here.
 */
export default function LocationMap({ label = "Location" }: Props) {
  return (
    <section className="rounded-2xl border border-white/[0.08] bg-[#10131B] p-4">
      <p className="text-[10px] font-semibold text-white">{label}</p>
      <p className="mt-1 text-[9px] leading-5 text-[#6D7182]">
        Use the written street address shown in this record. Technical location
        data is retained behind the WeHouse interface for verification and
        distance calculations.
      </p>
    </section>
  );
}
