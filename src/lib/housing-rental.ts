import type { RentalDuration } from '@/types';

export type HousingRentTerms = {
  durationYears: RentalDuration;
  annualRent: number;
  totalContractRent: number;
  upfrontPercent: number;
  upfrontAmount: number;
  installmentBalance: number;
  installmentCount: number;
  installments: number[];
};

export const HOUSING_RENTAL_PLANS: Array<{
  durationYears: RentalDuration;
  label: string;
  description: string;
}> = [
  { durationYears: 1, label: '1 Year', description: 'Full contract rent before move-in' },
  { durationYears: 2, label: '2 Years', description: 'No installment plan — full 2-year contract rent before move-in' },
  { durationYears: 3, label: '3 Years', description: '68% upfront, remaining 32% split into 4 installments' },
];

export function calculateHousingRentTerms(annualRent: number, durationYears: RentalDuration): HousingRentTerms {
  const safeAnnual = Math.max(0, Math.round(Number(annualRent) || 0));
  const totalContractRent = safeAnnual * durationYears;

  if (durationYears <= 2) {
    return {
      durationYears,
      annualRent: safeAnnual,
      totalContractRent,
      upfrontPercent: 100,
      upfrontAmount: totalContractRent,
      installmentBalance: 0,
      installmentCount: 0,
      installments: [],
    };
  }

  const upfrontAmount = Math.round(totalContractRent * 0.68);
  const installmentBalance = totalContractRent - upfrontAmount;
  const installmentCount = 4;
  const base = Math.floor(installmentBalance / installmentCount);
  const installments = Array.from({ length: installmentCount }, (_, index) =>
    index === installmentCount - 1
      ? installmentBalance - base * (installmentCount - 1)
      : base,
  );

  return {
    durationYears,
    annualRent: safeAnnual,
    totalContractRent,
    upfrontPercent: 68,
    upfrontAmount,
    installmentBalance,
    installmentCount,
    installments,
  };
}
