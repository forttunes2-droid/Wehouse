import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import AccountShell, { AccountRow, AccountSection } from "@/components/AccountShell";
import type { WorkspaceName } from "@/lib/workspacePresentation";
import { withTimeout } from "@/lib/withTimeout";
import { helpTargetKey, paymentHelpTargets, isHelpTargetsResponse, type HelpTarget } from "@/lib/helpTargets";
import HelpRecordPicker from "@/components/HelpRecordPicker";
import { useRecordScreenBack } from "@/hooks/useRecordScreenBack";
import { supabase } from "@/lib/supabase";
import type { Profile } from "@/types";

type HelpTargets = {
  account?: HelpTarget;
  worker_profile?: HelpTarget | null;
  worker_jobs?: HelpTarget[];
  withdrawals?: HelpTarget[];
  reservations?: HelpTarget[];
  hotel_bookings?: HelpTarget[];
  property_requests?: HelpTarget[];
  properties?: HelpTarget[];
  hotels?: HelpTarget[];
  partner_reservations?: HelpTarget[];
  partner_hotel_bookings?: HelpTarget[];
  payment_targets?: HelpTarget[];
};
type Topic = "general" | "property" | "job" | "money" | "security";
type MoneyReason = "payment_issue" | "payout_issue";
type SecurityReason = "account_compromise" | "safety_threat";
type GeneralReason = "app_help" | "account_access";
const TOPICS: Array<{ id: Topic; title: string; detail: string }> = [
  { id: "general", title: "Using WeHouse or my account", detail: "App help and account access" },
  { id: "property", title: "Property or stay", detail: "Your home or hotel booking" },
  { id: "job", title: "Service job", detail: "A service you booked" },
  { id: "money", title: "Payment or payout", detail: "A payment, refund or withdrawal" },
  { id: "security", title: "Safety or account security", detail: "Report a concern or secure your account" },
];

