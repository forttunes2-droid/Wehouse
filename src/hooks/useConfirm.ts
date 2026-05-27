import { useState, useCallback } from 'react';
import type { ConfirmOptions } from '@/components/ConfirmDialog';

interface ConfirmState extends ConfirmOptions {
  isOpen: boolean;
  resolve: ((value: boolean) => void) | null;
}

export function useConfirm() {
  const [state, setState] = useState<ConfirmState>({
    isOpen: false,
    title: '',
    message: '',
    confirmLabel: 'Confirm',
    cancelLabel: 'Cancel',
    variant: 'danger',
    resolve: null,
  });

  const confirm = useCallback(
    (options: ConfirmOptions): Promise<boolean> => {
      return new Promise((resolve) => {
        setState({
          ...options,
          isOpen: true,
          resolve,
        });
      });
    },
    []
  );

  const handleConfirm = useCallback(() => {
    state.resolve?.(true);
    setState((s) => ({ ...s, isOpen: false, resolve: null }));
  }, [state.resolve]);

  const handleCancel = useCallback(() => {
    state.resolve?.(false);
    setState((s) => ({ ...s, isOpen: false, resolve: null }));
  }, [state.resolve]);

  return {
    ask: confirm,
    dialogProps: {
      isOpen: state.isOpen,
      title: state.title,
      message: state.message,
      confirmLabel: state.confirmLabel,
      cancelLabel: state.cancelLabel,
      variant: state.variant,
      onConfirm: handleConfirm,
      onCancel: handleCancel,
    },
  };
}
