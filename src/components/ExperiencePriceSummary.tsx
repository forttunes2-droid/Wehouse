import type {ExperienceContract} from '@/lib/experienceCommerce';
import {formatRecordedMoney} from '@/lib/regional';

export default function ExperiencePriceSummary({contract:q}:{contract:ExperienceContract}){
 if(!q.original_total_minor||!(Number(q.host_discount_minor)+Number(q.wehouse_discount_minor)>0))return null;
 const money=(n:number)=>formatRecordedMoney(n/100,q.currency);
 return <dl aria-label="Activity price breakdown" className="space-y-2 rounded-xl bg-[var(--wh-elevated)] p-4 text-sm">
  <Line label="Standard price" value={money(q.original_total_minor)}/>
  {Number(q.host_discount_minor)>0&&<Line label="Host discount" value={'−'+money(q.host_discount_minor!)}/>}
  {Number(q.wehouse_discount_minor)>0&&<Line label="WeHouse-funded discount" value={'−'+money(q.wehouse_discount_minor!)}/>}
  <Line label="Total price" value={money(q.total_minor)}/>
 </dl>;
}
function Line({label,value}:{label:string;value:string}){return <div className="flex flex-wrap justify-between gap-2"><dt className="text-[var(--wh-text-secondary)]">{label}</dt><dd className="font-medium">{value}</dd></div>;}
