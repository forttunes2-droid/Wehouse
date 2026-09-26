import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useCreatorAuth } from "@/hooks/useCreatorAuth";
import { isMoneyPolicyResponse } from "@/lib/bookingMoneyPolicyResponse";

type Rules = {
  short_let: {
    reservation_hold_minutes: number;
    full_refund_hours_before_check_in: number;
    late_cancel_max_nights: number;
    no_show_max_nights: number;
    security_deposit_enabled: boolean;
    security_deposit_max_nights: number;
    partner_claim_hours: number;
    guest_response_hours: number;
    arrival_issue_hours: number;
  };
  long_let: {
    reservation_amount: number;
    payment_hold_minutes: number;
    hold_hours: number;
    full_refund_hours: number;
    installments_enabled: boolean;
    security_deposit_enabled: boolean;
  };
  commissions: {
    short_let_percent: number;
    long_let_percent: number;
    hotel_percent: number;
    service_worker_percent: number;
  };
  service_worker: {
    completion_reminder_hours: number;
    release_eligible_hours: number;
  };
};

const DEFAULTS: Rules = {
  short_let: {
    reservation_hold_minutes: 30,
    full_refund_hours_before_check_in: 48,
    late_cancel_max_nights: 1,
    no_show_max_nights: 1,
    security_deposit_enabled: true,
    security_deposit_max_nights: 1,
    partner_claim_hours: 24,
    guest_response_hours: 48,
    arrival_issue_hours: 2,
  },
  long_let: {
    reservation_amount: 10000,
    payment_hold_minutes: 30,
    hold_hours: 72,
    full_refund_hours: 24,
    installments_enabled: false,
    security_deposit_enabled: false,
  },
  commissions: {
    short_let_percent: 10,
    long_let_percent: 5,
    hotel_percent: 12,
    service_worker_percent: 8,
  },
  service_worker: {
    completion_reminder_hours: 12,
    release_eligible_hours: 24,
  },
};

type PolicyPayload = {
  version?: number;
  effective_from?: string;
  value?: Record<string, unknown>;
};

type PolicyResponse = {
  active?: Record<string, PolicyPayload>;
  scheduled?: Record<string, PolicyPayload>;
};

const numberValue = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const booleanValue = (value: unknown, fallback: boolean) =>
  typeof value === "boolean" ? value : fallback;

function readRules(response: PolicyResponse | null): Rules {
  const active = response?.active || {};
  const value = (key: string) => active[key]?.value || {};
  const shortHold = value("short_let_reservation_hold");
  const shortCancel = value("short_let_cancellation");
  const caution = value("short_let_caution_cap");
  const cautionWindows = value("caution_claim_windows");
  const arrival = value("accommodation_arrival_issue_window");
  const longFee = value("long_let_reservation_fee");
  const longHold = value("long_let_reservation_hold");
  const installments = value("future_long_let_installments");
  const workerRelease = value("worker_completion_release");

  return {
    short_let: {
      reservation_hold_minutes: numberValue(
        shortHold.minutes,
        DEFAULTS.short_let.reservation_hold_minutes,
      ),
      full_refund_hours_before_check_in: numberValue(
        shortCancel.full_refund_hours_before_check_in,
        DEFAULTS.short_let.full_refund_hours_before_check_in,
      ),
      late_cancel_max_nights: numberValue(
        shortCancel.late_cancel_max_nights,
        DEFAULTS.short_let.late_cancel_max_nights,
      ),
      no_show_max_nights: numberValue(
        shortCancel.no_show_max_nights,
        DEFAULTS.short_let.no_show_max_nights,
      ),
      security_deposit_enabled: booleanValue(
        caution.enabled,
        DEFAULTS.short_let.security_deposit_enabled,
      ),
      security_deposit_max_nights: numberValue(
        caution.maximum_nights,
        DEFAULTS.short_let.security_deposit_max_nights,
      ),
      partner_claim_hours: numberValue(
        cautionWindows.partner_claim_hours,
        DEFAULTS.short_let.partner_claim_hours,
      ),
      guest_response_hours: numberValue(
        cautionWindows.guest_response_hours,
        DEFAULTS.short_let.guest_response_hours,
      ),
      arrival_issue_hours: numberValue(
        arrival.default_hours,
        DEFAULTS.short_let.arrival_issue_hours,
      ),
    },
    long_let: {
      reservation_amount: numberValue(
        longFee.amount,
        DEFAULTS.long_let.reservation_amount,
      ),
      payment_hold_minutes: numberValue(
        longFee.payment_hold_minutes,
        DEFAULTS.long_let.payment_hold_minutes,
      ),
      hold_hours: numberValue(
        longHold.hours,
        DEFAULTS.long_let.hold_hours,
      ),
      full_refund_hours: numberValue(
        longHold.full_refund_hours,
        DEFAULTS.long_let.full_refund_hours,
      ),
      installments_enabled: booleanValue(
        installments.enabled,
        DEFAULTS.long_let.installments_enabled,
      ),
      security_deposit_enabled: false,
    },
    commissions: {
      short_let_percent: numberValue(
        value("commission_short_let").percent,
        DEFAULTS.commissions.short_let_percent,
      ),
      long_let_percent: numberValue(
        value("commission_long_let").percent,
        DEFAULTS.commissions.long_let_percent,
      ),
      hotel_percent: numberValue(
        value("commission_hotel").percent,
        DEFAULTS.commissions.hotel_percent,
      ),
      service_worker_percent: numberValue(
        value("commission_worker").percent,
        DEFAULTS.commissions.service_worker_percent,
      ),
    },
    service_worker: {
      completion_reminder_hours: numberValue(
        workerRelease.reminder_hours,
        DEFAULTS.service_worker.completion_reminder_hours,
      ),
      release_eligible_hours: numberValue(
        workerRelease.release_eligible_hours,
        DEFAULTS.service_worker.release_eligible_hours,
      ),
    },
  };
}

