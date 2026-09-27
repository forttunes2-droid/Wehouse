export type ShortLetBill = { rent: number; deposit: number; total: number };
export function shortLetPayment(row: { stay_type?: unknown; stay_rent_total?: unknown; security_deposit_snapshot?: unknown }): ShortLetBill | null {
  if (row.stay_type !== 'short_let' || row.stay_rent_total == null || row.stay_rent_total === '' || row.security_deposit_snapshot == null || row.security_deposit_snapshot === '') return null;
  const rent = Number(row.stay_rent_total), deposit = Number(row.security_deposit_snapshot);
  if (!Number.isFinite(rent) || rent <= 0 || !Number.isFinite(deposit) || deposit < 0) return null;
  const rentKobo = Math.round(rent * 100), depositKobo = Math.round(deposit * 100);
  if (![rentKobo, depositKobo, rentKobo + depositKobo].every(Number.isSafeInteger)) return null;
  return { rent: rentKobo / 100, deposit: depositKobo / 100, total: (rentKobo + depositKobo) / 100 };
}
