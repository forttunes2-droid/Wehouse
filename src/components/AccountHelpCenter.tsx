import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import AccountShell, { AccountRow, AccountSection } from "@/components/AccountShell";
import type { WorkspaceName } from "@/lib/workspacePresentation";
import { withTimeout } from "@/lib/withTimeout";
import WeHouseSelect from "@/components/WeHouseSelect";
import { supabase } from "@/lib/supabase";
import type { Profile } from "@/types";

type HelpTarget = {
  subject_type: string;
  subject_id: string;
  context_type?: string;
  label: string;
  detail?: string;
  stay_type?: string;
  updated_at?: string;
};

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
};

type Topic = "general" | "property" | "job" | "money" | "security";
type MoneyReason = "payment_issue" | "payout_issue";
type SecurityReason = "account_compromise" | "safety_threat";
type GeneralReason = "app_help" | "account_access";

const TOPICS: Array<{ id: Topic; title: string; detail: string }> = [
  {
    id: "general",
    title: "Using WeHouse or my account",
    detail: "App help and account access",
  },
  {
    id: "property",
    title: "Property or stay",
    detail: "Your home or hotel booking",
  },
  {
    id: "job",
    title: "Service job",
    detail: "A service you booked",
  },
  {
    id: "money",
    title: "Payment or payout",
    detail: "A payment, refund or withdrawal",
  },
  {
    id: "security",
    title: "Safety or account security",
    detail: "Report a concern or secure your account",
  },
];

