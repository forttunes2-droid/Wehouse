import { useEffect, useMemo, useState } from 'react';
import { Toaster, toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/types';

type WalletRow = {
  id: string;
  available_balance: number;
  pending_balance: number;
  frozen_balance: number;
  total_withdrawn: number;
  is_frozen: boolean;
  frozen_reason: string | null;
};

type BankAccount = {
  id: string;
  bank_name: string;
  account_number: string;
  account_name: string;
  is_default: boolean;
};

type Tab = 'overview' | 'withdraw' | 'activity';

const money = (value: number) => `₦${Number(value || 0).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;

export default function WorkerWallet({ profile }: { profile: Profile }) {
  const [tab, setTab] = useState<Tab>('overview');
  const [wallet, setWallet] = useState<WalletRow | null>(null);
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
    const [walletResult, transactionResult, withdrawalResult, bankResult] = await Promise.all([
      supabase.from('wallets').select('id,available_balance,pending_balance,frozen_balance,total_withdrawn,is_frozen,frozen_reason').eq('owner_id', profile.user_id).eq('owner_type', 'worker').maybeSingle(),
      supabase.from('wallet_transactions').select('*').eq('user_id', profile.user_id).order('created_at', { ascending: false }).limit(30),
      supabase.from('withdrawals').select('id,amount,status,created_at,failed_reason,wallets!inner(owner_id)').eq('wallets.owner_id', profile.user_id).order('created_at', { ascending: false }).limit(20),
      supabase.from('bank_accounts').select('id,bank_name,account_number,account_name,is_default').eq('user_id', profile.user_id).order('is_default', { ascending: false }),
    ]);

    if (walletResult.error) toast.error('Unable to load worker wallet');
    setWallet((walletResult.data || null) as WalletRow | null);
    setTransactions(transactionResult.data || []);
    setWithdrawals(withdrawalResult.data || []);
    setBanks((bankResult.data || []) as BankAccount[]);
    if (!selectedBankId && bankResult.data?.[0]?.id) setSelectedBankId(bankResult.data[0].id);
    setLoading(false);
  }

  useEffect(() => { void load(); }, [profile.user_id]);

  async function withdraw() {
    if (!wallet) return;
    const numericAmount = Number(amount);
    if (!numericAmount || numericAmount <= 0) return toast.error('Enter a valid amount');
    if (numericAmount > Number(wallet.available_balance || 0)) return toast.error('Insufficient available balance');
    if (!selectedBank) return toast.error('Add a bank account before withdrawing');
    if (wallet.is_frozen) return toast.error(wallet.frozen_reason || 'Your wallet is frozen');

    setSubmitting(true);
    const { data, error } = await supabase.rpc('request_worker_withdrawal', {
      p_amount: numericAmount,
      p_bank_account_id: selectedBank.id,
    });
    setSubmitting(false);

    if (error) return toast.error('We could not submit this withdrawal. Please try again.');
    if (!data?.success) return toast.error(data?.error || 'Withdrawal request failed');
    toast.success('Withdrawal request submitted');
    setAmount('');
    setTab('activity');
    await load();
  }

  if (loading) return <div className="grid min-h-56 place-items-center"><div className="h-8 w-8 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" /></div>;
  if (!wallet) return <section className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.06] p-5 text-xs text-amber-300">Your worker wallet has not been created yet. Complete worker verification or contact WeHouse support.</section>;

  const tabs: Array<{ key: Tab; label: string }> = [
    { key: 'overview', label: 'Overview' },
    { key: 'withdraw', label: 'Withdraw' },
    { key: 'activity', label: 'Activity' },
  ];

  return <div className="min-h-[100dvh] bg-[#09090D] px-4 py-5 pb-24 text-white lg:px-8 lg:py-8">
    <Toaster position="top-center" richColors />
    <div className="mx-auto max-w-6xl space-y-5">
      <section className="overflow-hidden rounded-3xl border border-violet-500/15 bg-gradient-to-br from-violet-500/[0.12] via-[#151520] to-[#101018] p-5 lg:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-300">Worker wallet</p><p className="mt-2 text-3xl font-bold lg:text-4xl">{money(wallet.available_balance)}</p><p className="mt-2 text-[10px] text-[#85879A]">Available earnings that can be withdrawn.</p></div>{wallet.is_frozen && <span className="rounded-full border border-red-500/20 bg-red-500/10 px-3 py-1 text-[10px] font-semibold text-red-300">Wallet frozen</span>}</div>
        <div className="mt-6 grid grid-cols-3 gap-2"><Small label="Pending" value={money(wallet.pending_balance)} /><Small label="Held" value={money(wallet.frozen_balance)} /><Small label="Withdrawn" value={money(wallet.total_withdrawn)} /></div>
      </section>

      <div className="flex gap-1 rounded-xl border border-white/[0.05] bg-[#111119] p-1">{tabs.map(item => <button key={item.key} onClick={() => setTab(item.key)} className={`flex-1 rounded-lg px-3 py-2.5 text-[11px] font-semibold transition ${tab === item.key ? 'bg-violet-500 text-white' : 'text-[#77798B] hover:text-white'}`}>{item.label}</button>)}</div>

      {tab === 'overview' && <div className="space-y-4"><section className="grid grid-cols-2 gap-3 lg:grid-cols-4"><Card label="Available" value={wallet.available_balance} /><Card label="Pending" value={wallet.pending_balance} /><Card label="Held" value={wallet.frozen_balance} /><Card label="Withdrawn" value={wallet.total_withdrawn} /></section>{wallet.frozen_reason && <section className="rounded-2xl border border-red-500/20 bg-red-500/[0.06] p-4 text-[10px] text-red-300">{wallet.frozen_reason}</section>}<section className="rounded-2xl border border-white/[0.06] bg-[#111119] p-4 text-[10px] leading-relaxed text-[#797B8E]">Only completed and released job earnings become available. Pending, disputed or frozen funds cannot be withdrawn.</section></div>}

      {tab === 'withdraw' && <section className="rounded-2xl border border-white/[0.06] bg-[#111119] p-5"><h2 className="text-sm font-semibold">Request withdrawal</h2><p className="mt-1 text-[10px] text-[#66687B]">Choose a saved bank account and enter an amount from your available balance.</p><div className="mt-5 space-y-3"><input type="number" min="0" value={amount} onChange={event => setAmount(event.target.value)} placeholder="Amount" className="h-11 w-full rounded-xl border border-white/[0.08] bg-[#181822] px-3 text-sm outline-none focus:border-violet-500" />{banks.length === 0 ? <div className="rounded-xl border border-amber-500/15 bg-amber-500/[0.05] p-4 text-[10px] text-amber-300">No bank account found. Add one from Account Settings before withdrawing.</div> : <div className="space-y-2">{banks.map(bank => <button key={bank.id} onClick={() => setSelectedBankId(bank.id)} className={`w-full rounded-xl border p-3 text-left ${selectedBank?.id === bank.id ? 'border-violet-500/35 bg-violet-500/[0.08]' : 'border-white/[0.06] bg-white/[0.025]'}`}><div className="flex items-center justify-between"><div><p className="text-xs font-medium">{bank.bank_name}</p><p className="mt-1 text-[9px] text-[#66687B]">{bank.account_number} · {bank.account_name}</p></div>{bank.is_default && <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-[8px] text-emerald-300">Default</span>}</div></button>)}</div>}<button onClick={() => void withdraw()} disabled={submitting || !amount || !selectedBank} className="h-11 w-full rounded-xl bg-violet-500 text-xs font-semibold disabled:opacity-40">{submitting ? 'Submitting…' : 'Request withdrawal'}</button></div></section>}

      {tab === 'activity' && <div className="grid gap-4 lg:grid-cols-2"><List title="Transactions" empty="No wallet transactions yet." rows={transactions.map(row => ({ id: row.id, title: row.description || row.transaction_type || 'Transaction', note: new Date(row.created_at).toLocaleDateString(), amount: Number(row.amount || 0), status: row.transaction_type }))} /><List title="Withdrawals" empty="No withdrawal requests yet." rows={withdrawals.map(row => ({ id: row.id, title: `Withdrawal · ${row.status}`, note: new Date(row.created_at).toLocaleDateString(), amount: -Number(row.amount || 0), status: row.status }))} /></div>}
    </div>
  </div>;
}

function Small({ label, value }: { label: string; value: string }) { return <div className="rounded-xl border border-white/[0.06] bg-black/10 p-3"><p className="text-[8px] uppercase tracking-wide text-[#6C6E80]">{label}</p><p className="mt-1 truncate text-xs font-semibold">{value}</p></div>; }
function Card({ label, value }: { label: string; value: number }) { return <div className="rounded-2xl border border-white/[0.06] bg-[#111119] p-4"><p className="text-[9px] text-[#66687B]">{label}</p><p className="mt-2 text-lg font-bold">{money(value)}</p></div>; }
function List({ title, empty, rows }: { title: string; empty: string; rows: Array<{ id: string; title: string; note: string; amount: number; status: string }> }) { return <section className="rounded-2xl border border-white/[0.06] bg-[#111119] p-4"><h2 className="text-sm font-semibold">{title}</h2>{rows.length === 0 ? <p className="py-10 text-center text-[10px] text-[#5E6072]">{empty}</p> : <div className="mt-3 divide-y divide-white/[0.05]">{rows.map(row => <div key={row.id} className="flex items-center justify-between gap-3 py-3"><div className="min-w-0"><p className="truncate text-[11px] font-medium">{row.title}</p><p className="mt-1 text-[9px] text-[#5E6072]">{row.note} · {row.status?.replace(/_/g, ' ')}</p></div><p className={`text-xs font-semibold ${row.amount < 0 ? 'text-red-300' : 'text-emerald-300'}`}>{row.amount < 0 ? '-' : '+'}{money(Math.abs(row.amount))}</p></div>)}</div>}</section>; }
