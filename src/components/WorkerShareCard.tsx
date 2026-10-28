import { UserRound, X } from "lucide-react";
import "@/components/message-attachments.css";

export function WorkerDraftAttachment({ onRemove,activity=false }: { onRemove: () => void;activity?:boolean }) {
  return <div className="wh-attachment-surface wh-property-draft" aria-label={activity?'Activity ready to send':'Worker profile ready to send'}><span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-violet-500/15 text-[var(--wh-accent-text)]"><UserRound size={23} aria-hidden="true" /></span><span className="min-w-0 flex-1"><span className="block text-xs font-semibold text-[var(--wh-accent-text)]">{activity?'Activity suggestion':'Service Worker recommendation'}</span><span className="block text-sm">Ready to share in this chat</span></span><button type="button" className="wh-attachment-remove" aria-label={activity?'Remove activity from message':'Remove Worker profile from message'} onClick={onRemove}><X size={18} aria-hidden="true" /></button></div>;
}
