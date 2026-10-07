import { MessageSquareText } from "lucide-react";
import "./message-attachments.css";

type Props = { request?: string | null; hotelView?: boolean; inConversation?: boolean };

/** Booking context is shown in chat without being written as a fake message. */
export default function HotelSpecialRequest({ request, hotelView = false, inConversation = false }: Props) {
  if (!request?.trim()) return null;
  const text = request.trim();
  if (inConversation) {
    return (
      <section aria-label="Special request for this booking" className="wh-attachment-surface wh-request-note wh-request-note-conversation">
        <div className="wh-request-conversation-head">
          <span className="wh-request-icon"><MessageSquareText size={17} aria-hidden="true" /></span>
          <span className="min-w-0"><strong>Special request</strong><small>Booking request · visible to the hotel team</small></span>
        </div>
        <div className="wh-request-body">
          <p>{text}</p>
          <small>{hotelView ? "Reply here to tell the guest what the hotel can arrange." : "The hotel can reply here about this request."}</small>
        </div>
      </section>
    );
  }
  return (
    <section aria-label="Special request" className="wh-attachment-surface wh-request-note mt-3">
      <div className="px-3 pt-3 text-sm font-semibold">Special request</div>
      <div className="wh-request-body !border-0"><p>{text}</p><small>{hotelView ? "Reply in Guest messages to confirm what you can arrange." : "The hotel must confirm whether it can arrange this."}</small></div>
    </section>
  );
}
