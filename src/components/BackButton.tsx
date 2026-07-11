// ═══════════════════════════════════════════════════════════════
// BACK BUTTON + BREADCRUMB
// Every non-home page gets a visible back button
// Desktop: breadcrumb trail. Mobile: simple back arrow
// ═══════════════════════════════════════════════════════════════

interface BackButtonProps {
  onBack: () => void;
  label?: string;
  breadcrumb?: string[]; // e.g. ['Home', 'Profile', 'Settings']
}

export default function BackButton({ onBack, label, breadcrumb }: BackButtonProps) {
  // Desktop breadcrumb view
  if (breadcrumb && breadcrumb.length > 0) {
    return (
      <div className="flex items-center gap-2 mb-4">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-[#5C5E72] hover:text-white transition-colors group"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="group-hover:-translate-x-0.5 transition-transform"
          >
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          <span className="text-xs font-medium hidden sm:inline">Back</span>
        </button>
        <div className="flex items-center gap-1.5 text-[10px]">
          {breadcrumb.map((crumb, i) => (
            <span key={i} className="flex items-center gap-1.5">
              {i > 0 && <span className="text-[#2A2A3A]">/</span>}
              <span className={i === breadcrumb.length - 1 ? 'text-white font-medium' : 'text-[#5C5E72]'}>
                {crumb}
              </span>
            </span>
          ))}
        </div>
      </div>
    );
  }

  // Mobile/simple view
  return (
    <button
      onClick={onBack}
      className="flex items-center gap-2 text-[#5C5E72] hover:text-white transition-colors group mb-4"
    >
      <div className="w-8 h-8 rounded-lg bg-[#1A1A24] border border-[#2A2A3A] flex items-center justify-center group-hover:border-violet-500/30 transition-colors">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="group-hover:-translate-x-0.5 transition-transform"
        >
          <path d="M19 12H5M12 19l-7-7 7-7" />
        </svg>
      </div>
      {label && <span className="text-xs font-medium">{label}</span>}
    </button>
  );
}
