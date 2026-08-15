export type HousingRentalDuration = 1 | 2 | 3 | 4 | 5;

export type HousingRentTerms = {
  durationYears: HousingRentalDuration;
  annualRent: number;
  totalContractRent: number;
  upfrontPercent: number;
  upfrontAmount: number;
  installmentBalance: number;
  installmentCount: number;
  installments: number[];
  futureYears: number;
  contributionStartMonth: number;
  contributionsPerFutureYear: number;
  monthlyContribution: number;
};

export const HOUSING_RENTAL_PLANS: Array<{
  durationYears: HousingRentalDuration;
  label: string;
  description: string;
}> = [
  { durationYears: 1, label: '1 Year', description: 'Pay Year 1 rent in full before move-in' },
  { durationYears: 2, label: '2 Years', description: 'Pay Year 1 in full; months 5–12 build Year 2 rent' },
  { durationYears: 3, label: '3 Years', description: 'Pay Year 1 in full; each later year is funded in the previous year from month 5' },
  { durationYears: 4, label: '4 Years', description: 'Year 1 is paid in full; the same months 5–12 funding cycle repeats for Years 2–4' },
  { durationYears: 5, label: '5 Years', description: 'Year 1 is paid in full; each future year is prepared gradually in the year before it' },
];

function splitAnnualRentIntoEight(annualRent: number) {
  const cents = Math.max(0, Math.round(annualRent * 100));
  const base = Math.floor(cents / 8);
  return Array.from({ length: 8 }, (_, index) =>
    (index === 7 ? cents - base * 7 : base) / 100,
  );
}

export function calculateHousingRentTerms(annualRent: number, durationYears: HousingRentalDuration): HousingRentTerms {
  const safeAnnual = Math.max(0, Math.round((Number(annualRent) || 0) * 100) / 100);
  const futureYears = Math.max(Number(durationYears) - 1, 0);
  const totalContractRent = Math.round(safeAnnual * Number(durationYears) * 100) / 100;
  const upfrontAmount = safeAnnual;
  const installmentBalance = Math.round(safeAnnual * futureYears * 100) / 100;
  const contributionsPerFutureYear = 8;
  const oneYearCycle = splitAnnualRentIntoEight(safeAnnual);
  const installments = Array.from({ length: futureYears }, () => oneYearCycle).flat();

  return {
    durationYears,
    annualRent: safeAnnual,
    totalContractRent,
    upfrontPercent: Number(durationYears) > 0 ? Math.round((100 / Number(durationYears)) * 100) / 100 : 100,
    upfrontAmount,
    installmentBalance,
    installmentCount: futureYears * contributionsPerFutureYear,
    installments,
    futureYears,
    contributionStartMonth: 5,
    contributionsPerFutureYear,
    monthlyContribution: oneYearCycle[0] || 0,
  };
}
