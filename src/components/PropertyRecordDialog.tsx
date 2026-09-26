import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useDialogInteraction } from '@/hooks/useDialogInteraction';

/** One screen owns the property dialog during loading, failure and review. */
export default function PropertyRecordDialog({ onClose, children }: {
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useDialogInteraction(onClose);
  return createPortal(
    <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true"
      aria-label="Property workflow"
      className="fixed inset-0 z-[100020] bg-[#080A0F] text-white">
      {children}
    </div>, document.body,
  );
}
