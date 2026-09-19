type Props = {
  onClick: () => void;
  className?: string;
  ariaLabel?: string;
};

export default function BackButton({ onClick, className = '', ariaLabel = 'Back' }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      title={ariaLabel}
      className={`-ml-2 grid h-11 w-11 shrink-0 place-items-center rounded-lg text-[#AAA3B3] transition hover:bg-white/[.04] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-400 ${className}`}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m15 18-6-6 6-6" />
      </svg>
    </button>
  );
}
