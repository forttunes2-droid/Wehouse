export type ServiceQuote={revision:number;booking_id:string;customer_id:string;provider_id:string;amount:number;currency:'NGN';customer_service_charge:0;scope:string;address:string;starts_at:string;timezone:string;cancellation:{version:'service-standard-24h-v1';full_refund_until:string;late_cancellation:'wehouse_review';provider_cancellation:'full_refund'}};
export function parseServiceQuote(value:unknown):ServiceQuote|null{
 const q=value as ServiceQuote|null;
 if(!q||!Number.isSafeInteger(q.revision)||q.revision<1||![q.booking_id,q.customer_id,q.provider_id,q.scope,q.address,q.starts_at,q.timezone].every(v=>typeof v==='string'&&v.trim().length>0)
  ||typeof q.amount!=='number'||!Number.isFinite(q.amount)||q.amount<=0||Number(q.amount.toFixed(2))!==q.amount||!Number.isSafeInteger(Math.round(q.amount*100))
  ||q.currency!=='NGN'||q.customer_service_charge!==0||q.cancellation?.version!=='service-standard-24h-v1'
  ||q.cancellation?.late_cancellation!=='wehouse_review'||q.cancellation?.provider_cancellation!=='full_refund'
  ||!Number.isFinite(Date.parse(q.starts_at))||Date.parse(q.starts_at)-Date.parse(q.cancellation.full_refund_until)!==24*60*60*1000)return null;
 try{new Intl.DateTimeFormat('en',{timeZone:q.timezone});}catch{return null;}
 return q;
}
function signature(q:ServiceQuote){return JSON.stringify([q.revision,q.booking_id,q.customer_id,q.provider_id,q.amount,q.currency,q.customer_service_charge,q.scope,q.address,Date.parse(q.starts_at),q.timezone,q.cancellation.version,Date.parse(q.cancellation.full_refund_until),q.cancellation.late_cancellation,q.cancellation.provider_cancellation]);}
export function serviceCheckoutContractMatches(booking:Record<string,unknown>,metadata:Record<string,unknown>,amount:number,now=Date.now()){
 const q=parseServiceQuote(booking.service_quote),saved=parseServiceQuote(metadata.service_quote);
 return Boolean(q&&saved&&q.booking_id===booking.id&&q.customer_id===booking.user_id&&q.provider_id===booking.worker_id
  &&q.revision===booking.service_quote_revision&&q.revision===booking.service_quote_accepted_revision&&q.amount===amount
  &&typeof booking.service_quote_accepted_at==='string'&&Number.isFinite(Date.parse(booking.service_quote_accepted_at))
  &&typeof metadata.service_quote_accepted_at==='string'&&Date.parse(metadata.service_quote_accepted_at)===Date.parse(booking.service_quote_accepted_at)
  &&Date.parse(q.starts_at)>now&&signature(q)===signature(saved));
}
