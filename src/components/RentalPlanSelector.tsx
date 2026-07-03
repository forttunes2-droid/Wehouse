import { useState, useMemo } from 'react';
import { RENTAL_PLANS, calculateRentalPayments, WEHOUSE_FEES } from '@/types';
import type { RentalDuration } from '@/types';

interface Props {
  annualRent: number;
  subType?: 'short_let' | 'long_stay';
  securityDepositAmount?: number | null;
  onSelectPlan: (plan: { durationYears: RentalDuration; year1Upfront: number; monthlyInstallment: number }) => void;
}

export default function RentalPlanSelector({ annualRent, subType = 'long_stay', securityDepositAmount, onSelectPlan }: Props) {
  const [selectedDuration, setSelectedDuration] = useState<RentalDuration>(1);

  const breakdown = useMemo(() => {
    return calculateRentalPayments(annualRent, selectedDuration, subType, securityDepositAmount);
  }, [annualRent, selectedDuration, subType, securityDepositAmount]);

  const handleSelect = (years: RentalDuration) => {
    setSelectedDuration(years);
    const calc = calculateRentalPayments(annualRent, years, subType, securityDepositAmount);
    onSelectPlan({
      durationYears: years,
      year1Upfront: calc.year1Upfront,
      monthlyInstallment: calc.monthlyInstallments[0]?.amount || 0,
    });
  };

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-white">Choose Rental Plan</h3>

      <div className="space-y-2">
        {RENTAL_PLANS.map(plan => (
          <button
            key={plan.durationYears}
            onClick={() => handleSelect(plan.durationYears)}
            className={`w-full rounded-xl border p-4 text-left transition-all ${
              selectedDuration === plan.durationYears
                ? 'border-[#3B82F6] bg-[#3B82F6]/10'
                : 'border-[#2A2A3A] bg-[#1A1A24] hover:border-[#3B82F6]/30'
            }`}
          >
            <div className="flex items-center justify-between">
              <div>
                <p className={`text-sm font-semibold ${selectedDuration === plan.durationYears ? 'text-[#3B82F6]' : 'text-white'}`}>
                  {plan.label}
                </p>
                <p className="text-[10px] text-[#5C5E72] mt-0.5">{plan.description}</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-bold text-white">N{annualRent.toLocaleString()}<span className="text-[10px] text-[#5C5E72] font-normal">/yr</span></p>
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* Reservation Step — What user pays NOW */}
      <div className="rounded-xl bg-[#12121A] border border-white/[0.04] p-4 space-y-2">
        <h4 className="text-xs font-semibold text-[#8A8B9C] uppercase tracking-wider">Step 1: Reserve Now</h4>

        <div className="flex justify-between text-xs">
          <span className="text-[#5C5E72]">Reservation Fee</span>
          <span className="text-[#3B82F6] font-bold">N{WEHOUSE_FEES.RESERVATION_FEE.toLocaleString()}</span>
        </div>
        <p className="text-[9px] text-[#5C5E72]">
          This holds the property for 72 hours. A WeHouse agent will contact you to schedule inspection.
        </p>
      </div>

      {/* After Inspection — What user pays LATER */}
      <div className="rounded-xl bg-[#12121A] border border-white/[0.04] p-4 space-y-2">
        <h4 className="text-xs font-semibold text-emerald-400 uppercase tracking-wider">Step 2: After Inspection</h4>

        <div className="flex justify-between text-xs">
          <span className="text-[#5C5E72]">Annual Rent</span>
          <span className="text-white font-medium">N{annualRent.toLocaleString()}</span>
        </div>

        {subType === 'short_let' && breakdown.securityDeposit > 0 && (
          <div className="flex justify-between text-xs">
            <span className="text-[#5C5E72]">Security Deposit (Caution Fee)</span>
            <span className="text-blue-400 font-medium">N{breakdown.securityDeposit.toLocaleString()}</span>
          </div>
        )}

        <div className="border-t border-white/[0.04] pt-2">
          <div className="flex justify-between text-sm">
            <span className="text-white font-semibold">Year 1 Rent</span>
            <span className="text-[#3B82F6] font-bold">N{breakdown.year1Upfront.toLocaleString()}</span>
          </div>
        </div>

        {breakdown.monthlyInstallments.length > 0 && (
          <div className="pt-1">
            <div className="flex justify-between text-xs">
              <span className="text-[#5C5E72]">Monthly from Year 2 ({breakdown.monthlyInstallments.length} months)</span>
              <span className="text-emerald-400 font-medium">N{breakdown.monthlyInstallments[0].amount.toLocaleString()}/mo</span>
            </div>
          </div>
        )}

        <p className="text-[9px] text-[#5C5E72] mt-1">
          Security deposit is held by WeHouse and returned after your stay if no damage.
          Late payments attract {WEHOUSE_FEES.LATE_PAYMENT_FEE_PERCENT}% fee.
        </p>
      </div>

      <div className="rounded-xl bg-amber-500/5 border border-amber-500/10 p-3">
        <p className="text-[10px] text-amber-400">
          <strong>How it works:</strong> After paying the reservation fee, a WeHouse agent contacts you.
          You can choose to trust us and pay, or request inspection first.
          {subType === 'short_let' && breakdown.securityDeposit > 0
            ? ` Security deposit (N${breakdown.securityDeposit.toLocaleString()}) applies because this apartment includes appliances/furniture. It's held in escrow and returned after your stay if no damage.`
            : ` No security deposit needed — long stay tenants provide their own appliances.`}
          {selectedDuration > 1 ? ` Subsequent years are paid monthly.` : ''}
        </p>
      </div>
    </div>
  );
}
