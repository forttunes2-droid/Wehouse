import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/types';

type Finance = {
  available_balance: number;
  pending_balance: number;
  frozen_balance: number;
  total_withdrawn: number;
  total_earnings: number;
  apartment_commission_rate: number;
  hotel_commission_rate: number;
  minimum_withdrawal: number;
  is_frozen: boolean;
};

type BankAccount = {
  id: string;
  bank_name: string;
  bank_code: string | null;
  account_number: string;
  account_name: string;
  is_default: boolean;
};

type FinanceTab = 'overview' | 'withdraw' | 'activity';

const money = (value: number) => `₦${Number(value || 0).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;

export default function PropertyPartnerFinancePanel({ profile }: { profile: Profile }) {
  const [tab, setTab] = useState<FinanceTab>('overview');
  const [finance, setFinance] = useState<Finance | null>(null);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [withdrawals, setWithdrawals] = useState<any[]>([]);
  const [banks, setBanks] = useState<BankAccount[]>([]);
  const [selectedBankId, setSelectedBankId] = useState('');
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const selectedBank = useMemo(() => banks.find(bank => bank.id === selectedBankId) || banks.find(bank => bank.is_default) || banks[0], [banks, selectedBankId]);

  async function load() {
    setLoading(true);
    const [financeResult, transactionResult, withdrawalResult, bankResult] = await Promise.all([
      supabase.rpc('get_my_property_partner_finance'),
      supabase.from('wallet_transactions').select('*').eq('user_id', profile.user_id).order('created_at', { ascending: false }).limit(30),
      supabase.from('withdrawals').select('id,amount,status,created_at,failed_reason,wallets!inner(owner_id)').eq('wallets.owner_id', profile.user_id).order('created_at', { ascending: false }).limit(20),
      supabase.from('bank_accounts').select('id,bank_name,bank_code,account_number,account_name,is_default').eq('user_id', profile.user_id).order('is_default', { ascending: false }),
    ]);

    if (financeResult.error) toast.error('Unable to load your wallet');
    setFinance((financeResult.data || null) as Finance | null);
    setTransactions(transactionResult.data || []);
    setWithdrawals(withdrawalResult.data || []);
    setBanks((bankResult.data || []) as BankAccount[]);
    if (!selectedBankId && bankResult.data?.[0]?.id) setSelectedBankId(bankResult.data[0].id);
    setLoading(false);
  }

  useEffect(() => { void load(); }, [profile.user_id]);

  async function requestWithdrawal() {
    if (!finance) return;
    const numericAmount = Number(amount);
    if (!numericAmount || numericAmount <= 0) return toast.error('Enter a valid amount');
    if (numericAmount < Number(finance.minimum_withdrawal || 0)) return toast.error(`Minimum withdrawal is ${money(finance.minimum_withdrawal)}`);
    if (numericAmount > Number(finance.available_balance || 0)) return toast.error('Insufficient available balance');
    if (!selectedBank) return toast.error('Add a bank account before withdrawing');
    if (!selectedBank.bank_code) return toast.error('This bank account is missing its bank code. Update the account before withdrawing.');
    if (finance.is_frozen) return toast.error('Your wallet is currently frozen. Contact WeHouse support.');

    setSubmitting(true);
    const { error } = await supabase.rpc('request_my_property_partner_withdrawal', {
      p_amount: numericAmount,
      p_bank_account_number: selectedBank.account_number,
      p_bank_code: selectedBank.bank_code,
      p_bank_name: selectedBank.bank_name,
      p_account_name: selectedBank.account_name,
    });
    setSubmitting(false);

    if (error) return toast.error(error.message || 'Withdrawal request failed');
    toast.success('Withdrawal request submitted');
    setAmount('');
    setTab('activity');
    await load();
  }

  if (loading) return <div className="grid min-h-40 place-items-center"><div className="h-7 w-7 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" /></div>;
  if (!finance) return <section className="rounded-2xl border border-red-500/20 bg-red-500/[0.06] p-5 text-xs text-red-300">Unable to load Property Partner finances.</section>;

  const tabs: Array<{ key: FinanceTab; label: string }> = [
    { key: 'overview', label: 'Overview' },
    { key: 'withdraw', label: 'Withdraw' },
    { key: 'activity', label: 'Activity' },
  ];

  return <div className="space-y-5">
    <section className="overflow-hidden rounded-3xl border border-violet-500/15 bg-gradient-to-br from-violet-500/[0.12] via-[#151520] to-[#101018] p-5 lg:p-7">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-300">Available balance</p><p className="mt-2 text-3xl font-bold lg:text-4xl">{money(finance.available_balance)}</p><p className="mt-2 text-[10px] text-[#85879A]">Only released property earnings can be withdrawn.</p></div>{finance.is_frozen && <span className="rounded-full border border-red-500/20 bg-red-500/10 px-3 py-1 text-[10px] font-semibold text-red-300">Wallet frozen</span>}</div>
      <div className="mt-6 grid grid-cols-3 gap-2"><SmallMetric label="Pending" value={money(finance.pending_balance)} /><SmallMetric label="Held" value={money(finance.frozen_balance)} /><SmallMetric label="Withdrawn" value={money(finance.total_withdrawn)} /></div>
    </section>

    <div className="flex gap-1 rounded-xl border border-white/[0.05] bg-[#111119] p-1">{tabs.map(item => <button key={item.key} onClick={() => setTab(item.key)} className={`flex-1 rounded-lg px-3 py-2.5 text-[11px] font-semibold transition ${tab === item.key ? 'bg-violet-500 text-white' : 'text-[#77798B] hover:text-white'}`}>{item.label}</button>)}</div>

    {tab === 'overview' && <div className="space-y-4">
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4"><FinanceCard label="Available" value={finance.available_balance} /><FinanceCard label="Pending release" value={finance.pending_balance} /><FinanceCard label="Total released" value={finance.total_earnings} /><FinanceCard label="Total withdrawn" value={finance.total_withdrawn} /></section>
      <section className="grid gap-3 md:grid-cols-2"><div className="rounded-2xl border border-white/[0.06] bg-[#111119] p-4"><p className="text-[10px] text-[#686A7D]">Apartment Commission</p><p className="mt-2 text-xl font-bold">{finance.apartment_commission_rate}%</p><p className="mt-1 text-[9px] text-[#56586B]">Taken by WeHouse from eligible apartment income.</p></div><div className="rounded-2xl border border-white/[0.06] bg-[#111119] p-4"><p className="text-[10px] text-[#686A7D]">Hotel Commission</p><p className="mt-2 text-xl font-bold">{finance.hotel_commission_rate}%</p><p className="mt-1 text-[9px] text-[#56586B]">Taken by WeHouse from eligible hotel income.</p></div></section>
      <section className="rounded-2xl border border-white/[0.06] bg-[#111119] p-4 text-[10px] leading-relaxed text-[#797B8E]">Reservation fees belong to WeHouse. Eligible rent and hotel payments enter pending balance after commission and move to available only after the required real-world release event.</section>
    </div>}

    {tab === 'withdraw' && <section className="rounded-2xl border border-white/[0.06] bg-[#111119] p-5"><div><h2 className="text-sm font-semibold">Request withdrawal</h2><p className="mt-1 text-[10px] text-[#66687B]">Minimum: {money(finance.minimum_withdrawal)}</p></div><div className="mt-5 space-y-3"><input type="number" min="0" value={amount} onChange={event => setAmount(event.target.value)} placeholder="Amount" className="h-11 w-full rounded-xl border border-white/[0.08] bg-[#181822] px-3 text-sm outline-none focus:border-violet-500" />{banks.length === 0 ? <div className="rounded-xl border border-amber-500/15 bg-amber-500/[0.05] p-4 text-[10px] text-amber-300">No bank account found. Add one from Account Settings before withdrawing.</div> : <div className="space-y-2">{banks.map(bank => <button key={bank.id} onClick={() => setSelectedBankId(bank.id)} className={`w-full rounded-xl border p-3 text-left ${selectedBank?.id === bank.id ? 'border-violet-500/35 bg-violet-500/[0.08]' : 'border-white/[0.06] bg-white/[0.025]'}`}><div className="flex items-center justify-between"><div><p className="text-xs font-medium">{bank.bank_name}</p><p className="mt-1 text-[9px] text-[#66687B]">{bank.account_number} · {bank.account_name}</p></div>{bank.is_default && <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-[8px] text-emerald-300">Default</span>}</div></button>)}</div>}<button onClick={() => void requestWithdrawal()} disabled={submitting || !amount || !selectedBank} className="h-11 w-full rounded-xl bg-violet-500 text-xs font-semibold disabled:opacity-40">{submitting ? 'Submitting…' : 'Request withdrawal'}</button></div></section>}

    {tab === 'activity' && <div className="grid gap-4 lg:grid-cols-2"><ActivityList title="Transactions" empty="No wallet transactions yet." rows={transactions.map(row => ({ id: row.id, title: row.description || row.transaction_type || 'Transaction', note: new Date(row.created_at).toLocaleDateString(), amount: Number(row.amount || 0), status: row.transaction_type }))} /><ActivityList title="Withdrawals" empty="No withdrawal requests yet." rows={withdrawals.map(row => ({ id: row.id, title: `Withdrawal · ${row.status}`, note: new Date(row.created_at).toLocaleDateString(), amount: -Number(row.amount || 0), status: row.status }))} /></div>}
  </div>;
}

function SmallMetric({ label, value }: { label: string; value: string }) { return <div className="rounded-xl border border-white/[0.06] bg-black/10 p-3"><p className="text-[8px] uppercase tracking-wide text-[#6C6E80]">{label}</p><p className="mt-1 truncate text-xs font-semibold">{value}</p></div>; }
function FinanceCard({ label, value }: { label: string; value: number }) { return <div className="rounded-2xl border border-white/[0.06] bg-[#111119] p-4"><p className="text-[9px] text-[#66687B]">{label}</p><p className="mt-2 text-lg font-bold">{money(value)}</p></div>; }
function ActivityList({ title, empty, rows }: { title: string; empty: string; rows: Array<{ id: string; title: string; note: string; amount: number; status: string }> }) { return <section className="rounded-2xl border border-white/[0.06] bg-[#111119] p-4"><h2 className="text-sm font-semibold">{title}</h2>{rows.length === 0 ? <p className="py-10 text-center text-[10px] text-[#5E6072]">{empty}</p> : <div className="mt-3 divide-y divide-white/[0.05]">{rows.map(row => <div key={row.id} className="flex items-center justify-between gap-3 py-3"><div className="min-w-0"><p className="truncate text-[11px] font-medium">{row.title}</p><p className="mt-1 text-[9px] text-[#5E6072]">{row.note} · {row.status?.replace(/_/g, ' ')}</p></div><p className={`text-xs font-semibold ${row.amount < 0 ? 'text-red-300' : 'text-emerald-300'}`}>{row.amount < 0 ? '-' : '+'}{money(Math.abs(row.amount))}</p></div>)}</div>}</section>; }
