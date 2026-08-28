import { useEffect } from 'react';

export interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning' | 'info';
}

interface ConfirmDialogProps extends ConfirmOptions {
  isOpen: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const btnColors: Record<string, string> = {
  danger: 'bg-red-500 hover:bg-red-600',
  warning: 'bg-amber-500 hover:bg-amber-600',
  info: 'bg-[#8B5CF6] hover:bg-[#7C3AED]',
};

export default function ConfirmDialog({
  isOpen,
  title,
  description,
  confirmLabel = 'Proceed',
  cancelLabel = 'Cancel',
  variant = 'danger',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100000] flex items-end justify-center p-3 pb-[max(.75rem,env(safe-area-inset-bottom))] animate-fadeIn sm:items-center sm:px-6" onClick={onCancel} role="presentation">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-sm rounded-[28px] border border-white/[.09] bg-[#11141C] p-5 shadow-2xl animate-fadeIn"
        onClick={(e) => e.stopPropagation()}
        role="alertdialog" aria-modal="true" aria-labelledby="confirm-dialog-title"
      >
        <p className="text-[8px] font-bold uppercase tracking-[.2em] text-violet-300">WEHOUSE CONFIRMATION</p>
        <p id="confirm-dialog-title" className="mt-2 text-lg font-bold text-white">{title}</p>
        {description&&<p className="mt-2 text-[11px] leading-5 text-[#858B9A]">{description}</p>}
        <div className="flex gap-2.5">
          <button
            onClick={onCancel}
            className="mt-5 h-12 flex-1 rounded-full border border-white/[.09] bg-white/[.03] text-xs font-semibold text-[#A1A6B3] hover:text-white transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className={`mt-5 h-12 flex-1 rounded-full text-white text-xs font-bold transition-colors ${btnColors[variant]}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
