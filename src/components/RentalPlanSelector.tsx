import { useState, useMemo } from 'react';
import { RENTAL_PLANS, calculateRentalPayments, WEHOUSE_FEES } from '@/types';
import type { RentalDuration } from '@/types';

interface Props {
  annualRent: number;
  onSelectPlan: (plan: { durationYears: RentalDuration; year1Upfront: number; monthlyInstallment: number }) => void;
}

export default function RentalPlanSelector({ annualRent, onSelectPlan }: Props) {
  const [selectedDuration, setSelectedDuration] = useState<RentalDuration>(1);

  const breakdown = useMemo(() => {
    return calculateRentalPayments(annualRent, selectedDuration);
  }, [annualRent, selectedDuration]);

  const handleSelect = (years: RentalDuration) => {
    setSelectedDuration(years);
    const calc = calculateRentalPayments(annualRent, years);
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

      {/* Payment Breakdown */}
      <div className="rounded-xl bg-[#12121A] border border-white/[0.04] p-4 space-y-2">
        <h4 className="text-xs font-semibold text-[#8A8B9C] uppercase tracking-wider">Payment Breakdown</h4>

        <div className="flex justify-between text-xs">
          <span className="text-[#5C5E72]">Annual Rent</span>
          <span className="text-white font-medium">N{annualRent.toLocaleString()}</span>
        </div>

        <div className="flex justify-between text-xs">
          <span className="text-[#5C5E72]">WeHouse Commission ({WEHOUSE_FEES.RENTAL_COMMISSION_PERCENT}%)</span>
          <span className="text-amber-400 font-medium">N{breakdown.wehouseCommission.toLocaleString()}</span>
        </div>

        <div className="border-t border-white/[0.04] pt-2 flex justify-between text-xs">
          <span className="text-[#5C5E72]">Reservation Fee (holds property 72hrs)</span>
          <span className="text-white font-medium">N{WEHOUSE_FEES.RESERVATION_FEE.toLocaleString()}</span>
        </div>

        <div className="border-t border-white/[0.04] pt-2">
          <div className="flex justify-between text-sm">
            <span className="text-white font-semibold">Year 1 (Pay Now)</span>
            <span className="text-[#3B82F6] font-bold">N{breakdown.year1Upfront.toLocaleString()}</span>
          </div>
        </div>

        {breakdown.monthlyInstallments.length > 0 && (
          <div className="pt-1">
            <div className="flex justify-between text-xs">
              <span className="text-[#5C5E72]">Monthly from Year 2 ({breakdown.monthlyInstallments.length} months)</span>
              <span className="text-emerald-400 font-medium">N{breakdown.monthlyInstallments[0].amount.toLocaleString()}/mo</span>
            </div>
            <p className="text-[9px] text-[#5C5E72] mt-1">
              Paid via Paystack monthly. Late payments attract {WEHOUSE_FEES.LATE_PAYMENT_FEE_PERCENT}% fee.
            </p>
          </div>
        )}

        <div className="border-t border-white/[0.04] pt-2 flex justify-between text-xs">
          <span className="text-[#5C5E72]">Total over {selectedDuration} year(s)</span>
          <span className="text-white font-bold">N{breakdown.totalRent.toLocaleString()}</span>
        </div>

        <div className="flex justify-between text-xs">
          <span className="text-emerald-400">Landlord Receives</span>
          <span className="text-emerald-400 font-bold">N{breakdown.landlordReceives.toLocaleString()}</span>
        </div>
      </div>

      <div className="rounded-xl bg-amber-500/5 border border-amber-500/10 p-3">
        <p className="text-[10px] text-amber-400">
          <strong>How it works:</strong> Pay the reservation fee now to hold the property for 72 hours. 
          A WeHouse agent will contact you to schedule inspection. After inspection, pay Year 1 rent via Paystack. 
          {selectedDuration > 1 ? `Subsequent years are automatically deducted monthly from your Paystack account.` : ''}
        </p>
      </div>
    </div>
  );
}
