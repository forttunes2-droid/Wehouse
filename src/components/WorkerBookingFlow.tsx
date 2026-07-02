import { useState } from 'react';
import { WEHOUSE_FEES, WORKER_BOOKING_STATUS_LABELS } from '@/types';
import type { WorkerBookingStatus } from '@/types';

interface Props {
  workerName: string;
  workerService: string;
  onBook: (details: { amount: number; description: string; address: string; date: string }) => void;
  bookingStatus?: WorkerBookingStatus;
  bookingDetails?: {
    agreed_amount: number;
    wehouse_fee: number;
    worker_commission: number;
    worker_receives: number;
    booking_code: string;
  };
  onApproveWork?: () => void;
  onMarkComplete?: () => void;
}

export default function WorkerBookingFlow({
  workerName, workerService, onBook, bookingStatus, bookingDetails, onApproveWork, onMarkComplete,
}: Props) {
  const [step, setStep] = useState<'form' | 'review' | 'payment'>('form');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [address, setAddress] = useState('');
  const [date, setDate] = useState('');

  const numAmount = Number(amount) || 0;
  const wehouseFee = WEHOUSE_FEES.WORKER_BOOKING_FEE_USER;
  const workerCommission = Math.round(numAmount * (WEHOUSE_FEES.WORKER_COMMISSION_PERCENT / 100));
  const workerReceives = numAmount - workerCommission;
  const userPays = numAmount + wehouseFee;

  const handleSubmit = () => {
    if (numAmount < 1000) return;
    onBook({ amount: numAmount, description, address, date });
  };

  // If there's an active booking, show status
  if (bookingStatus && bookingDetails) {
    return <BookingStatusView status={bookingStatus} details={bookingDetails} workerName={workerName} onApprove={onApproveWork} onComplete={onMarkComplete} />;
  }

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-white">Book {workerName}</h3>
      <p className="text-[10px] text-[#5C5E72]">Service: {workerService}</p>

      {step === 'form' && (
        <div className="space-y-3">
          <div>
            <label className="text-[11px] text-[#8B8DA0] mb-1.5 block font-medium">Describe the work needed</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="e.g. My generator won't start. It makes a clicking sound but doesn't turn over."
              rows={3}
              className="w-full rounded-xl bg-[#1A1A24] border border-[#232330] text-white text-sm px-4 py-3 placeholder:text-[#5C5E72] outline-none focus:border-[#3B82F6] resize-none"
            />
          </div>

          <div>
            <label className="text-[11px] text-[#8B8DA0] mb-1.5 block font-medium">Your Address</label>
            <input
              value={address}
              onChange={e => setAddress(e.target.value)}
              placeholder="e.g. 15 Adeola Odeku Street, Victoria Island"
              className="w-full h-10 rounded-xl bg-[#1A1A24] border border-[#232330] text-white text-sm px-4 placeholder:text-[#5C5E72] outline-none focus:border-[#3B82F6]"
            />
          </div>

          <div>
            <label className="text-[11px] text-[#8B8DA0] mb-1.5 block font-medium">Preferred Date</label>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="w-full h-10 rounded-xl bg-[#1A1A24] border border-[#232330] text-white text-sm px-4 outline-none focus:border-[#3B82F6]"
            />
          </div>

          <div>
            <label className="text-[11px] text-[#8B8DA0] mb-1.5 block font-medium">Agreed Amount (N)</label>
            <input
              type="number"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="e.g. 5000"
              min={1000}
              className="w-full h-10 rounded-xl bg-[#1A1A24] border border-[#232330] text-white text-sm px-4 placeholder:text-[#5C5E72] outline-none focus:border-[#3B82F6]"
            />
            <p className="text-[9px] text-[#5C5E72] mt-1">Minimum N1,000. Agree on price with worker before booking.</p>
          </div>

          {numAmount >= 1000 && (
            <div className="rounded-xl bg-[#12121A] border border-white/[0.04] p-3 space-y-1.5">
              <h4 className="text-[10px] font-semibold text-[#8A8B9C] uppercase">Fee Breakdown</h4>
              <div className="flex justify-between text-xs"><span className="text-[#5C5E72]">Work fee</span><span className="text-white">N{numAmount.toLocaleString()}</span></div>
              <div className="flex justify-between text-xs"><span className="text-[#5C5E72]">Your booking fee</span><span className="text-amber-400">N{wehouseFee.toLocaleString()}</span></div>
              <div className="border-t border-white/[0.04] pt-1 flex justify-between text-xs"><span className="text-white font-semibold">You pay</span><span className="text-[#3B82F6] font-bold">N{userPays.toLocaleString()}</span></div>
              <div className="flex justify-between text-xs"><span className="text-emerald-400">{workerName} receives</span><span className="text-emerald-400 font-medium">N{workerReceives.toLocaleString()}</span></div>
              <div className="flex justify-between text-[9px]"><span className="text-[#5C5E72]">WeHouse commission ({WEHOUSE_FEES.WORKER_COMMISSION_PERCENT}%)</span><span className="text-[#5C5E72]">N{workerCommission.toLocaleString()}</span></div>
            </div>
          )}

          <button
            onClick={() => numAmount >= 1000 && setStep('review')}
            disabled={numAmount < 1000 || !description || !address}
            className="w-full h-11 rounded-xl bg-[#3B82F6] text-white font-semibold text-sm hover:bg-[#2563EB] transition-colors disabled:opacity-40 active:scale-[0.98]"
          >
            Continue to Payment
          </button>
        </div>
      )}

      {step === 'review' && (
        <div className="space-y-3">
          <div className="rounded-xl bg-[#12121A] border border-white/[0.04] p-4 space-y-2">
            <p className="text-xs text-[#5C5E72]"><strong className="text-white">Worker:</strong> {workerName}</p>
            <p className="text-xs text-[#5C5E72]"><strong className="text-white">Service:</strong> {workerService}</p>
            <p className="text-xs text-[#5C5E72]"><strong className="text-white">Description:</strong> {description}</p>
            <p className="text-xs text-[#5C5E72]"><strong className="text-white">Address:</strong> {address}</p>
            <p className="text-xs text-[#5C5E72]"><strong className="text-white">Date:</strong> {date || 'Flexible'}</p>
            <div className="border-t border-white/[0.04] pt-2 flex justify-between text-sm">
              <span className="text-white font-semibold">Total to Pay</span>
              <span className="text-[#3B82F6] font-bold">N{userPays.toLocaleString()}</span>
            </div>
          </div>

          <div className="rounded-xl bg-blue-500/5 border border-blue-500/10 p-3">
            <p className="text-[10px] text-blue-400">
              <strong>Escrow Protection:</strong> Your payment stays with Paystack until you approve the completed work. 
              If the worker doesn't show or does poor work, you can dispute and get refunded.
            </p>
          </div>

          <button onClick={handleSubmit} className="w-full h-11 rounded-xl bg-[#3B82F6] text-white font-semibold text-sm hover:bg-[#2563EB] transition-colors active:scale-[0.98]">
            Pay N{userPays.toLocaleString()} via Paystack
          </button>
          <button onClick={() => setStep('form')} className="w-full h-9 text-[11px] text-[#5C5E72] hover:text-white transition-colors">
            Go Back
          </button>
        </div>
      )}
    </div>
  );
}