export default function AccountHelpCenter({ profile, onBack, workspace = "personal" }: {
  profile: Profile; onBack: () => void; workspace?: WorkspaceName;
}) {
  const [targets, setTargets] = useState<HelpTargets>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [topic, setTopic] = useState<Topic | null>(null);
  const backToHelp = useRecordScreenBack(() => setTopic(null), Boolean(topic));
  const [loadedFor, setLoadedFor] = useState("");
  const scope = `${profile.user_id}:${workspace}`;
  const ready = !loading && !loadError && loadedFor === scope;
  const [moneyReason, setMoneyReason] = useState<MoneyReason>("payment_issue");
  const [securityReason, setSecurityReason] = useState<SecurityReason>("account_compromise");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(false);
    setTargets({});
    setLoadedFor("");
    void withTimeout(supabase.rpc("get_my_workspace_help_targets", { p_workspace: workspace }), 15000, 'Help timed out').then(({ data, error }) => {
      if (cancelled) return;
      // An older or malformed projection is unavailable, not an empty payment history.
      const usable = !error && isHelpTargetsResponse(data) && data.account.subject_id === profile.user_id;
      setLoadError(!usable);
      // Never let a malformed list crash rendering before the retry UI appears.
      setTargets(usable ? data as HelpTargets : {});
      setLoadedFor(usable ? scope : "");
      setLoading(false);
    }).catch(() => {
      if (cancelled) return;
      setLoadError(true);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [profile.user_id, workspace, retry, scope]);

  useEffect(() => { setTopic(null); }, [profile.user_id, workspace]);

  const topics = TOPICS.filter(item => {
    if (item.id === 'property') return workspace === 'personal' || workspace === 'property_partner' || workspace === 'hotel';
    if (item.id === 'job') return workspace === 'personal' || workspace === 'worker';
    if (item.id === 'money') return workspace !== 'hotel';
    return true;
  }).map(item => {
    if (item.id === 'property' && workspace === 'property_partner') return { ...item, title:'Properties and guests', detail:'Your submissions, properties and guest bookings' };
    if (item.id === 'property' && workspace === 'hotel') return { ...item, title:'Your hotel', detail:'Help with your assigned hotel' };
    if (item.id === 'job' && workspace === 'worker') return { ...item, title:'Jobs and professional profile', detail:'Your jobs, setup and review' };
    if (item.id === 'money' && workspace === 'personal') return { ...item, title:'Payments and refunds', detail:'A payment for a booking or service' };
    if (item.id === 'money') return { ...item, title:'Earnings and payouts', detail:'Job payments, guest payments and withdrawals' };
    return item;
  });
  const propertyTargets = useMemo(() => [
    ...(targets.reservations || []), ...(targets.hotel_bookings || []), ...(targets.property_requests || []),
    ...(targets.properties || []), ...(targets.hotels || []), ...(targets.partner_reservations || []),
    ...(targets.partner_hotel_bookings || []),
  ], [targets]);
  const jobTargets = [...(targets.worker_profile ? [targets.worker_profile] : []), ...(targets.worker_jobs || [])];
  const paymentTargets = useMemo(() => paymentHelpTargets(targets), [targets]);
  const payoutTargets = targets.withdrawals || [];
  const safetyTargets = useMemo(() => [
    ...(targets.worker_jobs || []), ...(targets.reservations || []), ...(targets.hotel_bookings || []),
    ...(targets.partner_reservations || []), ...(targets.partner_hotel_bookings || []),
  ], [targets]);

  function resetTopic(next: Topic) {
    setTopic(next);
    if (next === "security") setSecurityReason("account_compromise");
    if (next === "money") setMoneyReason("payment_issue");
  }
  function openConversation(context: Record<string, unknown>) {
    if (!ready) return;
    window.dispatchEvent(new CustomEvent("openSupportChat", { detail: { ...context, contextSnapshot: { ...(context.contextSnapshot as Record<string, unknown> || {}), requester_workspace: workspace } } }));
  }
  function startGeneral(reason: GeneralReason) {
    const account = targets.account;
    if (!account) return toast.error("Your account help link is unavailable");
    openConversation({
      subject: reason === "account_access" ? "Account access" : "Using WeHouse", category: reason,
      contextType: "contextual_help", contextId: account.subject_id,
      contextSnapshot: { reason_code: reason, subject_type: "account", source_type: "account",
        source_id: account.subject_id, linked_label: account.label },
    });
  }
  function startProperty(targetId: string) {
    const target = propertyTargets.find(item => helpTargetKey(item) === targetId);
    if (!target) return toast.error("Choose the property or stay first");
    openConversation({
      subject: target.label, category: "property_help", contextType: target.context_type, contextId: target.subject_id,
      contextSnapshot: {
        source_type: target.context_type, source_id: target.subject_id, linked_label: target.label,
        listing_title: ['property_listing','apartment_reservation'].includes(target.context_type || '') ? target.label : undefined,
        hotel_name: target.context_type?.startsWith('hotel') ? target.label : undefined,
        stay_type: target.stay_type, status: target.status || target.detail,
      },
    });
  }
  function startJob(targetId: string) {
    const target = jobTargets.find(item => helpTargetKey(item) === targetId);
    if (!target) return toast.error("Choose the job or Worker profile first");
    if (target.subject_type === "worker") {
      openConversation({
        subject: target.label, category: "worker_verification", contextType: "contextual_help", contextId: target.subject_id,
        contextSnapshot: { reason_code: "worker_verification", subject_type: "worker", source_type: "worker",
          source_id: target.subject_id, linked_label: target.label },
      });
      return;
    }
    openConversation({
      subject: target.label, category: "service_booking_help", contextType: "worker_booking", contextId: target.subject_id,
      contextSnapshot: { source_type: "worker_booking", source_id: target.subject_id,
        linked_label: target.label, service_type: target.label, status: target.status || target.detail },
    });
  }
  function openLinkedJourney(target: HelpTarget, reasonCode: "payment_issue" | "safety_threat", subject: string) {
    const contextType = target.context_type || "";
    if (!["apartment_reservation", "hotel_booking", "worker_booking"].includes(contextType)) return false;
    openConversation({
      subject, category: reasonCode, contextType, contextId: target.subject_id,
      priority: reasonCode === "safety_threat" ? "urgent" : "normal",
      contextSnapshot: { reason_code: reasonCode, subject_type: target.subject_type, source_type: contextType,
        source_id: target.subject_id, linked_label: target.label, stay_type: target.stay_type, status: target.status || target.detail },
    });
    return true;
  }
  function startMoney(targetId: string) {
    const source = moneyReason === "payout_issue" ? payoutTargets : paymentTargets;
    const target = source.find(item => helpTargetKey(item) === targetId);
    if (!target) return toast.error(moneyReason === "payout_issue" ? "Choose the withdrawal first" : "Choose the payment record first");
    // Payment questions retain their journey owner. Standalone withdrawals go to Finance.
    if (moneyReason === "payment_issue" && openLinkedJourney(target, "payment_issue", "Payment issue")) return;
    const subjectType = moneyReason === "payout_issue" ? "payout" : financeSubjectType(target);
    openConversation({
      subject: moneyReason === "payout_issue" ? "Payout issue" : "Payment issue", category: moneyReason,
      contextType: "contextual_help", contextId: target.subject_id,
      contextSnapshot: { reason_code: moneyReason, subject_type: subjectType, source_type: subjectType,
        source_id: target.subject_id, linked_label: target.label, status: target.status || target.detail },
    });
  }
  function startSecurity(targetId = "", reason: SecurityReason = securityReason) {
    const account = targets.account;
    if (!account) return toast.error("Your account security link is unavailable");
    if (reason === "safety_threat" && targetId) {
      const target = safetyTargets.find(item => helpTargetKey(item) === targetId);
      if (target && openLinkedJourney(target, "safety_threat", "Safety concern")) return;
    }
    let subjectType = "account", subjectId = account.subject_id, linkedLabel = account.label;
    if (reason === "safety_threat" && targetId) {
      const target = safetyTargets.find(item => helpTargetKey(item) === targetId);
      if (target) { subjectType = safetySubjectType(target); subjectId = target.subject_id; linkedLabel = target.label; }
    }
    openConversation({
      subject: reason === "account_compromise" ? "Account security" : "Safety concern",
      category: reason, contextType: "contextual_help", contextId: subjectId,
      priority: reason === "safety_threat" ? "urgent" : "high",
      contextSnapshot: { reason_code: reason, subject_type: subjectType, source_type: subjectType,
        source_id: subjectId, linked_label: linkedLabel },
    });
  }

  const retryButton = <button className="mt-3 min-h-11 text-violet-300" onClick={() => setRetry(value => value + 1)}>Try again</button>;
  const title = topic === "security" ? "Safety concern" : topic ? topics.find(item => item.id === topic)?.title || "Help" : "Help";
  return <AccountShell profile={profile} workspace={workspace} title={title} narrow onBack={topic ? backToHelp : onBack}>
    <div className="mx-auto w-full max-w-xl">
    {loadError ? <div role="alert" className="border-y border-white/10 py-5 text-sm leading-6"><p>We couldn't load your help options.</p>{retryButton}</div> : !topic ? <div className="space-y-5">
      <AccountSection>
        {topics.filter(item => !["general","security"].includes(item.id)).map(item => <AccountRow key={item.id} title={item.title} onClick={() => resetTopic(item.id)} />)}
      </AccountSection>
      <AccountSection>
        <AccountRow title="Using WeHouse" onClick={() => startGeneral("app_help")} disabled={!ready} />
        <AccountRow title="Account access" onClick={() => startGeneral("account_access")} disabled={!ready} />
        <AccountRow title="Account security" onClick={() => startSecurity("", "account_compromise")} disabled={!ready} />
        <AccountRow title="Report a safety concern" onClick={() => {resetTopic("security");setSecurityReason("safety_threat");}} />
      </AccountSection>
      {loading && <p role="status" className="text-sm text-[#A7ADBA]">Loading your help options…</p>}
    </div> : <>
      {loading || !ready ? <div role="status" className="py-5 text-sm text-[#A7ADBA]">Loading your help options…</div> : <>
        {topic === "property" && <HelpRecordPicker key={`${scope}:property`} title="Which property or stay?" targets={propertyTargets} onChoose={target => startProperty(helpTargetKey(target))} />}
        {topic === "property" && !propertyTargets.length && <p className="py-5 text-sm text-[#A7ADBA]">No property or stay is linked to this account yet.</p>}
        {topic === "job" && <HelpRecordPicker key={`${scope}:job`} title="Which job or Worker profile?" targets={jobTargets} onChoose={target => startJob(helpTargetKey(target))} />}
        {topic === "job" && !jobTargets.length && <p className="py-5 text-sm text-[#A7ADBA]">No job or Worker profile is linked to this account yet.</p>}
        {topic === "money" && <>
          {workspace !== "personal" && <div className="mb-3 flex gap-2" role="group" aria-label="Payment help type">{([["payment_issue","Payments and refunds"],["payout_issue","Withdrawals"]] as const).map(([value,label]) => <button key={value} type="button" aria-pressed={moneyReason === value} onClick={() => setMoneyReason(value)} className={`min-h-11 rounded-xl border px-3 text-sm ${moneyReason === value ? "border-violet-400/50 text-violet-200" : "border-white/10 text-[#A7ADBA]"}`}>{label}</button>)}</div>}
          <HelpRecordPicker key={`${scope}:${moneyReason}`} title={moneyReason === "payout_issue" ? "Which withdrawal?" : "Which payment is this about?"} targets={moneyReason === "payout_issue" ? payoutTargets : paymentTargets} onChoose={target => startMoney(helpTargetKey(target))} includeHistory />
          {!(moneyReason === "payout_issue" ? payoutTargets : paymentTargets).length && <p className="py-5 text-sm leading-6 text-[#A7ADBA]">{moneyReason === "payout_issue" ? "No withdrawal request is linked to this account yet." : "No payment or active payment attempt is linked to this workspace."}</p>}
        </>}
        {topic === "security" && <HelpRecordPicker key={`${scope}:safety`} title="Link a booking or job" targets={safetyTargets} onChoose={target => startSecurity(helpTargetKey(target))} onAccount={() => startSecurity()} />}
      </>}
    </>}
    </div>
  </AccountShell>;
}
function financeSubjectType(target: HelpTarget) {
  if (target.subject_type === "worker_job") return "worker_job";
  if (target.subject_type === "hotel") return "hotel";
  if (target.subject_type === "short_let") return "short_let";
  return "long_let";
}
function safetySubjectType(target: HelpTarget) {
  if (["worker_job", "short_let", "hotel", "long_let"].includes(target.subject_type)) return target.subject_type;
  return "account";
}