export default function CreatorBookingMoneyRules() {
  const { requestElevation } = useCreatorAuth();
  const [rules, setRules] = useState<Rules>(DEFAULTS);
  const [saved, setSaved] = useState<Rules>(DEFAULTS);
  const [policy, setPolicy] = useState<PolicyResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const loadGeneration = useRef(0);
  const [publishing, setPublishing] = useState(false);
  const [reason, setReason] = useState("");
  const [effectiveAt, setEffectiveAt] = useState("");

  const dirty = useMemo(
    () => JSON.stringify(rules) !== JSON.stringify(saved),
    [rules, saved],
  );

  async function load() {
    const generation = ++loadGeneration.current;
    setLoading(true);
    setLoadError("");
    setPolicy(null);
    try {
      const { data, error } = await supabase.rpc("creator_get_booking_money_rules");
      if (generation !== loadGeneration.current) return;
      if (error || !isMoneyPolicyResponse(data)) throw new Error("Policy response is unavailable or incomplete");
      const next = readRules(data);
      setPolicy(data);
      setRules(next);
      setSaved(next);
    } catch {
      if (generation !== loadGeneration.current) return;
      setPolicy(null);
      setLoadError("Your saved money rules could not be loaded. Editing is unavailable until they can be verified.");
    } finally {
      if (generation === loadGeneration.current) setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    return () => { loadGeneration.current += 1; };
  }, []);

  function setShort<K extends keyof Rules["short_let"]>(
    key: K,
    value: Rules["short_let"][K],
  ) {
    setRules((current) => ({
      ...current,
      short_let: { ...current.short_let, [key]: value },
    }));
  }

  function setLong<K extends keyof Rules["long_let"]>(
    key: K,
    value: Rules["long_let"][K],
  ) {
    setRules((current) => ({
      ...current,
      long_let: { ...current.long_let, [key]: value },
    }));
  }

  function setCommission<K extends keyof Rules["commissions"]>(
    key: K,
    value: Rules["commissions"][K],
  ) {
    setRules((current) => ({
      ...current,
      commissions: { ...current.commissions, [key]: value },
    }));
  }

  function setWorker<K extends keyof Rules["service_worker"]>(
    key: K,
    value: Rules["service_worker"][K],
  ) {
    setRules((current) => ({
      ...current,
      service_worker: { ...current.service_worker, [key]: value },
    }));
  }

  async function publish(elevationId: string) {
    if (loading || loadError || !policy || publishing || !dirty) return;
    if (reason.trim().length < 5)
      return toast.error("Add a short reason for this policy change");

    setPublishing(true);
    const effective = effectiveAt
      ? new Date(effectiveAt).toISOString()
      : new Date().toISOString();
    const { data, error } = await supabase.rpc(
      "creator_publish_booking_money_rules",
      {
        p_creator_elevation_id: elevationId,
        p_rules: rules,
        p_effective_from: effective,
        p_reason: reason.trim(),
      },
    );
    setPublishing(false);
    if (error) return toast.error(error.message);
    const changed = Number((data as any)?.changed_policy_count || 0);
    toast.success(
      effectiveAt
        ? `Booking & money rules scheduled · ${changed} policy changes`
        : `Booking & money rules published · ${changed} policy changes`,
    );
    setReason("");
    setEffectiveAt("");
    await load();
  }

  function requestPublish() {
    if (loading || loadError || !policy || publishing || !dirty) return;
    const generation = loadGeneration.current;
    requestElevation("policy_publish", (elevationId) => {
      if (generation === loadGeneration.current) void publish(elevationId);
    });
  }

  if (loading)
    return (
      <div className="grid min-h-44 place-items-center">
        <div className="h-7 w-7 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" />
      </div>
    );

  if (loadError || !policy) return (
    <section role="alert" className="rounded-xl border border-white/10 p-4">
      <h3 className="text-sm font-semibold">Booking &amp; money rules</h3>
      <p className="mt-2 text-sm text-[#A4A9B6]">{loadError || "Your saved money rules are unavailable."}</p>
      <button type="button" onClick={() => void load()} className="mt-3 min-h-11 rounded-xl border border-white/10 px-4 text-sm text-violet-300">Try again</button>
    </section>
  );

  const activeVersions = Object.values(policy.active || {})
    .map((entry) => Number(entry.version || 0))
    .filter(Boolean);
  const latestVersion = activeVersions.length
    ? Math.max(...activeVersions)
    : null;
  const scheduledCount = Object.keys(policy?.scheduled || {}).length;

  return (
    <section className="space-y-6">
      <header className="border-b border-white/[.07] pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">Booking & money rules</h3>
            <p className="mt-1 max-w-2xl text-[10px] leading-5 text-[#747B8C]">
              One versioned source of truth for reservations, cancellations,
              deposits, commissions and protected-payment timing. Existing
              bookings keep the rules they accepted.
            </p>
          </div>
          <span className="rounded-full border border-white/[.08] px-2.5 py-1 text-[8px] font-semibold text-[#8E95A5]">
            {latestVersion ? `Active policy versions · up to v${latestVersion}` : "Active policy"}
          </span>
        </div>
        {scheduledCount > 0 ? (
          <p className="mt-3 text-[9px] text-amber-300">
            {scheduledCount} scheduled rule {scheduledCount === 1 ? "change" : "changes"} waiting to take effect.
          </p>
        ) : null}
      </header>

      <ShortLetReserveDateRule />
      <RuleSection
        title="Short Let"
        note="Reserve dates briefly while payment is completed. Cancellation, no-show and refundable deposit rules stay separate."
      >
        <NumberRule label="Reserve-date hold" suffix="minutes" value={rules.short_let.reservation_hold_minutes} min={5} max={120} onChange={(value) => setShort("reservation_hold_minutes", value)} />
        <NumberRule label="Full-refund cutoff" suffix="hours before check-in" value={rules.short_let.full_refund_hours_before_check_in} min={0} max={720} onChange={(value) => setShort("full_refund_hours_before_check_in", value)} />
        <NumberRule label="Late-cancellation maximum" suffix="night(s)" value={rules.short_let.late_cancel_max_nights} min={0} max={7} step={0.5} onChange={(value) => setShort("late_cancel_max_nights", value)} />
        <NumberRule label="No-show maximum" suffix="night(s)" value={rules.short_let.no_show_max_nights} min={0} max={7} step={0.5} onChange={(value) => setShort("no_show_max_nights", value)} />
        <ToggleRule label="Refundable security deposit" note="Optional per Short Let property. Damage protection only." value={rules.short_let.security_deposit_enabled} onChange={(value) => setShort("security_deposit_enabled", value)} />
        <NumberRule label="Maximum security deposit" suffix="night(s) of that property's rate" value={rules.short_let.security_deposit_max_nights} min={0} max={7} step={0.5} disabled={!rules.short_let.security_deposit_enabled} onChange={(value) => setShort("security_deposit_max_nights", value)} />
        <NumberRule label="Partner damage-claim window" suffix="hours after checkout" value={rules.short_let.partner_claim_hours} min={1} max={168} onChange={(value) => setShort("partner_claim_hours", value)} />
        <NumberRule label="Guest response window" suffix="hours" value={rules.short_let.guest_response_hours} min={1} max={168} onChange={(value) => setShort("guest_response_hours", value)} />
        <NumberRule label="Arrival issue window" suffix="hours after verified check-in" value={rules.short_let.arrival_issue_hours} min={1} max={24} onChange={(value) => setShort("arrival_issue_hours", value)} />
        <p className="col-span-full text-[9px] leading-5 text-[#6F7687]">
          Death or hospitalisation exception, rebooking mitigation and the rule
          that a security deposit can never become a cancellation/no-show charge
          are enforced by the server bundle and are not casual toggles.
        </p>
      </RuleSection>

      <RuleSection
        title="Long Let"
        note="Reservation starts the housing process. Long Let does not use Short Let no-show or damage-deposit rules."
      >
        <NumberRule label="Reservation payment" prefix="₦" value={rules.long_let.reservation_amount} min={1} max={10000000} step={1000} onChange={(value) => setLong("reservation_amount", value)} />
        <NumberRule label="Payment checkout hold" suffix="minutes" value={rules.long_let.payment_hold_minutes} min={5} max={120} onChange={(value) => setLong("payment_hold_minutes", value)} />
        <NumberRule label="Housing process hold" suffix="hours" value={rules.long_let.hold_hours} min={1} max={168} onChange={(value) => setLong("hold_hours", value)} />
        <NumberRule label="Early full-refund window" suffix="hours, if material process has not begun" value={rules.long_let.full_refund_hours} min={0} max={168} onChange={(value) => setLong("full_refund_hours", value)} />
        <LockedRule label="Security deposit" value="Off at launch" />
        <LockedRule label="Installments" value="Off at launch" />
      </RuleSection>

      <RuleSection
        title="Commissions"
        note="Commission is calculated from eligible commercial value. Refundable Short Let security deposits are excluded."
      >
        <NumberRule label="Short Let" suffix="%" value={rules.commissions.short_let_percent} min={0} max={50} step={0.1} onChange={(value) => setCommission("short_let_percent", value)} />
        <NumberRule label="Long Let" suffix="%" value={rules.commissions.long_let_percent} min={0} max={50} step={0.1} onChange={(value) => setCommission("long_let_percent", value)} />
        <NumberRule label="Hotel" suffix="%" value={rules.commissions.hotel_percent} min={0} max={50} step={0.1} onChange={(value) => setCommission("hotel_percent", value)} />
        <NumberRule label="Service Worker" suffix="%" value={rules.commissions.service_worker_percent} min={0} max={50} step={0.1} onChange={(value) => setCommission("service_worker_percent", value)} />
      </RuleSection>

      <RuleSection
        title="Service Worker completion"
        note="These rules control protected-fund completion timing, not Worker identity or marketplace trust."
      >
        <NumberRule label="Completion reminder" suffix="hours" value={rules.service_worker.completion_reminder_hours} min={1} max={168} onChange={(value) => setWorker("completion_reminder_hours", value)} />
        <NumberRule label="Controlled release eligibility" suffix="hours" value={rules.service_worker.release_eligible_hours} min={1} max={168} onChange={(value) => setWorker("release_eligible_hours", value)} />
      </RuleSection>

      <section className="border-t border-white/[.07] pt-5">
        <h4 className="text-xs font-semibold">Publish changes</h4>
        <p className="mt-1 text-[9px] leading-5 text-[#6F7687]">
          Publishing creates new immutable policy versions. It does not rewrite
          older bookings, receipts or accepted rules.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-[9px] text-[#858C9D]">
            Effective time
            <input
              type="datetime-local"
              value={effectiveAt}
              onChange={(event) => setEffectiveAt(event.target.value)}
              className="mt-1.5 h-11 w-full rounded-xl border border-white/[.08] bg-[#151820] px-3 text-xs text-white outline-none focus:border-violet-500/40"
            />
            <span className="mt-1 block text-[8px] text-[#62697A]">
              Leave blank to publish now.
            </span>
          </label>
          <label className="text-[9px] text-[#858C9D]">
            Change reason
            <input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Why are these rules changing?"
              className="mt-1.5 h-11 w-full rounded-xl border border-white/[.08] bg-[#151820] px-3 text-xs text-white outline-none focus:border-violet-500/40"
            />
          </label>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[9px] text-[#6F7687]">
            {dirty ? "Unpublished changes" : "No unpublished changes"}
          </p>
          <button
            type="button"
            disabled={!dirty || publishing}
            onClick={requestPublish}
            className="min-h-11 rounded-xl bg-violet-500 px-5 text-xs font-semibold text-white transition duration-200 active:scale-[.98] disabled:opacity-40"
          >
            {publishing ? "Publishing…" : effectiveAt ? "Review & schedule" : "Review & publish"}
          </button>
        </div>
      </section>
    </section>
  );
}

function ShortLetReserveDateRule() {
  const { requestElevation } = useCreatorAuth();
  const [rule,setRule]=useState<{amount:number;payment_hold_minutes:number;balance_due_hours:number;version:number}|null>(null);
  const [draft,setDraft]=useState<{amount:number;payment_hold_minutes:number;balance_due_hours:number}|null>(null);
  const [reason,setReason]=useState('');
  const [effectiveAt,setEffectiveAt]=useState('');
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState('');
  const dirty=Boolean(rule&&draft&&(rule.amount!==draft.amount||rule.payment_hold_minutes!==draft.payment_hold_minutes||rule.balance_due_hours!==draft.balance_due_hours));
  async function loadReserveRule(){
    setLoading(true);setError('');
    const {data,error:readError}=await supabase.rpc('creator_get_short_let_reservation_rule');
    setLoading(false);
    if(readError||!data?.value){
      setRule(null);setDraft(null);setError('Short Let Reserve date pricing could not be verified.');
      return;
    }
    const value=data.value as any;
    const next={amount:Number(value.amount),payment_hold_minutes:Number(value.payment_hold_minutes),balance_due_hours:Number(value.balance_due_hours),version:Number(data.version||0)};
    if(!Number.isFinite(next.amount)||next.amount<=0||!Number.isInteger(next.payment_hold_minutes)||!Number.isInteger(next.balance_due_hours)){
      setRule(null);setDraft(null);setError('Short Let Reserve date policy is incomplete.');
      return;
    }
    setRule(next);setDraft({amount:next.amount,payment_hold_minutes:next.payment_hold_minutes,balance_due_hours:next.balance_due_hours});
  }
  useEffect(()=>{void loadReserveRule()},[]);
  async function publish(elevationId:string){
    if(!draft||!dirty||reason.trim().length<5)return;
    setSaving(true);
    const {data,error:saveError}=await supabase.rpc('creator_publish_short_let_reservation_rule',{
      p_creator_elevation_id:elevationId,
      p_amount:draft.amount,
      p_payment_hold_minutes:draft.payment_hold_minutes,
      p_balance_due_hours:draft.balance_due_hours,
      p_effective_from:effectiveAt?new Date(effectiveAt).toISOString():new Date().toISOString(),
      p_reason:reason.trim(),
    });
    setSaving(false);
    if(saveError||!data?.success)return toast.error(saveError?.message||'Short Let rule could not be published');
    toast.success(effectiveAt?'Reserve date rule scheduled':'Reserve date rule published');
    setReason('');setEffectiveAt('');await loadReserveRule();
  }
  if(loading)return <section className="border-y border-white/[.07] py-5"><p className="text-sm text-[#8A91A1]">Loading Short Let Reserve date rule…</p></section>;
  if(error||!rule||!draft)return <section className="border-y border-white/[.07] py-5"><h4 className="text-xs font-semibold">Short Let · Reserve date</h4><p className="mt-2 text-sm text-amber-200">{error||'Reserve date rule unavailable.'}</p><button type="button" onClick={()=>void loadReserveRule()} className="mt-3 min-h-11 rounded-xl border border-white/[.08] px-4 text-xs font-semibold">Try again</button></section>;
  return <section className="border-y border-violet-500/15 py-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[9px] font-bold uppercase tracking-[.16em] text-violet-300">Short Let money</p><h4 className="mt-1 text-sm font-semibold">Reserve date</h4><p className="mt-1 max-w-2xl text-[11px] leading-5 text-[#7D8495]">This payment reserves the selected dates. Stay charge and any refundable security deposit are paid later and remain separate.</p></div><span className="rounded-full border border-white/[.08] px-2.5 py-1 text-[9px] text-[#8E95A5]">v{rule.version}</span></div>
    <div className="mt-4 grid gap-3 sm:grid-cols-3">
      <label className="text-[10px] text-[#A4A9B6]">Reservation fee (₦)<input type="number" min={1} max={10000000} step={1000} value={draft.amount} onChange={e=>setDraft({...draft,amount:Number(e.target.value)})} className="mt-1.5 h-11 w-full rounded-xl border border-white/[.08] bg-[#151820] px-3 text-sm"/></label>
      <label className="text-[10px] text-[#A4A9B6]">Checkout time (minutes)<input type="number" min={5} max={120} value={draft.payment_hold_minutes} onChange={e=>setDraft({...draft,payment_hold_minutes:Number(e.target.value)})} className="mt-1.5 h-11 w-full rounded-xl border border-white/[.08] bg-[#151820] px-3 text-sm"/></label>
      <label className="text-[10px] text-[#A4A9B6]">Stay balance due (hours)<input type="number" min={1} max={168} value={draft.balance_due_hours} onChange={e=>setDraft({...draft,balance_due_hours:Number(e.target.value)})} className="mt-1.5 h-11 w-full rounded-xl border border-white/[.08] bg-[#151820] px-3 text-sm"/></label>
    </div>
    {dirty?<div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="text-[10px] text-[#A4A9B6]">Effective time<input type="datetime-local" value={effectiveAt} onChange={e=>setEffectiveAt(e.target.value)} className="mt-1.5 h-11 w-full rounded-xl border border-white/[.08] bg-[#151820] px-3 text-sm"/></label><label className="text-[10px] text-[#A4A9B6]">Change reason<input value={reason} onChange={e=>setReason(e.target.value)} placeholder="Why is this changing?" className="mt-1.5 h-11 w-full rounded-xl border border-white/[.08] bg-[#151820] px-3 text-sm"/></label></div>:null}
    <div className="mt-4 flex justify-end"><button type="button" disabled={!dirty||reason.trim().length<5||saving} onClick={()=>requestElevation('policy_publish',id=>void publish(id))} className="min-h-11 rounded-xl bg-violet-500 px-5 text-xs font-semibold disabled:opacity-40">{saving?'Publishing…':effectiveAt?'Review & schedule':'Review & publish'}</button></div>
  </section>;
}

function RuleSection({
  title,
  note,
  children,
}: {
  title: string;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-3">
        <h4 className="text-xs font-semibold">{title}</h4>
        <p className="mt-1 text-[9px] leading-5 text-[#6F7687]">{note}</p>
      </div>
      <div className="grid gap-x-5 border-y border-white/[.06] sm:grid-cols-2">
        {children}
      </div>
    </section>
  );
}

function NumberRule({
  label,
  value,
  onChange,
  prefix,
  suffix,
  min,
  max,
  step = 1,
  disabled = false,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  prefix?: string;
  suffix?: string;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
}) {
  return (
    <label className="flex min-h-16 items-center justify-between gap-4 border-b border-white/[.05] py-3 text-[10px]">
      <span className={disabled ? "text-[#555B69]" : "text-[#A4A9B6]"}>
        {label}
      </span>
      <span className="flex shrink-0 items-center gap-1.5">
        {prefix ? <span className="text-[#707687]">{prefix}</span> : null}
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
          className="h-9 w-20 rounded-lg border border-white/[.08] bg-[#151820] px-2 text-right text-xs outline-none focus:border-violet-500/40 disabled:opacity-35"
        />
        {suffix ? (
          <span className="max-w-32 text-[8px] leading-4 text-[#656C7D]">
            {suffix}
          </span>
        ) : null}
      </span>
    </label>
  );
}

function ToggleRule({
  label,
  note,
  value,
  onChange,
}: {
  label: string;
  note: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex min-h-16 items-center justify-between gap-4 border-b border-white/[.05] py-3">
      <span>
        <span className="block text-[10px] text-[#A4A9B6]">{label}</span>
        <span className="mt-1 block text-[8px] leading-4 text-[#656C7D]">
          {note}
        </span>
      </span>
      <button
        type="button"
        aria-pressed={value}
        aria-label={label}
        onClick={() => onChange(!value)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition duration-200 ${value ? "bg-violet-500" : "bg-white/[.1]"}`}
      >
        <span
          className={`absolute top-1 h-4 w-4 rounded-full bg-white transition-all duration-200 ${value ? "left-6" : "left-1"}`}
        />
      </button>
    </div>
  );
}

function LockedRule({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-h-16 items-center justify-between gap-4 border-b border-white/[.05] py-3">
      <span className="text-[10px] text-[#A4A9B6]">{label}</span>
      <span className="rounded-full border border-white/[.08] px-2.5 py-1 text-[8px] font-semibold text-[#8A91A1]">
        {value}
      </span>
    </div>
  );
}
