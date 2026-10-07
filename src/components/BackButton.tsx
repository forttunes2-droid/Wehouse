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
      className={`grid h-11 w-11 shrink-0 place-items-center rounded-full border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] text-[var(--wh-text-secondary)] shadow-[var(--wh-shadow-sm)] transition-[background-color,border-color,color,box-shadow,transform] hover:border-[var(--wh-border)] hover:bg-[var(--wh-interactive)] hover:text-[var(--wh-text)] hover:shadow-[var(--wh-shadow-md)] active:scale-[.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-400 ${className}`}
    >
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m12 19-7-7 7-7M5 12h14" />
      </svg>
    </button>
  );
}
