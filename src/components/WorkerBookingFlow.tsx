import { useState } from 'react';
import { WORKER_BOOKING_STATUS_LABELS } from '@/types';
import type { WorkerBookingStatus } from '@/types';

interface Props {
  workerName: string;
  workerService: string;
  workerId: string;
  userId: string;
  onBook?: (details: { description: string; address: string; date: string }) => void;
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
  const [step, setStep] = useState<'form' | 'review' | 'sent'>('form');
  const [description, setDescription] = useState('');
  const [address, setAddress] = useState('');
  const [date, setDate] = useState('');

  // If there's an active booking, show status
  if (bookingStatus && bookingDetails) {
    return <BookingStatusView status={bookingStatus} details={bookingDetails} workerName={workerName} onApprove={onApproveWork} onComplete={onMarkComplete} />;
  }

  return (
    <div className="space-y-4">
      {step === 'form' && (
        <>
          <div>
            <h3 className="text-sm font-semibold text-white">Book {workerName}</h3>
            <p className="text-[10px] text-[#5C5E72]">Service: {workerService}</p>
          </div>

          <div className="rounded-xl bg-blue-500/5 border border-blue-500/10 p-3">
            <p className="text-[10px] text-blue-400 leading-relaxed">
              <strong>How it works:</strong> Send a booking request with details. 
              {workerName} will review and set a price. Once approved, you can pay to confirm. 
              Chat opens after sending the request so you can discuss details.
            </p>
          </div>

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

            <button
              onClick={() => setStep('review')}
              disabled={!description || !address}
              className="w-full h-11 rounded-xl bg-[#3B82F6] text-white font-semibold text-sm hover:bg-[#2563EB] transition-colors disabled:opacity-40 active:scale-[0.98]"
            >
              Review Request
            </button>
          </div>
        </>
      )}

      {step === 'review' && (
        <>
          <h3 className="text-sm font-semibold text-white">Review Booking Request</h3>
          <div className="rounded-xl bg-[#12121A] border border-white/[0.04] p-4 space-y-2">
            <p className="text-xs text-[#5C5E72]"><strong className="text-white">Worker:</strong> {workerName}</p>
            <p className="text-xs text-[#5C5E72]"><strong className="text-white">Service:</strong> {workerService}</p>
            <p className="text-xs text-[#5C5E72]"><strong className="text-white">Description:</strong> {description}</p>
            <p className="text-xs text-[#5C5E72]"><strong className="text-white">Address:</strong> {address}</p>
            <p className="text-xs text-[#5C5E72]"><strong className="text-white">Date:</strong> {date || 'Flexible'}</p>
          </div>

          <div className="rounded-xl bg-amber-500/5 border border-amber-500/20 p-3">
            <p className="text-[10px] text-amber-400">
              <strong>Note:</strong> {workerName} will set the price after reviewing your request. 
              You'll be notified when they respond. Payment is only required after price is agreed.
            </p>
          </div>

          <button
            onClick={() => {
              onBook?.({ description, address, date });
              setStep('sent');
            }}
            className="w-full h-11 rounded-xl bg-[#3B82F6] text-white font-semibold text-sm hover:bg-[#2563EB] transition-colors active:scale-[0.98]"
          >
            Send Booking Request
          </button>
          <button onClick={() => setStep('form')} className="w-full h-9 text-[11px] text-[#5C5E72] hover:text-white transition-colors">
            Go Back
          </button>
        </>
      )}

      {step === 'sent' && (
        <div className="text-center py-6 space-y-3">
          <div className="w-14 h-14 rounded-full bg-green-500/10 flex items-center justify-center mx-auto">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2"><path d="M20 6L9 17l-5-5" /></svg>
          </div>
          <p className="text-sm font-semibold text-white">Booking Request Sent!</p>
          <p className="text-xs text-[#5C5E72]">
            {workerName} will review your request and set a price. 
            You'll be notified when they respond.
          </p>
          <p className="text-[10px] text-blue-400">
            You can now chat with {workerName} to discuss details.
          </p>
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
        <div className="flex justify-between text-xs"><span className="text-[#5C5E72]">Agreed Amount</span><span className="text-white">N{details.agreed_amount.toLocaleString()}</span></div>
        <div className="flex justify-between text-xs"><span className="text-[#5C5E72]">Booking Fee</span><span className="text-amber-400">N{details.wehouse_fee.toLocaleString()}</span></div>
        <div className="border-t border-white/[0.04] pt-1 flex justify-between text-xs"><span className="text-white font-semibold">Total</span><span className="text-[#3B82F6] font-bold">N{(details.agreed_amount + details.wehouse_fee).toLocaleString()}</span></div>
        <div className="flex justify-between text-[9px]"><span className="text-emerald-400">{workerName} receives</span><span className="text-emerald-400">N{details.worker_receives.toLocaleString()}</span></div>
      </div>

      {status === 'completed_pending_approval' && onApprove && (
        <button onClick={onApprove} className="w-full h-11 rounded-xl bg-emerald-500 text-white font-semibold text-sm">
          Approve Work & Release Payment
        </button>
      )}
      {status === 'in_progress' && onComplete && (
        <button onClick={onComplete} className="w-full h-11 rounded-xl bg-[#3B82F6] text-white font-semibold text-sm">
          Mark Work as Complete
        </button>
      )}
    </div>
  );
}
