/** Original supplied V4 vectors; theme switching does not redraw the artwork. */
export default function BrandIdentity({className='h-12 w-[161px]',mark=false}:{className?:string;mark?:boolean}) {
 return <span role="img" aria-label="WeHouse" className={`inline-flex shrink-0 items-center ${className}`}>
  <img alt="" aria-hidden="true" src={`/brand/v4/${mark?'micro-purple.svg':'wehouse-lockup-light.svg'}`} className="wh-brand-on-light h-full w-full object-contain"/>
  <img alt="" aria-hidden="true" src={`/brand/v4/${mark?'micro-purple-white.svg':'wehouse-lockup-dark.svg'}`} className="wh-brand-on-dark h-full w-full object-contain"/>
 </span>;
}