export default function AccountHelpCenter({
  profile,
  onBack,
  workspace = "personal",
}: {
  profile: Profile;
  onBack: () => void;
  workspace?: WorkspaceName;
}) {
  const [targets, setTargets] = useState<HelpTargets>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [topic, setTopic] = useState<Topic | null>(null);
  const [targetId, setTargetId] = useState("");
  const [generalReason, setGeneralReason] = useState<GeneralReason>("app_help");
  const [moneyReason, setMoneyReason] = useState<MoneyReason>("payment_issue");
  const [securityReason, setSecurityReason] = useState<SecurityReason>("account_compromise");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(false);
    setTargets({});
    setTopic(null);
    setTargetId("");
    void withTimeout(supabase.rpc("get_my_workspace_help_targets", { p_workspace: workspace }), 15000, 'Help timed out').then(({ data, error }) => {
      if (cancelled) return;
      setLoadError(Boolean(error));
      setTargets((data || {}) as HelpTargets);
      setLoading(false);
    }).catch(() => {
      if (cancelled) return;
      setLoadError(true);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [profile.user_id, workspace, retry]);

  const topics = TOPICS.filter(item => {
    if (item.id === 'property') return workspace === 'personal' || workspace === 'property_partner' || workspace === 'hotel';
    if (item.id === 'job') return workspace === 'personal' || workspace === 'worker';
    if (item.id === 'money') return workspace !== 'hotel';
    return true;
  }).map(item => {
    if (item.id === 'property' && workspace === 'property_partner') return {...item, title:'Properties and guests', detail:'Your submissions, properties and guest bookings'};
    if (item.id === 'property' && workspace === 'hotel') return {...item, title:'Your hotel', detail:'Help with your assigned hotel'};
    if (item.id === 'job' && workspace === 'worker') return {...item, title:'Jobs and professional profile', detail:'Your jobs, setup and review'};
    if (item.id === 'money' && workspace === 'personal') return {...item, title:'Payments and refunds', detail:'A payment for a booking or service'};
    if (item.id === 'money') return {...item, title:'Earnings and payouts', detail:'Job payments, guest payments and withdrawals'};
    return item;
  });

  const propertyTargets = useMemo(
    () => [
      ...(targets.reservations || []),
      ...(targets.hotel_bookings || []),
      ...(targets.property_requests || []),
      ...(targets.properties || []),
      ...(targets.hotels || []),
      ...(targets.partner_reservations || []),
      ...(targets.partner_hotel_bookings || []),
    ],
    [targets],
  );
  const jobTargets = [
    ...(targets.worker_profile ? [targets.worker_profile] : []),
    ...(targets.worker_jobs || []),
  ];
  const paymentTargets = useMemo(
    () => [
      ...(targets.worker_jobs || []),
      ...(targets.reservations || []),
      ...(targets.hotel_bookings || []),
      ...(targets.partner_reservations || []),
      ...(targets.partner_hotel_bookings || []),
    ],
    [targets],
  );
  const payoutTargets = targets.withdrawals || [];
  const safetyTargets = useMemo(
    () => [
      ...(targets.worker_jobs || []),
      ...(targets.reservations || []),
      ...(targets.hotel_bookings || []),
      ...(targets.partner_reservations || []),
      ...(targets.partner_hotel_bookings || []),
    ],
    [targets],
  );

  function resetTopic(next: Topic) {
    setTopic(next);
    setTargetId("");
    if (next === "security") setSecurityReason("account_compromise");
    if (next === "money") setMoneyReason("payment_issue");
  }

  function openConversation(context: Record<string, unknown>) {
    window.dispatchEvent(
      new CustomEvent("openSupportChat", {
        detail: context,
      }),
    );
  }

  function startGeneral() {
    const account = targets.account;
    if (!account) return toast.error("Your account help link is unavailable");
    openConversation({
      subject: generalReason === "account_access" ? "Account access" : "Using WeHouse",
      category: generalReason,
      contextType: "contextual_help",
      contextId: account.subject_id,
      contextSnapshot: {
        reason_code: generalReason,
        subject_type: "account",
        source_type: "account",
        source_id: account.subject_id,
        linked_label: account.label,
      },
    });
  }

  function startProperty() {
    const target = propertyTargets.find((item) => key(item) === targetId);
    if (!target) return toast.error("Choose the property or stay first");
    openConversation({
      subject: target.label,
      category: "property_help",
      contextType: target.context_type,
      contextId: target.subject_id,
      contextSnapshot: {
        source_type: target.context_type,
        source_id: target.subject_id,
        listing_title: target.subject_type === "listing" ? target.label : undefined,
        hotel_name: target.subject_type === "hotel" ? target.label : undefined,
        stay_type: target.stay_type,
        status: target.detail,
      },
    });
  }

  function startJob() {
    const target = jobTargets.find((item) => key(item) === targetId);
    if (!target) return toast.error("Choose the Service Worker record first");
    if (target.subject_type === "worker") {
      openConversation({
        subject: target.label,
        category: "worker_verification",
        contextType: "contextual_help",
        contextId: target.subject_id,
        contextSnapshot: {
          reason_code: "worker_verification",
          subject_type: "worker",
          source_type: "worker",
          source_id: target.subject_id,
          linked_label: target.label,
        },
      });
      return;
    }
    openConversation({
      subject: target.label,
      category: "service_booking_help",
      contextType: "worker_booking",
      contextId: target.subject_id,
      contextSnapshot: {
        source_type: "worker_booking",
        source_id: target.subject_id,
        service_type: target.label,
        status: target.detail,
      },
    });
  }

  function openLinkedJourney(
    target: HelpTarget,
    reasonCode: "payment_issue" | "safety_threat",
    subject: string,
  ) {
    const contextType = target.context_type || "";
    if (!["apartment_reservation", "hotel_booking", "worker_booking"].includes(contextType))
      return false;
    openConversation({
      subject,
      category: reasonCode,
      contextType,
      contextId: target.subject_id,
      priority: reasonCode === "safety_threat" ? "urgent" : "normal",
      contextSnapshot: {
        reason_code: reasonCode,
        subject_type: target.subject_type,
        source_type: contextType,
        source_id: target.subject_id,
        linked_label: target.label,
        stay_type: target.stay_type,
        status: target.detail,
      },
    });
    return true;
  }

  function startMoney() {
    const source = moneyReason === "payout_issue" ? payoutTargets : paymentTargets;
    const target = source.find((item) => key(item) === targetId);
    if (!target)
      return toast.error(
        moneyReason === "payout_issue"
          ? "Choose the withdrawal first"
          : "Choose the payment record first",
      );

    // Payment questions stay with the journey owner. Finance is the direct
    // customer front door only for a standalone payout/withdrawal record.
    if (
      moneyReason === "payment_issue" &&
      openLinkedJourney(target, "payment_issue", "Payment issue")
    )
      return;

    const subjectType =
      moneyReason === "payout_issue" ? "payout" : financeSubjectType(target);
    openConversation({
      subject: moneyReason === "payout_issue" ? "Payout issue" : "Payment issue",
      category: moneyReason,
      contextType: "contextual_help",
      contextId: target.subject_id,
      contextSnapshot: {
        reason_code: moneyReason,
        subject_type: subjectType,
        source_type: subjectType,
        source_id: target.subject_id,
        linked_label: target.label,
        status: target.detail,
      },
    });
  }

  function startSecurity() {
    const account = targets.account;
    if (!account) return toast.error("Your account security link is unavailable");

    if (securityReason === "safety_threat" && targetId) {
      const target = safetyTargets.find((item) => key(item) === targetId);
      if (target && openLinkedJourney(target, "safety_threat", "Safety concern"))
        return;
    }

    let subjectType = "account";
    let subjectId = account.subject_id;
    let linkedLabel = account.label;
    if (securityReason === "safety_threat" && targetId) {
      const target = safetyTargets.find((item) => key(item) === targetId);
      if (target) {
        subjectType = safetySubjectType(target);
        subjectId = target.subject_id;
        linkedLabel = target.label;
      }
    }
    openConversation({
      subject:
        securityReason === "account_compromise" ? "Account security" : "Safety concern",
      category: securityReason,
      contextType: "contextual_help",
      contextId: subjectId,
      priority: securityReason === "safety_threat" ? "urgent" : "high",
      contextSnapshot: {
        reason_code: securityReason,
        subject_type: subjectType,
        source_type: subjectType,
        source_id: subjectId,
        linked_label: linkedLabel,
      },
    });
  }

  return (
    <AccountShell
      profile={profile}
      workspace={workspace}
      title="Help"
      description="What do you need help with?"
      onBack={topic ? () => { setTopic(null); setTargetId(''); } : onBack}
    >
      {loadError ? <div role="alert" className="rounded-2xl border border-white/10 p-4 text-sm"><p>We couldn't load your help options.</p><button className="mt-3 min-h-11 text-violet-300" onClick={() => setRetry(value => value + 1)}>Try again</button></div> : !topic ? (
        <AccountSection>
          {topics.map(item => <AccountRow key={item.id} title={item.title} detail={item.detail} onClick={() => resetTopic(item.id)} />)}
        </AccountSection>
      ) : (
        <div className="space-y-4">
          {loading ? (
            <div className="rounded-2xl border border-white/[.06] bg-[#11141C] p-5 text-[10px] text-[#747B8C]">Loading your WeHouse records…</div>
          ) : null}

          {topic === "general" ? (
            <>
              <WeHouseSelect
                value={generalReason}
                options={[
                  { value: "app_help", label: "Using WeHouse" },
                  { value: "account_access", label: "Account access" },
                ]}
                onChange={(value) => setGeneralReason(value as GeneralReason)}
                eyebrow="Help"
                title="What do you need help with?"
                ariaLabel="Choose general help reason"
              />
              <PrimaryButton onClick={startGeneral} disabled={loading || !targets.account}>Message WeHouse</PrimaryButton>
            </>
          ) : null}

          {topic === "property" ? (
            <TargetPicker
              title="Which property or stay?"
              targets={propertyTargets}
              value={targetId}
              setValue={setTargetId}
              empty="No property or stay is linked to this identity yet."
              action={startProperty}
            />
          ) : null}

          {topic === "job" ? (
            <TargetPicker
              title="Which Service Worker record?"
              targets={jobTargets}
              value={targetId}
              setValue={setTargetId}
              empty="No Service Worker profile or job is linked to this identity yet."
              action={startJob}
            />
          ) : null}

          {topic === "money" ? (
            <>
              <WeHouseSelect
                value={moneyReason}
                options={[
                  { value: "payment_issue", label: "Payment issue" },
                  ...(workspace !== 'personal' ? [{ value: "payout_issue", label: "Withdrawal / payout issue" }] : []),
                ]}
                onChange={(value) => {
                  setMoneyReason(value as MoneyReason);
                  setTargetId("");
                }}
                eyebrow="Finance Operations"
                title="What happened?"
                ariaLabel="Choose finance help reason"
              />
              <TargetPicker
                title={moneyReason === "payout_issue" ? "Which withdrawal?" : "Which payment is this about?"}
                targets={moneyReason === "payout_issue" ? payoutTargets : paymentTargets}
                value={targetId}
                setValue={setTargetId}
                empty={moneyReason === "payout_issue" ? "No withdrawal request is linked to this identity yet." : "No linked job or accommodation payment record is available yet."}
                action={startMoney}
              />
            </>
          ) : null}

          {topic === "security" ? (
            <>
              <WeHouseSelect
                value={securityReason}
                options={[
                  { value: "account_compromise", label: "Account security / unauthorized access" },
                  { value: "safety_threat", label: "Safety, abuse or threat" },
                ]}
                onChange={(value) => {
                  setSecurityReason(value as SecurityReason);
                  setTargetId("");
                }}
                eyebrow="Security Operations"
                title="What happened?"
                ariaLabel="Choose security help reason"
              />
              {securityReason === "safety_threat" ? (
                <>
                  <TargetSelect
                    title="Link a record if this happened during a job or stay"
                    targets={safetyTargets}
                    value={targetId}
                    setValue={setTargetId}
                    allowAccount
                  />
                  <PrimaryButton onClick={startSecurity} disabled={loading || !targets.account}>Message WeHouse Security</PrimaryButton>
                </>
              ) : (
                <PrimaryButton onClick={startSecurity} disabled={loading || !targets.account}>Message WeHouse Security</PrimaryButton>
              )}
            </>
          ) : null}
        </div>
      )}
    </AccountShell>
  );
}

