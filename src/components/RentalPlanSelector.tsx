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
  const lateFeePercent = getNumber('late_payment_fee_percent', 5);
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
      monthlyInstallment: next.installments[0] || 0,
    });
  }

  return <div className="space-y-4">
    <div><h3 className="text-sm font-semibold text-white">Choose rental tenure</h3><p className="mt-1 text-[10px] leading-5 text-[#6E7484]">The reservation fee only holds the property. Contract rent is paid after the inspection gate.</p></div>

    <div className="space-y-2">
      {HOUSING_RENTAL_PLANS.map(plan => <button key={plan.durationYears} type="button" onClick={() => select(plan.durationYears)} className={`w-full rounded-xl border p-4 text-left transition ${selectedDuration === plan.durationYears ? 'border-blue-500 bg-blue-500/10' : 'border-white/[.07] bg-[#151821]'}`}>
        <div className="flex items-start justify-between gap-3"><div><p className={`text-sm font-semibold ${selectedDuration === plan.durationYears ? 'text-blue-300' : 'text-white'}`}>{plan.label}</p><p className="mt-1 text-[10px] leading-4 text-[#666C7D]">{plan.description}</p></div><p className="shrink-0 text-xs font-bold">₦{annualRent.toLocaleString()}<span className="text-[8px] font-normal text-[#666C7D]">/yr</span></p></div>
      </button>)}
    </div>

    <section className="space-y-2 rounded-2xl border border-blue-500/10 bg-blue-500/[.035] p-4">
      <p className="text-[9px] font-semibold uppercase tracking-wide text-blue-300">Step 1 · Reserve</p>
      <Line label="Reservation fee" value={`₦${reservationFee.toLocaleString()}`} strong />
      <p className="text-[9px] leading-4 text-[#6D7383]">A verified Paystack payment creates the paid reservation hold and unlocks the inspection workflow.</p>
    </section>

    <section className="space-y-2 rounded-2xl border border-emerald-500/10 bg-emerald-500/[.035] p-4">
      <p className="text-[9px] font-semibold uppercase tracking-wide text-emerald-300">Step 2 · After inspection</p>
      <Line label="Total contract rent" value={`₦${terms.totalContractRent.toLocaleString()}`} />
      <Line label={terms.upfrontPercent === 100 ? 'Required before move-in' : `${terms.upfrontPercent}% upfront`} value={`₦${terms.upfrontAmount.toLocaleString()}`} strong />
      {securityDeposit > 0 && <Line label="Refundable security deposit" value={`₦${securityDeposit.toLocaleString()}`} />}
      {terms.installmentCount > 0 && <div className="border-t border-white/[.06] pt-2"><Line label="Remaining balance" value={`₦${terms.installmentBalance.toLocaleString()}`} /><p className="mt-1 text-[9px] leading-4 text-[#6D7383]">Split into {terms.installmentCount} installments: {terms.installments.map(value => `₦${value.toLocaleString()}`).join(' · ')}.</p></div>}
      {terms.installmentCount === 0 && selectedDuration === 2 && <p className="text-[9px] leading-4 text-[#6D7383]">Installment plans apply only to stays longer than 2 years.</p>}
    </section>

    <div className="rounded-xl border border-amber-500/10 bg-amber-500/[.04] p-3"><p className="text-[9px] leading-4 text-amber-200">Late installment payments can attract the configured {lateFeePercent}% late fee. The server stores the tenure/payment terms at reservation time so the amount cannot be changed from the browser.</p></div>
  </div>;
}

function Line({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return <div className="flex items-center justify-between gap-3 text-[10px]"><span className="text-[#767C8D]">{label}</span><span className={strong ? 'font-bold text-white' : 'font-semibold text-[#C7CAD2]'}>{value}</span></div>;
}
