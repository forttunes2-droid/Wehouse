import { Button } from '@/components/ui/button';

/** One entry point within the existing Service Worker workspace. */
export default function ProviderOfferingEntry({ onService, onExperience }: {
  onService: () => void;
  onExperience: () => void;
}) {
  return (
    <section className="space-y-4 rounded-2xl border border-[var(--wh-border)] bg-[var(--wh-surface)] p-4 sm:p-5">
      <div>
        <h2 className="text-xl font-semibold">What would you like to offer?</h2>
        <p className="mt-2 text-sm leading-6 text-[var(--wh-text-secondary)]">
          Offer services customers request, scheduled Experiences, or both. Use the same
          account, Inbox, Team and earnings. Adding an offering is free.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-3 rounded-xl border border-[var(--wh-border-subtle)] p-4">
          <h3 className="font-semibold">Requested service</h3>
          <p className="flex-1 text-sm leading-6 text-[var(--wh-text-secondary)]">
            Customers request your help. Agree the scope, place, schedule and price.
          </p>
          <Button type="button" onClick={onService}>Set up services</Button>
        </div>
        <div className="flex flex-col gap-3 rounded-xl border border-[var(--wh-border-subtle)] p-4">
          <h3 className="font-semibold">Experience</h3>
          <p className="flex-1 text-sm leading-6 text-[var(--wh-text-secondary)]">
            Guide a class, garden visit, tour or activity. Apply with its details and your
            relevant expertise.
          </p>
          <Button type="button" variant="outline" onClick={onExperience}>Add an Experience</Button>
        </div>
      </div>
      <p className="text-sm leading-6 text-[var(--wh-text-secondary)]">
        Reuse your current account information. WeHouse reviews the requirements for
        each offering before it can be published.
      </p>
    </section>
  );
}
