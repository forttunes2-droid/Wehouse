import { useMemo, useState } from 'react';
import { usePlatformSettings } from '@/hooks/usePlatformSettings';
import { HOUSING_RENTAL_PLANS, calculateHousingRentTerms } from '@/lib/housing-rental';
import type { RentalDuration } from '@/types';

interface Props {
  annualRent: number;
  subType?: 'short_let' | 'long_stay';
  securityDepositAmount?: number | null;
  onSelectPlan: (plan: { durationYears: RentalDuration; year1Upfront: number; monthlyInstallment: number }) => void;
}

export default function RentalPlanSelector({ annualRent, subType = 'long_stay', securityDepositAmount, onSelectPlan }: Props) {
  const { getNumber } = usePlatformSettings();
  const reservationFee = getNumber('reservation_fee', 5000);
  const [selectedDuration, setSelectedDuration] = useState<RentalDuration>(1);

  const terms = useMemo(
    () => calculateHousingRentTerms(annualRent, selectedDuration),
    [annualRent, selectedDuration],
  );
  const securityDeposit = subType === 'short_let' ? Math.max(0, Number(securityDepositAmount || 0)) : 0;

  function select(years: RentalDuration) {
    setSelectedDuration(years);
    const next = calculateHousingRentTerms(annualRent, years);
    onSelectPlan({
      durationYears: years,
      year1Upfront: next.upfrontAmount,
      monthlyInstallment: next.monthlyContribution,
    });
  }

  return <div className="space-y-4">
    <div><h3 className="text-sm font-semibold text-white">Choose rental tenure</h3><p className="mt-1 text-[10px] leading-5 text-[#6E7484]">The reservation fee holds the property. Year 1 rent is paid only after the inspection gate passes.</p></div>

    <div className="space-y-2">
      {HOUSING_RENTAL_PLANS.map(plan => <button key={plan.durationYears} type="button" onClick={() => select(plan.durationYears)} className={`w-full rounded-xl border p-4 text-left transition ${selectedDuration === plan.durationYears ? 'border-blue-500 bg-blue-500/10' : 'border-white/[.07] bg-[#151821]'}`}>
        <div className="flex items-start justify-between gap-3"><div><p className={`text-sm font-semibold ${selectedDuration === plan.durationYears ? 'text-blue-300' : 'text-white'}`}>{plan.label}</p><p className="mt-1 text-[10px] leading-4 text-[#666C7D]">{plan.description}</p></div><p className="shrink-0 text-xs font-bold">₦{annualRent.toLocaleString()}<span className="text-[8px] font-normal text-[#666C7D]">/yr</span></p></div>
      </button>)}
    </div>

    <section className="space-y-2 rounded-2xl border border-blue-500/10 bg-blue-500/[.035] p-4">
      <p className="text-[9px] font-semibold uppercase tracking-wide text-blue-300">Step 1 · Reserve</p>
      <Line label="Reservation fee" value={`₦${reservationFee.toLocaleString()}`} strong />
      <p className="text-[9px] leading-4 text-[#6D7383]">A verified Paystack payment creates the property hold and unlocks the inspection workflow.</p>
    </section>

    <section className="space-y-2 rounded-2xl border border-emerald-500/10 bg-emerald-500/[.035] p-4">
      <p className="text-[9px] font-semibold uppercase tracking-wide text-emerald-300">Step 2 · Before move-in</p>
      <Line label="Year 1 rent" value={`₦${terms.upfrontAmount.toLocaleString()}`} strong />
      <Line label="Selected stay" value={`${selectedDuration} year${selectedDuration === 1 ? '' : 's'}`} />
      {securityDeposit > 0 && <Line label="Refundable security deposit" value={`₦${securityDeposit.toLocaleString()}`} />}
      <p className="text-[9px] leading-4 text-[#6D7383]">You are not asked to pay every future year before moving in.</p>
    </section>

    {terms.futureYears > 0 && <section className="space-y-2 rounded-2xl border border-violet-500/10 bg-violet-500/[.035] p-4">
      <p className="text-[9px] font-semibold uppercase tracking-wide text-violet-300">After move-in · Prepare the next year's rent</p>
      <Line label="Months 1–4" value="No next-year contribution" />
      <Line label="Months 5–12" value={`${terms.contributionsPerFutureYear} monthly contributions`} />
      <Line label="Typical monthly amount" value={`₦${terms.monthlyContribution.toLocaleString()}`} strong />
      <p className="text-[9px] leading-4 text-[#77738A]">Those eight payments add up to one full annual rent. {terms.futureYears > 1 ? 'When Year 2 begins, the same four-month break and eight-payment cycle funds Year 3.' : 'By renewal, Year 2 rent is already funded.'} You can pay an upcoming contribution early if that is more convenient.</p>
    </section>}

    <div className="rounded-xl border border-white/[.06] bg-white/[.025] p-3"><p className="text-[9px] leading-4 text-[#7B8090]">WeHouse stores the rent schedule against your tenancy. Each contribution has its own due date, Paystack reference and payment status so the customer and Housing Operations see the same record.</p></div>
  </div>;
}

function Line({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return <div className="flex items-center justify-between gap-3 text-[10px]"><span className="text-[#767C8D]">{label}</span><span className={`text-right ${strong ? 'font-bold text-white' : 'font-semibold text-[#C7CAD2]'}`}>{value}</span></div>;
}
