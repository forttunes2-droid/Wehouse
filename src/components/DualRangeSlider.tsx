import { useCallback,useEffect,useRef,useState } from 'react';
import { formatMoney, currencySymbol } from "@/lib/regional";

interface DualRangeSliderProps{min:number;max:number;floor:number;ceiling:number;step:number;onChange:(min:number,max:number)=>void}
function short(v:number){if(v>=1000000)return `${formatMoney((v/1000000).toFixed(v%1000000?1:0))}M`;if(v>=1000)return `${formatMoney(Math.round(v/1000))}k`;return `${formatMoney(v)}`}

export default function DualRangeSlider({min,max,floor,ceiling,step,onChange}:DualRangeSliderProps){
 const trackRef=useRef<HTMLDivElement>(null);const[dragging,setDragging]=useState<'min'|'max'|null>(null),[editing,setEditing]=useState<'min'|'max'|null>(null),[minDraft,setMinDraft]=useState(String(min)),[maxDraft,setMaxDraft]=useState(String(max));
 const safeMin=Math.max(floor,Math.min(min,max-step)),safeMax=Math.max(safeMin+step,Math.min(max,ceiling)),range=ceiling-floor,minPercent=((safeMin-floor)/range)*100,maxPercent=((safeMax-floor)/range)*100;
 useEffect(()=>{if(editing!=='min')setMinDraft(String(safeMin))},[safeMin,editing]);useEffect(()=>{if(editing!=='max')setMaxDraft(String(safeMax))},[safeMax,editing]);
 const fromPosition=useCallback((clientX:number)=>{if(!trackRef.current)return floor;const rect=trackRef.current.getBoundingClientRect(),x=Math.max(0,Math.min(clientX-rect.left,rect.width)),raw=floor+(x/rect.width)*range;return Math.round(raw/step)*step},[floor,range,step]);
 const move=useCallback((clientX:number)=>{if(!dragging)return;const val=fromPosition(clientX);if(dragging==='min')onChange(Math.max(floor,Math.min(val,safeMax-step)),safeMax);else onChange(safeMin,Math.max(safeMin+step,Math.min(val,ceiling)))},[dragging,fromPosition,onChange,floor,ceiling,step,safeMin,safeMax]);
 useEffect(()=>{if(!dragging)return;const pointer=(e:PointerEvent)=>{e.preventDefault();move(e.clientX)},up=()=>setDragging(null);window.addEventListener('pointermove',pointer,{passive:false});window.addEventListener('pointerup',up);window.addEventListener('pointercancel',up);return()=>{window.removeEventListener('pointermove',pointer);window.removeEventListener('pointerup',up);window.removeEventListener('pointercancel',up)}},[dragging,move]);
 function track(e:React.PointerEvent<HTMLDivElement>){const val=fromPosition(e.clientX);const next=Math.abs(val-safeMin)<Math.abs(val-safeMax)?'min':'max';setDragging(next);if(next==='min')onChange(Math.max(floor,Math.min(val,safeMax-step)),safeMax);else onChange(safeMin,Math.max(safeMin+step,Math.min(val,ceiling)))}
 function digits(value:string){return value.replace(/[^0-9]/g,'')}
 function live(which:'min'|'max',raw:string){const draft=digits(raw);if(which==='min')setMinDraft(draft);else setMaxDraft(draft);if(!draft)return;const parsed=Number(draft);if(which==='min'&&parsed>=floor&&parsed<=safeMax-step)onChange(parsed,safeMax);if(which==='max'&&parsed>=safeMin+step&&parsed<=ceiling)onChange(safeMin,parsed)}
 function commit(which:'min'|'max'){if(which==='min'){const parsed=Number(minDraft),wanted=Number.isFinite(parsed)&&minDraft!==''?parsed:safeMin,next=Math.max(floor,Math.min(Math.round(wanted/step)*step,safeMax-step));onChange(next,safeMax);setMinDraft(String(next))}else{const parsed=Number(maxDraft),wanted=Number.isFinite(parsed)&&maxDraft!==''?parsed:safeMax,next=Math.min(ceiling,Math.max(Math.round(wanted/step)*step,safeMin+step));onChange(safeMin,next);setMaxDraft(String(next))}setEditing(null)}
 return <div className="w-full select-none">
  <div className="grid grid-cols-2 gap-2"><ValueBox label="From" value={minDraft} active={editing==='min'} onFocus={()=>setEditing('min')} onChange={v=>live('min',v)} onBlur={()=>commit('min')}/><ValueBox label="To" value={maxDraft} active={editing==='max'} onFocus={()=>setEditing('max')} onChange={v=>live('max',v)} onBlur={()=>commit('max')}/></div>
  <div className="relative mt-1.5 h-14 touch-none select-none">
   <div ref={trackRef} onPointerDown={track} className="absolute inset-x-6 inset-y-0 cursor-pointer touch-none">
    <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-[var(--wh-interactive)]"/>
    <div className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-violet-500" style={{left:`${minPercent}%`,width:`${maxPercent-minPercent}%`}}/>
    <Handle label="Minimum price" value={safeMin} lower={floor} upper={safeMax-step} step={step} onChange={value=>onChange(value,safeMax)} percent={minPercent} active={dragging==='min'} onPointer={e=>{e.preventDefault();e.stopPropagation();setDragging('min')}}/>
    <Handle label="Maximum price" value={safeMax} lower={safeMin+step} upper={ceiling} step={step} onChange={value=>onChange(safeMin,value)} percent={maxPercent} active={dragging==='max'} onPointer={e=>{e.preventDefault();e.stopPropagation();setDragging('max')}}/>
   </div>
  </div>
  <div className="flex justify-between px-0.5 text-[7px] font-medium text-[var(--wh-text-muted)]"><span>{short(floor)}</span><span>{short(ceiling)}</span></div>
 </div>
}
function Handle({label,value,lower,upper,step,onChange,percent,active,onPointer}:{label:string;value:number;lower:number;upper:number;step:number;onChange:(value:number)=>void;percent:number;active:boolean;onPointer:(e:React.PointerEvent)=>void}){
 function key(event:React.KeyboardEvent<HTMLButtonElement>){
  let next=value;
  if(event.key==='ArrowRight'||event.key==='ArrowUp')next+=step;
  else if(event.key==='ArrowLeft'||event.key==='ArrowDown')next-=step;
  else if(event.key==='PageUp')next+=step*10;
  else if(event.key==='PageDown')next-=step*10;
  else if(event.key==='Home')next=lower;
  else if(event.key==='End')next=upper;
  else return;
  event.preventDefault();onChange(Math.max(lower,Math.min(next,upper)));
 }
 return <button type="button" role="slider" aria-label={label} aria-orientation="horizontal" aria-valuemin={lower} aria-valuemax={upper} aria-valuenow={value} aria-valuetext={`${currencySymbol()}${formatMoney(value)}`} onKeyDown={key} onPointerDown={onPointer} className="absolute top-1/2 z-10 grid h-12 w-12 -translate-x-1/2 -translate-y-1/2 touch-none cursor-grab place-items-center rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--wh-accent-text)]" style={{left:`${percent}%`}}><span className={`block h-6 w-6 rounded-full border-[3px] border-[var(--wh-surface)] bg-violet-500 shadow-md motion-safe:transition ${active?'scale-110 ring-4 ring-violet-400/20':''}`}/></button>;
}
function ValueBox({label,value,active,onFocus,onChange,onBlur}:{label:string;value:string;active:boolean;onFocus:()=>void;onChange:(v:string)=>void;onBlur:()=>void}){return <label className={`flex h-10 items-center gap-2 rounded-xl border px-3 ${active?'border-violet-500/35 bg-violet-500/[.055]':'border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)]'}`}><span className="shrink-0 text-[8px] font-medium text-[var(--wh-text-muted)]">{label}</span><span className="text-[10px] text-[var(--wh-text-muted)]">{currencySymbol()}</span><input inputMode="numeric" value={value} onFocus={onFocus} onChange={e=>onChange(e.target.value)} onBlur={onBlur} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur()}} className="min-w-0 flex-1 bg-transparent text-right text-[11px] font-semibold text-[var(--wh-text)] outline-none"/></label>}
