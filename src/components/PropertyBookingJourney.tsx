import {
  getPropertyBookingJourney,
  type PropertyJourneyAudience,
} from "@/lib/propertyBookingLifecycle";

export default function PropertyBookingJourney({
  row,
  inspection,
  audience = "customer",
}: {
  row: Record<string, any>;
  inspection?: Record<string, any> | null;
  audience?: PropertyJourneyAudience;
}) {
  const journey = getPropertyBookingJourney(row, inspection, audience);
  return (
    <section className="border-y border-[var(--wh-border-subtle)] py-4">
      <p className="text-[9px] font-bold uppercase tracking-[.16em] text-violet-300">
        {audience === "operations"
          ? "Operations handover record"
          : `Reservation to ${String(row.stay_type || row._stayKind) === "short_let" ? "checkout" : "tenancy"}`}
      </p>
      <h2 className="mt-1.5 text-sm font-bold">{journey.title}</h2>
      <p className={`mt-1 max-w-xl text-[10px] leading-4 text-[var(--wh-text-secondary)]`}>
        {journey.detail}
      </p>
      <ol className="mt-4 space-y-0">
        {journey.steps.map((step, index) => (
          <li
            key={step.id}
            aria-current={step.state === "current" ? "step" : undefined}
            className="relative flex gap-2.5 pb-3 last:pb-0"
          >
            {index < journey.steps.length - 1 && (
              <span
                aria-hidden="true"
                className={`absolute left-[11px] top-6 h-[calc(100%-1rem)] w-px ${step.state === "complete" ? "bg-emerald-500/45" : "bg-[var(--wh-interactive)]"}`}
              />
            )}
            <span
              aria-hidden="true"
              className={`relative z-10 grid h-6 w-6 shrink-0 place-items-center rounded-full border text-[9px] font-bold ${
                step.state === "complete"
                  ? "border-emerald-500/35 bg-emerald-500/15 text-emerald-300"
                  : step.state === "current"
                    ? "border-violet-400/45 bg-violet-500 text-white"
                    : step.state === "stopped"
                      ? "border-amber-500/35 bg-amber-500/10 text-amber-300"
                      : "border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)] text-[var(--wh-text-muted)]"
              }`}
            >
              {step.state === "complete" ? "✓" : step.state === "stopped" ? "!" : index + 1}
            </span>
            <div className="min-w-0 pt-0.5">
              <div className="flex flex-wrap items-center gap-2">
                <p className={`text-[11px] font-semibold ${step.state === "current" ? "text-white" : step.state === "complete" ? "text-emerald-200" : step.state === "stopped" ? "text-amber-200" : "text-[var(--wh-text-muted)]"}`}>
                  {step.label}
                </p>
                {step.optional && (
                  <span className="text-[7px] uppercase tracking-wide text-[var(--wh-text-muted)]">Optional</span>
                )}
              </div>
              <p className={`mt-0.5 text-[9px] leading-4 text-[var(--wh-text-muted)]`}>{step.detail}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
