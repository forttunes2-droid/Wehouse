import {useEffect,useRef,useState} from 'react';
import {toast} from 'sonner';
import {issueMyHotelStayCode} from '@/lib/supabase/hotels';
import {withTimeout} from '@/lib/withTimeout';
export default function HotelPresenceCode({ bookingId, status }: { bookingId: number; status: "confirmed" | "checked_in" }) {
  const [receipt, setReceipt] = useState<{bookingId:number;status:typeof status;code:string}|null>(null);
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const inFlight = useRef(false);
  const code = receipt?.bookingId === bookingId && receipt.status === status ? receipt.code : "";
  const action = status === "confirmed" ? "checked_in" : "checked_out";
  useEffect(() => {
    generation.current++;
    inFlight.current = false;
    setReceipt(null);
    setBusy(false);
    return () => { generation.current++; inFlight.current = false; };
  }, [bookingId, status]);
  async function issue() {
    if (inFlight.current) return;
    inFlight.current = true;
    const requestGeneration = generation.current;
    setReceipt(null);
    setBusy(true);
    try {
      const { code: next, error } = await withTimeout(issueMyHotelStayCode(bookingId, action),10000,"Code preparation is delayed. Try again at reception.");
      if (generation.current !== requestGeneration) return;
      if (error) throw error;
      if (typeof next !== 'string' || !/^\d{8}$/.test(next)) throw new Error("Could not verify your guest code. Please try again.");
      setReceipt({bookingId,status,code:next});
    } catch (error) {
      if (generation.current === requestGeneration) toast.error(error instanceof Error ? error.message : (error as {message?:string})?.message || "Could not prepare your guest code. Please try again.");
    } finally {
      if (generation.current === requestGeneration) { inFlight.current = false; setBusy(false); }
    }
  }
  return <div className="mt-3 rounded-xl border border-violet-500/20 bg-violet-500/[.06] p-3">
    <p className="text-xs font-semibold text-[var(--wh-accent-text)]">{status === "confirmed" ? "Arriving at the hotel" : "Leaving the hotel"}</p>
    <p className="mt-1 text-xs leading-5 text-[var(--wh-text-secondary)]">{status === "confirmed" ? "When you are at reception, show this code to hotel staff so they can verify your arrival." : "When you leave, show a departure code to hotel staff. You may leave before the scheduled checkout time."}</p>
    {code ? <p role="status" className="mt-3 rounded-lg bg-[var(--wh-interactive)] px-3 py-3 text-center font-mono text-lg font-semibold tracking-[.25em] text-[var(--wh-text)]">{code}</p> : null}
    {code ? <p className="mt-1 text-center text-[10px] text-[var(--wh-text-secondary)]">Valid for 10 minutes. Do not send it in chat.</p> : null}
    <button type="button" disabled={busy} onClick={() => void issue()} className="mt-3 min-h-11 w-full rounded-xl border border-violet-400/25 text-xs font-semibold text-[var(--wh-accent-text)] disabled:opacity-40">{busy ? "Preparing code…" : code ? "Get a new code" : status === "confirmed" ? "Show arrival code" : "Show departure code"}</button>
  </div>;
}
