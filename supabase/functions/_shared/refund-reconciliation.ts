import { paymentMinorUnits } from './payment-market.ts';

export type RefundSnapshot = { financial_action_id:string; amount:unknown; status:string; provider_action_id:string|null; paystack_reference:string };
async function providerGet(path:string,secret:string,request:typeof fetch){
 const response=await request('https://api.paystack.co'+path,{headers:{Authorization:`Bearer ${secret}`},signal:AbortSignal.timeout(8000)});
 const raw=await response.text();let result;
 try{result=JSON.parse(raw);}catch{throw new Error('Provider response could not be verified');}
 if(!response.ok||result?.status!==true||!result.data)throw new Error('Provider lookup could not be confirmed');
 return {data:result.data,raw};
}
/** Establish the original successful charge before sending or reconciling a refund. */
export async function verifyRefundPayment(snapshot:Pick<RefundSnapshot,'amount'|'paystack_reference'>,secret:string,request:typeof fetch=fetch){
 const environment=secret.startsWith('sk_test_')?'test':secret.startsWith('sk_live_')?'live':null;
 const amount=paymentMinorUnits(snapshot.amount,2);
 if(!environment||!snapshot.paystack_reference||amount===null)throw new Error('Refund payment requires Finance review');
 const transaction=await providerGet('/transaction/verify/'+encodeURIComponent(snapshot.paystack_reference),secret,request);
 const originalId=String(transaction.data.id??'');
 if(transaction.data.reference!==snapshot.paystack_reference||transaction.data.currency!=='NGN'||transaction.data.domain!==environment
 ||transaction.data.status!=='success'||!Number.isSafeInteger(transaction.data.amount)||transaction.data.amount<amount
 ||!/^[1-9]\d{0,30}$/.test(originalId)||(typeof transaction.data.id==='number'&&!Number.isSafeInteger(transaction.data.id)))
 throw new Error('Original transaction does not match the refund obligation');
 return {transaction,originalId,amount,environment};
}
export async function verifyRefundLookup(snapshot:RefundSnapshot, refundId:string, secret:string, request:typeof fetch=fetch){
  if(!/^[1-9]\d{0,30}$/.test(refundId)||!snapshot.paystack_reference)throw new Error('A valid provider refund ID and original payment are required');
  if(snapshot.provider_action_id && snapshot.provider_action_id!==refundId)throw new Error('This action already belongs to another provider refund');
  const {transaction,originalId,amount,environment}=await verifyRefundPayment(snapshot,secret,request);
  const refund=await providerGet('/refund/'+encodeURIComponent(refundId),secret,request);
  const data=refund.data;
  const transactionId=String(typeof data.transaction==='object'?data.transaction?.id:data.transaction);
  if(String(data.id)!==refundId||transactionId!==originalId||data.domain!==environment||data.currency!=='NGN'
    ||!Number.isSafeInteger(data.amount)||data.amount!==amount
    ||!['pending','processing','needs-attention','failed','processed'].includes(data.status))
    throw new Error('Provider refund does not match this action');
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(transaction.raw+'\n'+refund.raw));
  return {providerId:refundId,status:String(data.status),amountMinor:amount,currency:'NGN',
    checksum:[...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('')};
}
