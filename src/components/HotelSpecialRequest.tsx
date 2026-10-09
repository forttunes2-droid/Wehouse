import { ChevronDown, MessageSquareText } from "lucide-react";
import "./message-attachments.css";

type Props = { request?: string | null; hotelView?: boolean; inConversation?: boolean };

/** Booking context is collapsible and remains separate from actual chat messages. */
export default function HotelSpecialRequest({ request, hotelView = false, inConversation = false }: Props) {
  if (!request?.trim()) return null;
  const text = request.trim();
  return (
    <details
      aria-label={inConversation ? "Special request for this booking" : "Special request"}
      className={`wh-attachment-surface wh-request-note ${inConversation ? "wh-request-note-conversation" : "mt-3"}`}
    >
      <summary>
        {inConversation ? <span className="wh-request-icon"><MessageSquareText size={17} aria-hidden="true" /></span> : null}
        <span>
          <strong>Special request</strong>
          {inConversation ? <small>Booking request · visible to the hotel team</small> : null}
        </span>
        <ChevronDown className="wh-request-chevron" size={18} aria-hidden="true" />
      </summary>
      <div className="wh-request-body">
        <p>{text}</p>
        <small>{hotelView
          ? (inConversation ? "Reply here to tell the guest what the hotel can arrange." : "Reply in Guest messages to confirm what you can arrange.")
          : (inConversation ? "The hotel can reply here about this request." : "The hotel must confirm whether it can arrange this.")}</small>
      </div>
    </details>
  );
}
