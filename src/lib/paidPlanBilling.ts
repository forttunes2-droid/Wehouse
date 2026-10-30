import {supabase} from '@/lib/supabase/client';
import {withTimeout} from '@/lib/withTimeout';
import {paystackSubscriptionDestination} from '../../supabase/functions/_shared/payment-checkout';
export type PaidPlanBilling={kind:'worker'|'property_partner';name:string;status:string;provider:'paystack'|'apple'|'google'|'prepaid';period_end:string|null;billing_period:'monthly'|'yearly'|null;price:number|null;currency:string|null;auto_renews:boolean;cancel_at_period_end:boolean;last_verified_at:string|null;can_manage:boolean;workspace_access:boolean};
export function paidPlanBilling(value:unknown,person:string):PaidPlanBilling[]{
 const r=value as {user_id?:string;plans?:PaidPlanBilling[]}|null;
 if(r?.user_id!==person||!Array.isArray(r.plans)||r.plans.length>2||new Set(r.plans.map(p=>p?.kind)).size!==r.plans.length)throw Error('Billing records could not be confirmed.');
 for(const p of r.plans){
  if(!p||!['worker','property_partner'].includes(p.kind)||typeof p.name!=='string'||p.name.length>300||!['pending','active','grace_period','paused','cancelled','expired','revoked','under_review'].includes(p.status)||!['paystack','apple','google','prepaid'].includes(p.provider)||['auto_renews','cancel_at_period_end','can_manage','workspace_access'].some(k=>typeof p[k as keyof PaidPlanBilling]!=='boolean')||[p.period_end,p.last_verified_at].some(date=>date!==null&&(typeof date!=='string'||!Number.isFinite(Date.parse(date))))||(p.price!==null&&(typeof p.price!=='number'||!Number.isFinite(p.price)||p.price<0))||(p.currency!==null&&!/^[A-Z]{3}$/.test(p.currency))||(p.billing_period!==null&&!['monthly','yearly'].includes(p.billing_period))||(p.kind==='property_partner'&&(p.provider!=='prepaid'||p.auto_renews||p.can_manage)))throw Error('Billing records could not be confirmed.');
 }
 return r.plans;
}
export async function getPaidPlanBilling(person:string){const {data,error}=await withTimeout(supabase.rpc('get_my_paid_plan_billing'),15000,'Billing records took too long to load.');if(error)throw error;return paidPlanBilling(data,person);}
/** A management link is ephemeral and never stored in browser storage or logs. */
export async function openWorkSubscriptionManagement(provider:'paystack'|'apple'|'google'){
 if(provider==='apple')return 'https://apps.apple.com/account/subscriptions';
 if(provider==='google')return 'https://play.google.com/store/account/subscriptions';
 const {data,error}=await withTimeout(supabase.functions.invoke('worker-pro-manage'),20000,'Subscription management took too long. Retry from Billing & subscriptions.');
 if(error){let message='Subscription management could not open. Retry or ask WeHouse for billing help.';try{const body=await error.context?.clone?.().json();if(typeof body?.error==='string'&&body.error.length<=2000)message=body.error;}catch{/* No private provider URL is logged. */}throw Error(message);}
 const url=paystackSubscriptionDestination(data?.url);if(data?.success!==true||!url)throw Error('Subscription management could not be confirmed. Retry or ask WeHouse for billing help.');return url;
}
