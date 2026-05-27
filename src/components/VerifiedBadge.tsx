/**
 * VerifiedBadge — Social media style verified checkmark
 * Looks like Twitter/X verified badge
 */
export default function VerifiedBadge({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className="inline-block flex-shrink-0"
      aria-label="Verified"
    >
      {/* Blue circle background */}
      <circle cx="12" cy="12" r="12" fill="#3B82F6" />
      {/* White checkmark */}
      <path
        d="M7 12.5L10.5 16L17 9.5"
        stroke="white"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}