function BookingStatusView({ status, details, workerName, onApprove, onComplete }: {
  status: WorkerBookingStatus; details: { agreed_amount: number; wehouse_fee: number; worker_commission: number; worker_receives: number; booking_code: string };
  workerName: string; onApprove?: () => void; onComplete?: () => void;
}) {
  const statusColors: Record<string, string> = {
    pending_payment: 'text-amber-400', paid_escrow: 'text-blue-400', worker_assigned: 'text-purple-400',
    in_progress: 'text-indigo-400', completed_pending_approval: 'text-orange-400',
    approved_released: 'text-emerald-400', disputed: 'text-red-400', cancelled: 'text-gray-400', refunded: 'text-gray-400',
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">Booking #{details.booking_code}</h3>
        <span className={`text-[10px] px-2 py-1 rounded-full bg-[#1A1A24] ${statusColors[status] || ''}`}>
          {WORKER_BOOKING_STATUS_LABELS[status]}
        </span>
      </div>

      <div className="rounded-xl bg-[#12121A] border border-white/[0.04] p-3 space-y-1.5">
        <div className="flex justify-between text-xs"><span className="text-[#5C5E72]">Worker</span><span className="text-white">{workerName}</span></div>
        <div className="flex justify-between text-xs"><span className="text-[#5C5E72]">Agreed Amount</span><span className="text-white">N{details.agreed_amount.toLocaleString()}</span></div>
        <div className="flex justify-between text-xs"><span className="text-[#5C5E72]">WeHouse Fee</span><span className="text-amber-400">N{details.wehouse_fee.toLocaleString()}</span></div>
        <div className="border-t border-white/[0.04] pt-1 flex justify-between text-xs">
          <span className="text-emerald-400">{workerName} will receive</span>
          <span className="text-emerald-400 font-medium">N{details.worker_receives.toLocaleString()}</span>
        </div>
      </div>

      {/* Action buttons based on status */}
      {status === 'paid_escrow' && (
        <div className="rounded-xl bg-blue-500/5 border border-blue-500/10 p-3">
          <p className="text-[10px] text-blue-400">Your payment is held securely. {workerName} has been notified and will arrive at the scheduled time.</p>
        </div>
      )}

      {status === 'in_progress' && onComplete && (
        <button onClick={onComplete} className="w-full h-11 rounded-xl bg-[#3B82F6] text-white font-semibold text-sm hover:bg-[#2563EB] transition-colors active:scale-[0.98]">
          Mark Work as Complete
        </button>
      )}

      {status === 'completed_pending_approval' && onApprove && (
        <div className="space-y-2">
          <div className="rounded-xl bg-orange-500/5 border border-orange-500/10 p-3">
            <p className="text-[10px] text-orange-400">
              {workerName} has marked the job as complete. Please review the work before releasing payment.
            </p>
          </div>
          <button onClick={onApprove} className="w-full h-11 rounded-xl bg-emerald-500 text-white font-semibold text-sm hover:bg-emerald-600 transition-colors active:scale-[0.98]">
            Approve Work & Release Payment
          </button>
          <button className="w-full h-9 rounded-xl border border-red-500/30 text-red-400 text-xs font-semibold hover:bg-red-500/10 transition-colors">
            Report Issue / Open Dispute
          </button>
        </div>
      )}

      {status === 'approved_released' && (
        <div className="rounded-xl bg-emerald-500/5 border border-emerald-500/10 p-3">
          <p className="text-[10px] text-emerald-400">Payment released to {workerName}. Thank you for using WeHouse!</p>
        </div>
      )}
    </div>
  );
}
