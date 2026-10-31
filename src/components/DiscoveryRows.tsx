import {Children, type ReactNode} from 'react';
import DiscoveryRail from '@/components/DiscoveryRail';

/** Presentation only: preserve the loaded page's order and stable item keys. */
export default function DiscoveryRows({title,children,headingLevel=2,hideFirstTitle=false,itemLabel='listings',onSeeAll}:{
  title:string;children:ReactNode;headingLevel?:2|3;hideFirstTitle?:boolean;itemLabel?:string;onSeeAll?:()=>void;
}) {
  const cards=Children.toArray(children);
  const rows:ReactNode[][]=[];
  for(let offset=0;offset<cards.length;offset+=8) rows.push(cards.slice(offset,offset+8));
  return <div className="min-w-0 space-y-8" data-discovery-rows>{rows.map((row,index)=><DiscoveryRail
    key={(row[0] as {key?:string}).key??index} title={index===0?title:`${title}, row ${index+1}`}
    headingLevel={headingLevel} showTitle={index===0&&!hideFirstTitle} itemLabel={itemLabel}
    onSeeAll={index===0?onSeeAll:undefined}
  >{row}</DiscoveryRail>)}</div>;
}
