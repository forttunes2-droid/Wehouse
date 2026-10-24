/** Saved policy keys are accepted only when their cancellation deadline agrees. */
export function shortLetRefundHours(policy:Record<string,unknown>):number|null{
 const primary=policy.standard_full_refund_hours_before_check_in;
 const previous=policy.full_refund_hours_before_check_in;
 const parse=(value:unknown)=>typeof value==='number'||typeof value==='string'&&value.trim()!==''?Number(value):NaN;
 const hours=primary==null?(previous==null?24:parse(previous)):parse(primary);
 if(!Number.isInteger(hours)||hours<0||hours>168)return null;
 if(primary!=null&&previous!=null&&parse(previous)!==hours)return null;
 return hours;
}
