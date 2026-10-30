type WalletTransaction = { id: string; description?: string | null; transaction_type: string; created_at: string; amount: number | string };
type Withdrawal = { id: string; amount: number | string; status: string; created_at: string };
type Earning = { id: string; earning_type: string; status: string; net_amount: number | string; created_at: string };
export type WalletActivity = { id: string; kind: 'income' | 'withdrawals' | 'protected'; title: string; date: string; amount: number; status: string; protected?: boolean };

export function walletActivity(transactions: WalletTransaction[], withdrawals: Withdrawal[], earnings: Earning[] = []): WalletActivity[] {
  const rows: WalletActivity[] = [
    ...transactions.filter(row => row.transaction_type !== 'withdrawal' && row.transaction_type !== 'property_earning_pending').map(row => ({
      id: `t-${row.id}`, kind: row.transaction_type === 'withdrawal_reversal' ? 'withdrawals' as const : 'income' as const,
      title: row.description || row.transaction_type.replaceAll('_', ' '), date: row.created_at,
      amount: Number(row.amount), status: row.transaction_type,
    })),
    ...withdrawals.map(row => ({ id: `w-${row.id}`, kind: 'withdrawals' as const, title: 'Withdrawal',
      date: row.created_at, amount: -Number(row.amount), status: row.status })),
    // A release record is a lifecycle view, not another credit. Once released,
    // the canonical wallet movement is the only income row in this feed.
    ...earnings.filter(row => ['pending', 'held'].includes(row.status)).map(row => ({
      id: `e-${row.id}`, kind: 'protected' as const, title: row.earning_type.replaceAll('_', ' '),
      date: row.created_at, amount: Number(row.net_amount), status: 'Payment protected', protected: true,
    })),
  ];
  return rows.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}
