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
      className={`grid h-11 w-11 shrink-0 place-items-center rounded-full text-[#C7C3D0] transition hover:bg-white/[.04] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-400 ${className}`}
    >
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m12 19-7-7 7-7M5 12h14" />
      </svg>
    </button>
  );
}
