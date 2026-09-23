type Props = { request?: string | null; hotelView?: boolean; inConversation?: boolean };
export default function HotelSpecialRequest({ request, hotelView = false, inConversation = false }: Props) {
  if (!request?.trim()) return null;
  return <section aria-label="Special request" className="mt-3 rounded-xl border border-violet-400/15 bg-violet-500/[.04] p-3">
    {!inConversation && <h3 className="text-sm font-semibold text-violet-200">Special request</h3>}
    <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-[#CDD1DC]">{request}</p>
    <p className="mt-2 text-xs leading-5 text-[#A1A7B4]">{hotelView ? inConversation ? 'Confirm with the guest what you can arrange.' : 'Reply in Guest messages to confirm what you can arrange.' : 'Sent with your booking. The hotel must confirm whether it can arrange this.'}</p>
  </section>;
}
