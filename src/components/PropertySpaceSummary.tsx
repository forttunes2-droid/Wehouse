type SpaceRecord={space_scope?:string|null;space_label?:string|null;shared_areas?:string[]|null};
export default function PropertySpaceSummary({record,compact=false}:{record:SpaceRecord;compact?:boolean}){
 if(!record.space_scope)return null;
 const label=record.space_scope==='private_room'?'Private room':record.space_scope==='entire_unit'?'Entire home':null;
 if(!label)return <p className="text-xs text-[var(--wh-text-secondary)]">Bookable space details are unavailable.</p>;
 if(compact)return <p className="mt-1 break-words text-xs text-[var(--wh-text-secondary)]">{label}{record.space_label?` · ${record.space_label}`:''}</p>;
 return <section aria-label="Bookable space" className="mt-4 rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-4 text-[var(--wh-text)]">
  <p className="text-xs font-medium text-[var(--wh-text-secondary)]">Bookable space</p>
  <p className="mt-1 break-words text-sm font-semibold">{label}{record.space_label?` · ${record.space_label}`:''}</p>
  {record.space_scope==='private_room'&&<p className="mt-2 break-words text-xs leading-5 text-[var(--wh-text-secondary)]">{record.shared_areas?.length?`Shared areas: ${record.shared_areas.join(', ')}`:'Shared areas need confirmation before publication.'}</p>}
 </section>;
}
