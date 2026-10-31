import {useEffect,useState} from 'react';
import {toast} from 'sonner';
import {issueMyHotelStayCode} from '@/lib/supabase/hotels';
export default function HotelPresenceCode({ bookingId, status }: { bookingId: number; status: "confirmed" | "checked_in" }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const action = status === "confirmed" ? "checked_in" : "checked_out";
  useEffect(() => { setCode(""); }, [bookingId, status]);
  async function issue() {
    if (busy) return;
    setBusy(true);
    const { code: next, error } = await issueMyHotelStayCode(bookingId, action);
    setBusy(false);
    if (error || !next) return toast.error(error?.message || "Could not prepare your guest code");
    setCode(next);
  }
  return <div className="mt-3 rounded-xl border border-violet-500/20 bg-violet-500/[.06] p-3">
    <p className="text-xs font-semibold text-[var(--wh-accent-text)]">{status === "confirmed" ? "Arriving at the hotel" : "Leaving the hotel"}</p>
    <p className="mt-1 text-xs leading-5 text-[var(--wh-text-secondary)]">{status === "confirmed" ? "When you are at reception, show this code to hotel staff so they can verify your arrival." : "When you leave, show a departure code to hotel staff. You may leave before the scheduled checkout time."}</p>
    {code ? <p role="status" className="mt-3 rounded-lg bg-[var(--wh-interactive)] px-3 py-3 text-center font-mono text-lg font-semibold tracking-[.25em] text-[var(--wh-text)]">{code}</p> : null}
    {code ? <p className="mt-1 text-center text-[10px] text-[var(--wh-text-secondary)]">Valid for 10 minutes. Do not send it in chat.</p> : null}
    <button type="button" disabled={busy} onClick={() => void issue()} className="mt-3 min-h-11 w-full rounded-xl border border-violet-400/25 text-xs font-semibold text-[var(--wh-accent-text)] disabled:opacity-40">{busy ? "Preparing code…" : code ? "Get a new code" : status === "confirmed" ? "Show arrival code" : "Show departure code"}</button>
  </div>;
}
