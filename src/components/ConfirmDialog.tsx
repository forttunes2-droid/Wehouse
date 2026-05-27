import { useEffect } from 'react';

export interface ConfirmOptions {
  title: string;
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
  info: 'bg-[#3B82F6] hover:bg-[#2563EB]',
};

export default function ConfirmDialog({
  isOpen,
  title,
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
    <div className="fixed inset-0 z-[60] flex items-center justify-center px-6 animate-fadeIn" onClick={onCancel}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        className="relative w-full max-w-[280px] bg-[#12121A] rounded-2xl p-5 border border-[#1E1E2C] shadow-2xl animate-fadeIn"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-sm font-semibold text-white text-center mb-4">{title}</p>
        <div className="flex gap-2.5">
          <button
            onClick={onCancel}
            className="flex-1 h-10 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-[#8A8B9C] text-sm font-medium hover:text-white transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className={`flex-1 h-10 rounded-xl text-white text-sm font-semibold transition-colors ${btnColors[variant]}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
