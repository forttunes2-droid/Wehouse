type Props = {
  onPrevious?: () => void;
  onNext?: () => void;
  previousLabel?: string;
  nextLabel?: string;
};

/** The picture stays free of paging chrome. Keep explicit actions in the
 * accessibility tree and reveal text controls only for keyboard focus. */
export default function MediaPagingActions({ onPrevious, onNext, previousLabel = "Previous media", nextLabel = "Next media" }: Props) {
  const control = "sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:bottom-4 focus-visible:z-[100210] focus-visible:min-h-11 focus-visible:rounded-xl focus-visible:border focus-visible:border-white/30 focus-visible:bg-black focus-visible:px-4 focus-visible:py-3 focus-visible:text-sm focus-visible:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-400";
  return <>
    <button type="button" data-media-paging-action aria-label={previousLabel} disabled={!onPrevious} onClick={onPrevious} className={`${control} focus-visible:left-4`}>{previousLabel}</button>
    <button type="button" data-media-paging-action aria-label={nextLabel} disabled={!onNext} onClick={onNext} className={`${control} focus-visible:right-4`}>{nextLabel}</button>
  </>;
}