function TargetPicker({
  title,
  targets,
  value,
  setValue,
  empty,
  action,
}: {
  title: string;
  targets: HelpTarget[];
  value: string;
  setValue: (value: string) => void;
  empty: string;
  action: () => void;
}) {
  return (
    <>
      <TargetSelect title={title} targets={targets} value={value} setValue={setValue} />
      {!targets.length ? <p className="text-[9px] leading-5 text-[#666D7D]">{empty}</p> : null}
      <PrimaryButton onClick={action} disabled={!targets.length || !value}>Message WeHouse</PrimaryButton>
    </>
  );
}

function TargetSelect({
  title,
  targets,
  value,
  setValue,
  allowAccount = false,
}: {
  title: string;
  targets: HelpTarget[];
  value: string;
  setValue: (value: string) => void;
  allowAccount?: boolean;
}) {
  const options = [
    ...(allowAccount ? [{ value: "", label: "My account / no specific record" }] : []),
    ...targets.map((item) => ({
      value: key(item),
      label: item.detail ? `${item.label} · ${item.detail}` : item.label,
    })),
  ];
  return (
    <WeHouseSelect
      value={value}
      options={options}
      onChange={setValue}
      eyebrow="Linked record"
      title={title}
      ariaLabel={title}
    />
  );
}

function PrimaryButton({
  children,
  onClick,
  disabled = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="h-12 w-full rounded-2xl bg-violet-500 text-[11px] font-semibold text-white transition hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function key(target: HelpTarget) {
  return `${target.subject_type}:${target.subject_id}`;
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
