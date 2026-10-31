import {Children,useCallback,useEffect,useId,useRef,useState,type ReactNode} from 'react';
import {ChevronLeft,ChevronRight} from 'lucide-react';

/** A bounded shelf of existing result cards; no fetching or ranking authority. */
export default function DiscoveryRail({title,children,onSeeAll,headingLevel=2,showTitle=true,itemLabel='listings'}:{title:string;children:ReactNode;onSeeAll?:()=>void;headingLevel?:2|3;showTitle?:boolean;itemLabel?:string}){
 const items=Children.toArray(children),count=items.length,id=useId(),root=useRef<HTMLDivElement>(null);
 const [edges,setEdges]=useState({previous:false,next:false});
 const measure=useCallback(()=>{const node=root.current;if(!node)return;const start=Math.abs(node.scrollLeft),end=node.scrollWidth-node.clientWidth;setEdges(old=>{const next={previous:start>2,next:start<end-2};return old.previous===next.previous&&old.next===next.next?old:next;});},[]);
 useEffect(()=>{const node=root.current;if(!node)return;measure();const observer=new ResizeObserver(measure);observer.observe(node);return()=>observer.disconnect();},[count,measure]);
 const move=(direction:number)=>{const node=root.current;if(!node)return;const rtl=getComputedStyle(node).direction==='rtl';node.scrollBy({left:direction*(rtl?-1:1)*node.clientWidth*.85,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});};
 if(!count)return null;
 const Heading=headingLevel===2?'h2':'h3';
 return <section className="min-w-0 space-y-3" aria-labelledby={id}>
  <header className={`flex flex-wrap items-center gap-3 ${showTitle?'justify-between':'justify-end'}`}><Heading id={id} className={showTitle?'text-lg font-semibold tracking-tight':'sr-only'}>{title}</Heading><div className="flex items-center gap-2">{onSeeAll&&<button type="button" onClick={onSeeAll} aria-label={`See all ${title}`} className="min-h-11 rounded-full px-3 text-sm font-semibold text-[var(--wh-accent-text)] underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2">See all</button>}{(edges.previous||edges.next)&&<div className="hidden items-center gap-2 sm:flex"><button type="button" disabled={!edges.previous} onClick={()=>move(-1)} aria-label={`Scroll ${title} backward`} className="grid h-11 w-11 place-items-center rounded-full border border-[var(--wh-border)] bg-[var(--wh-surface)] disabled:opacity-40"><ChevronLeft size={18} aria-hidden="true" className="rtl:rotate-180"/></button><button type="button" disabled={!edges.next} onClick={()=>move(1)} aria-label={`Scroll ${title} forward`} className="grid h-11 w-11 place-items-center rounded-full border border-[var(--wh-border)] bg-[var(--wh-surface)] disabled:opacity-40"><ChevronRight size={18} aria-hidden="true" className="rtl:rotate-180"/></button></div>}</div></header>
  <div ref={root} role="group" aria-label={`${title} ${itemLabel}`} tabIndex={0} onScroll={measure} onKeyDown={event=>{if(event.target===event.currentTarget&&(event.key==='ArrowLeft'||event.key==='ArrowRight')){event.preventDefault();const direction=event.key==='ArrowRight'?1:-1;move(getComputedStyle(event.currentTarget).direction==='rtl'?-direction:direction);}}} className="grid min-w-0 grid-flow-col auto-cols-[84%] gap-4 overflow-x-auto overscroll-x-contain pb-2 snap-x snap-mandatory [scrollbar-width:thin] sm:auto-cols-[calc(50%_-_8px)] lg:auto-cols-[calc(33.333%_-_11px)] xl:auto-cols-[calc(25%_-_12px)]">
   {items.map((item,index)=><div key={(item as {key?:string}).key??index} className="min-w-0 snap-start [&>*]:h-full">{item}</div>)}
  </div>
 </section>;
}
