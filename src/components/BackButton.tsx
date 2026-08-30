type Props = {
  onClick: () => void;
  className?: string;
};

export default function BackButton({ onClick, className = '' }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Back"
      className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-white/[.08] bg-white/[.03] text-[#9DA3B2] transition hover:bg-white/[.05] hover:text-white ${className}`}
    >
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <path d="m15 18-6-6 6-6" />
      </svg>
    </button>
  );
}
