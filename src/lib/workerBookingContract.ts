export const WORKER_JOB_STATUSES = [
  'booking_requested',
  'negotiating',
  'waiting_payment',
  'confirmed',
  'in_progress',
  'completed_pending_approval',
  'approved_released',
  'cancelled',
  'disputed',
  'refunded',
] as const;

export type WorkerJobStatus = (typeof WORKER_JOB_STATUSES)[number];
export type WorkerMoneyState =
  | 'unpaid'
  | 'payment_pending'
  | 'protected'
  | 'release_pending'
  | 'released'
  | 'refunded'
  | 'review';

export const BOOKING_STATUS_LABELS: Record<WorkerJobStatus,{label:string;color:string;description:string}> = {
  booking_requested:{label:'Booking requested',color:'bg-amber-500/10 text-amber-400',description:'Waiting for the Worker to respond'},
  negotiating:{label:'Negotiating',color:'bg-blue-500/10 text-blue-400',description:'Discussing the job, schedule and price'},
  waiting_payment:{label:'Waiting for payment',color:'bg-purple-500/10 text-purple-400',description:'The job terms are agreed and payment is required'},
  confirmed:{label:'Confirmed',color:'bg-emerald-500/10 text-emerald-400',description:'Payment Protection is active and the job can start'},
  in_progress:{label:'In progress',color:'bg-indigo-500/10 text-indigo-400',description:'The job is underway'},
  completed_pending_approval:{label:'Awaiting confirmation',color:'bg-orange-500/10 text-orange-400',description:'The Worker marked the job complete; customer confirmation is pending'},
  approved_released:{label:'Completed',color:'bg-emerald-500/10 text-emerald-400',description:'The job is complete and protected payment has been released'},
  disputed:{label:'Under review',color:'bg-red-500/10 text-red-400',description:'Payment Protection is paused while WeHouse reviews the issue'},
  cancelled:{label:'Cancelled',color:'bg-gray-500/10 text-gray-400',description:'Booking cancelled'},
  refunded:{label:'Refunded',color:'bg-gray-500/10 text-gray-400',description:'The protected payment was refunded'},
};

export const WORKER_MONEY_LABELS: Record<WorkerMoneyState,string> = {
  unpaid:'Not paid',
  payment_pending:'Payment pending',
  protected:'Payment protected',
  release_pending:'Release pending',
  released:'Payment released',
  refunded:'Refunded',
  review:'Payment Protection review',
};

const canonicalStatuses = new Set<string>(WORKER_JOB_STATUSES);

export function normalizeWorkerJobStatus(raw:unknown,paymentProtected=false):WorkerJobStatus{
  const value=String(raw||'');
  // A short-lived legacy client used payment_protected as if it were a job
  // status. Protection is money state; the corresponding valid job state is
  // confirmed until work actually starts.
  if(value==='payment_protected')return 'confirmed';
  if(canonicalStatuses.has(value))return value as WorkerJobStatus;
  if(paymentProtected)return 'confirmed';
  return 'booking_requested';
}

export function workerMoneyState(row:any):WorkerMoneyState{
  const rawJob=String(row?.booking_status??row?.status??'');
  const rawMoney=String(row?.protection_status??row?.payment_status??'').toLowerCase();
  if(rawJob==='disputed'||['review','under_review','frozen','disputed'].includes(rawMoney))return 'review';
  if(rawJob==='refunded'||rawMoney==='refunded')return 'refunded';
  if(rawJob==='approved_released'||['released','paid_out'].includes(rawMoney))return 'released';
  if(['release_pending','releasing'].includes(rawMoney))return 'release_pending';
  if(rawJob==='payment_protected'||row?.payment_protected===true||['protected','payment_protected','secured'].includes(rawMoney))return 'protected';
  if(rawJob==='waiting_payment'||['pending','payment_pending','processing'].includes(rawMoney))return 'payment_pending';
  return 'unpaid';
}

export function normalizeWorkerBookingRow<T extends Record<string,any>>(row:T):T & {booking_status:WorkerJobStatus;status:WorkerJobStatus;money_state:WorkerMoneyState;money_label:string;payment_protected:boolean}{
  const moneyState=workerMoneyState(row);
  const status=normalizeWorkerJobStatus(row.booking_status??row.status,moneyState==='protected');
  return {
    ...row,
    booking_status:status,
    status,
    money_state:moneyState,
    money_label:WORKER_MONEY_LABELS[moneyState],
    payment_protected:moneyState==='protected'||Boolean(row.payment_protected),
  };
}

export function workerNextAction(status:WorkerJobStatus,money:WorkerMoneyState,actor:'customer'|'worker'){
  if(['approved_released','cancelled','refunded'].includes(status))return null;
  if(status==='booking_requested')return actor==='worker'?'Respond to request':'Waiting for Worker';
  if(status==='negotiating')return 'Agree job details';
  if(status==='waiting_payment')return actor==='customer'?'Pay with Payment Protection':'Waiting for protected payment';
  if(status==='confirmed')return actor==='worker'?(money==='protected'?'Start job':'Wait for Payment Protection'):'Waiting for Worker to start';
  if(status==='in_progress')return actor==='worker'?'Mark work complete':'Job in progress';
  if(status==='completed_pending_approval')return actor==='customer'?'Confirm completion':'Waiting for customer confirmation';
  if(status==='disputed')return 'WeHouse review in progress';
  return null;
}
