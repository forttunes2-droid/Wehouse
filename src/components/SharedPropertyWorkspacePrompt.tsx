import { createPortal } from 'react-dom';
import { useDialogInteraction } from '@/hooks/useDialogInteraction';
import { useRecordScreenBack } from '@/hooks/useRecordScreenBack';
export default function SharedPropertyWorkspacePrompt({ onConfirm, onDismiss }: { onConfirm: () => void; onDismiss: () => void }) {
  const dismiss = useRecordScreenBack(onDismiss);
  const ref = useDialogInteraction(dismiss);
  return createPortal(<div ref={ref} tabIndex={-1} className="fixed inset-0 z-[100070] flex items-center justify-center bg-black/70 p-5 text-white">
    <section role="dialog" aria-modal="true" aria-labelledby="shared-property-workspace-title" className="w-full max-w-md rounded-3xl border border-white/10 bg-[#10131B] p-6">
      <h2 id="shared-property-workspace-title" className="text-lg font-semibold">View shared property</h2>
      <p className="mt-3 text-sm leading-6 text-[#B8B1C2]">This link opens the customer view in Personal. Your team access and work records will not change.</p>
      <button type="button" onClick={onConfirm} className="mt-5 min-h-12 w-full rounded-xl bg-violet-600 px-4 font-semibold">Open in Personal</button>
      <button type="button" onClick={dismiss} className="mt-2 min-h-11 w-full font-medium text-violet-300">Stay in this workspace</button>
    </section>
  </div>, document.body);
}
