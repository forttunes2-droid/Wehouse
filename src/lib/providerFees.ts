import {supabase} from '@/lib/supabase/client';
import {withTimeout} from '@/lib/withTimeout';
export type ProviderFeeProduct='short_let'|'long_stay'|'hotel'|'service'|'experience';
export type ProviderFeeDisclosure={available:true;product:ProviderFeeProduct;management_mode:'host'|'wehouse';base_policy_version_id:string;policy_version_id:string;base_percent:number;management_percent:number;total_percent:number;deducted_from:'provider_earnings';basis:string;digest:string};
export function providerFeeReceipt(value:unknown,product:ProviderFeeProduct,mode:'host'|'wehouse'):ProviderFeeDisclosure|null{
 const r=value as ProviderFeeDisclosure|{available:false;product:string;management_mode:string};
 if(!r||r.product!==product||r.management_mode!==mode)throw Error('The fee disclosure could not be confirmed.');
 if(r.available===false)return null;
 if(r.available!==true||r.basis!==(product==='long_stay'?'eligible_rent':['short_let','hotel'].includes(product)?'accommodation_value':'agreed_booking_value')||r.deducted_from!=='provider_earnings'||![r.base_percent,r.management_percent,r.total_percent].every(n=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=50)
  ||Math.abs(r.total_percent-r.base_percent-r.management_percent)>0.000001
  ||mode==='host'&&r.management_percent!==0||typeof r.digest!=='string'||!/^[a-f\d]{64}$/.test(r.digest)
  ||![r.base_policy_version_id,r.policy_version_id].every(id=>typeof id==='string'&&/^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(id)))throw Error('The actual commission rates could not be confirmed.');
 return r;
}
export async function getProviderFees(product:ProviderFeeProduct,mode:'host'|'wehouse'){
 const {data,error}=await withTimeout(supabase.rpc('get_provider_fee_disclosure',{p_product:product,p_management_mode:mode}),15000,'The current fees took too long to load.');
 if(error)throw error;return providerFeeReceipt(data,product,mode);
}
