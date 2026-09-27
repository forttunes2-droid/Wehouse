import { ChevronDown, MessageSquareText } from 'lucide-react';
import './message-attachments.css';

type Props = { request?: string | null; hotelView?: boolean; inConversation?: boolean };
export default function HotelSpecialRequest({ request, hotelView = false, inConversation = false }: Props) {
  if (!request?.trim()) return null;
  const body = <div className="wh-request-body"><p>{request}</p><small>{hotelView ? 'Reply to confirm what the hotel can arrange.' : 'A request, not a confirmation. The hotel can reply here.'}</small></div>;
  if (inConversation) return <details className="wh-attachment-surface wh-request-note"><summary><MessageSquareText size={19} aria-hidden="true" /><span><strong>Special request</strong><small>Sent with this booking</small></span><ChevronDown size={18} aria-hidden="true" className="wh-request-chevron" /></summary>{body}</details>;
  return <section aria-label="Special request" className="wh-attachment-surface wh-request-note mt-3"><div className="px-3 pt-3 text-sm font-semibold">Special request</div><div className="wh-request-body !border-0"><p>{request}</p><small>{hotelView ? 'Reply in Guest messages to confirm what you can arrange.' : 'The hotel must confirm whether it can arrange this.'}</small></div></section>;
}
