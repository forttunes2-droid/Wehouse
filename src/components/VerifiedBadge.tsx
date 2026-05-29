/**
 * VerifiedBadge — Blue circle with white checkmark
 * Matches the classic verified badge style
 */
export default function VerifiedBadge({ size = 16, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      style={{ flexShrink: 0 }}
    >
      {/* Blue circle background */}
      <circle cx="12" cy="12" r="12" fill="#1DA1F2" />
      {/* White checkmark */}
      <path
        d="M7 12.5L10.5 16L17 9"
        stroke="white"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}
