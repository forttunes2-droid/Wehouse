import { useEffect } from 'react';

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning' | 'info';
}

interface ConfirmDialogProps extends ConfirmOptions {
  isOpen: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const variantColors = {
  danger: { btn: 'bg-red-500 hover:bg-red-600', text: 'text-red-400', icon: 'bg-red-500/15 border-red-500/20' },
  warning: { btn: 'bg-amber-500 hover:bg-amber-600', text: 'text-amber-400', icon: 'bg-amber-500/15 border-amber-500/20' },
  info: { btn: 'bg-[#3B82F6] hover:bg-[#2563EB]', text: 'text-[#3B82F6]', icon: 'bg-[#3B82F6]/15 border-[#3B82F6]/20' },
};

export default function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'danger',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  const colors = variantColors[variant];

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center px-6 animate-fadeIn"
      onClick={onCancel}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

      {/* Dialog */}
      <div
        className="relative w-full max-w-[320px] glass-strong rounded-2xl p-5 border border-[#2A2A3A] shadow-2xl animate-fadeIn"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Icon */}
        <div className="flex justify-center mb-4">
          <div className={`w-12 h-12 rounded-2xl flex items-center justify-center border ${colors.icon}`}>
            {variant === 'danger' && (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="2" strokeLinecap="round">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            )}
            {variant === 'warning' && (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="2" strokeLinecap="round">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            )}
            {variant === 'info' && (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2" strokeLinecap="round">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
            )}
          </div>
        </div>

        {/* Title */}
        <h3 className="text-base font-bold text-white text-center mb-1.5">{title}</h3>

        {/* Message */}
        <p className="text-xs text-[#8A8B9C] text-center leading-relaxed mb-5">{message}</p>

        {/* Buttons */}
        <div className="flex gap-2.5">
          <button
            onClick={onCancel}
            className="flex-1 h-11 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm font-medium hover:bg-[#232330] transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className={`flex-1 h-11 rounded-xl text-white text-sm font-semibold transition-colors ${colors.btn}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
