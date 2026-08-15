type Props = {
  size?: 'sm' | 'md';
  title?: string;
  className?: string;
};

export default function GoldTickBadge({ size = 'md', title = 'Gold Tick · verification payment confirmed', className = '' }: Props) {
  const dimensions = size === 'sm' ? 'h-[15px] w-[15px]' : 'h-[18px] w-[18px]';

  return (
    <span
      role="img"
      aria-label={title}
      title={title}
      className={`inline-grid shrink-0 place-items-center align-middle ${dimensions} ${className}`}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" className="h-full w-full drop-shadow-[0_0_6px_rgba(245,190,48,.28)]">
        <defs>
          <linearGradient id="wh-gold-tick" x1="4" y1="3" x2="20" y2="21" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#FFF1A8" />
            <stop offset="0.42" stopColor="#F6C84A" />
            <stop offset="1" stopColor="#C58B11" />
          </linearGradient>
        </defs>
        <path d="M12 1.9 14.18 4l2.94-.42.82 2.84 2.66 1.3-1.37 2.63 1.37 2.63-2.66 1.3-.82 2.84-2.94-.42L12 18.8l-2.18-2.1-2.94.42-.82-2.84-2.66-1.3 1.37-2.63L3.4 7.72l2.66-1.3.82-2.84L9.82 4 12 1.9Z" fill="url(#wh-gold-tick)" stroke="#FFE88A" strokeWidth=".55" />
        <path d="m8.1 10.55 2.36 2.32 5.45-5.5" fill="none" stroke="#231703" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}
