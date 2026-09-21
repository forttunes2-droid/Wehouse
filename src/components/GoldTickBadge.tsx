type Props = {
  size?: 'sm' | 'md';
  title?: string;
  className?: string;
};

/** A paid membership label; it does not represent identity or work verification. */
export default function GoldTickBadge({ size = 'md', title = 'Pro membership', className = '' }: Props) {
  return (
    <span
      aria-label={title}
      title={title}
      className={`inline-flex shrink-0 items-center rounded-full border border-amber-300/30 bg-amber-300/10 font-bold tracking-wide text-amber-200 ${size === 'sm' ? 'px-1.5 py-0.5 text-[8px]' : 'px-2 py-1 text-[9px]'} ${className}`}
    >
      PRO
    </span>
  );
}
