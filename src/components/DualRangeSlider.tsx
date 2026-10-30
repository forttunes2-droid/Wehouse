import {useCallback,useEffect,useRef,useState,type KeyboardEvent,type PointerEvent} from 'react';
import {formatMoney,currencySymbol} from '@/lib/regional';

export type PriceRangeMode={minimumOpen:boolean;maximumOpen:boolean};
interface Props{
 min:number;max:number;floor:number;ceiling:number;step:number;
 onChange:(min:number,max:number,mode?:PriceRangeMode)=>void;
 minimumOpen?:boolean;maximumOpen?:boolean;maxCustomPrice?:number;
}
function short(v:number){if(v>=1000000)return formatMoney((v/1000000).toFixed(v%1000000?1:0))+'M';if(v>=1000)return formatMoney(Math.round(v/1000))+'k';return formatMoney(v);}

export default function DualRangeSlider({min,max,floor,ceiling,step,onChange,minimumOpen=false,maximumOpen=false,maxCustomPrice}:Props){
 const trackRef=useRef<HTMLDivElement>(null);
 const [dragging,setDragging]=useState<'min'|'max'|null>(null),[editing,setEditing]=useState<'min'|'max'|null>(null);
 const [minDraft,setMinDraft]=useState(minimumOpen?'':String(min)),[maxDraft,setMaxDraft]=useState(maximumOpen?'':String(max));
 const safeMin=Math.max(floor,Math.min(min,max-step)),safeMax=Math.max(safeMin+step,Math.min(max,ceiling));
 const range=ceiling-floor,minPercent=((safeMin-floor)/range)*100,maxPercent=((safeMax-floor)/range)*100;
 const entryLimit=maxCustomPrice??ceiling;
 useEffect(()=>{if(editing!=='min')setMinDraft(minimumOpen?'':String(safeMin));},[safeMin,editing,minimumOpen]);
 useEffect(()=>{if(editing!=='max')setMaxDraft(maximumOpen?'':String(safeMax));},[safeMax,editing,maximumOpen]);
 const fromPosition=useCallback((clientX:number)=>{
  const rect=trackRef.current?.getBoundingClientRect();if(!rect?.width)return floor;
  const x=Math.max(0,Math.min(clientX-rect.left,rect.width));return Math.round((floor+x/rect.width*range)/step)*step;
 },[floor,range,step]);
 const move=useCallback((clientX:number)=>{
  if(!dragging)return;const value=fromPosition(clientX);
  if(dragging==='min')onChange(Math.max(floor,Math.min(value,safeMax-step)),safeMax);
  else onChange(safeMin,Math.max(safeMin+step,Math.min(value,ceiling)));
 },[dragging,fromPosition,onChange,floor,ceiling,step,safeMin,safeMax]);
 useEffect(()=>{
  if(!dragging)return;
  const pointer=(event:globalThis.PointerEvent)=>{event.preventDefault();move(event.clientX);},up=()=>setDragging(null);
  window.addEventListener('pointermove',pointer,{passive:false});window.addEventListener('pointerup',up);window.addEventListener('pointercancel',up);
  return()=>{window.removeEventListener('pointermove',pointer);window.removeEventListener('pointerup',up);window.removeEventListener('pointercancel',up);};
 },[dragging,move]);
 function track(event:PointerEvent<HTMLDivElement>){
  const value=fromPosition(event.clientX),which=Math.abs(value-safeMin)<Math.abs(value-safeMax)?'min':'max';setDragging(which);
  if(which==='min')onChange(Math.max(floor,Math.min(value,safeMax-step)),safeMax);
  else onChange(safeMin,Math.max(safeMin+step,Math.min(value,ceiling)));
 }
 function live(which:'min'|'max',raw:string){
  const draft=raw.replace(/[^0-9]/g,'');if(which==='min')setMinDraft(draft);else setMaxDraft(draft);
  if(!draft)return;const value=Number(draft);if(!Number.isSafeInteger(value)||value<0||value>entryLimit)return;
  if(which==='min'){
   const lower=maxCustomPrice===undefined?floor:0,upper=maximumOpen&&maxCustomPrice!==undefined?entryLimit-step:safeMax-step;
   if(value>=lower&&value<=upper)onChange(value,Math.max(safeMax,value+step),{minimumOpen:false,maximumOpen});
  }else if(value>=safeMin+step)onChange(safeMin,value,{minimumOpen,maximumOpen:false});
 }
 function commit(which:'min'|'max'){
  const draft=which==='min'?minDraft:maxDraft;
  if(maxCustomPrice!==undefined&&draft===''){
   onChange(which==='min'?floor:safeMin,which==='max'?ceiling:safeMax,{minimumOpen:which==='min'?true:minimumOpen,maximumOpen:which==='max'?true:maximumOpen});
  }else if(which==='min'){
   const raw=Number(draft),wanted=Number.isFinite(raw)&&draft!==''?raw:safeMin;
   const lower=maxCustomPrice===undefined?floor:0,upper=maximumOpen&&maxCustomPrice!==undefined?entryLimit-step:safeMax-step;
   const value=Math.max(lower,Math.min(Math.round(wanted/step)*step,upper));
   onChange(value,Math.max(safeMax,value+step),{minimumOpen:false,maximumOpen});setMinDraft(String(value));
  }else{
   const raw=Number(draft),wanted=Number.isFinite(raw)&&draft!==''?raw:safeMax;
   const value=Math.min(entryLimit,Math.max(Math.round(wanted/step)*step,safeMin+step));
   onChange(safeMin,value,{minimumOpen,maximumOpen:false});setMaxDraft(String(value));
  }
  setEditing(null);
 }
 return <div className="w-full select-none">
  <div className="grid grid-cols-2 gap-2">
   <ValueBox label="From" value={minDraft} placeholder={maxCustomPrice===undefined?undefined:'No minimum'} active={editing==='min'} onFocus={()=>setEditing('min')} onChange={value=>live('min',value)} onBlur={()=>commit('min')}/>
   <ValueBox label="To" value={maxDraft} placeholder={maxCustomPrice===undefined?undefined:'No maximum'} active={editing==='max'} onFocus={()=>setEditing('max')} onChange={value=>live('max',value)} onBlur={()=>commit('max')}/>
  </div>
  <div className="relative mt-1.5 h-14 touch-none select-none"><div ref={trackRef} onPointerDown={track} className="absolute inset-x-6 inset-y-0 cursor-pointer touch-none">
   <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-[var(--wh-interactive)]"/>
   <div className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-violet-500" style={{left:minPercent+'%',width:(maxPercent-minPercent)+'%'}}/>
   <Handle label="Minimum price" value={safeMin} valueText={minimumOpen?'No minimum':undefined} lower={floor} upper={safeMax-step} step={step} onChange={value=>onChange(value,safeMax)} percent={minPercent} active={dragging==='min'} onPointer={event=>{event.preventDefault();event.stopPropagation();setDragging('min');}}/>
   <Handle label="Maximum price" value={safeMax} valueText={maximumOpen?'No maximum':undefined} lower={safeMin+step} upper={ceiling} step={step} onChange={value=>onChange(safeMin,value)} percent={maxPercent} active={dragging==='max'} onPointer={event=>{event.preventDefault();event.stopPropagation();setDragging('max');}}/>
  </div></div>
  <div className="flex justify-between px-0.5 text-xs text-[var(--wh-text-muted)]"><span>{short(floor)}</span><span>{short(ceiling)}{maxCustomPrice!==undefined?'+':''}</span></div>
 </div>;
}
function Handle({label,value,valueText,lower,upper,step,onChange,percent,active,onPointer}:{label:string;value:number;valueText?:string;lower:number;upper:number;step:number;onChange:(value:number)=>void;percent:number;active:boolean;onPointer:(event:PointerEvent)=>void}){
 function key(event:KeyboardEvent<HTMLButtonElement>){
  let next=value;
  if(event.key==='ArrowRight'||event.key==='ArrowUp')next+=step;else if(event.key==='ArrowLeft'||event.key==='ArrowDown')next-=step;
  else if(event.key==='PageUp')next+=step*10;else if(event.key==='PageDown')next-=step*10;else if(event.key==='Home')next=lower;else if(event.key==='End')next=upper;else return;
  event.preventDefault();onChange(Math.max(lower,Math.min(next,upper)));
 }
 return <button type="button" role="slider" aria-label={label} aria-orientation="horizontal" aria-valuemin={lower} aria-valuemax={upper} aria-valuenow={value} aria-valuetext={valueText||currencySymbol()+formatMoney(value)} onKeyDown={key} onPointerDown={onPointer} className="absolute top-1/2 z-10 grid h-12 w-12 -translate-x-1/2 -translate-y-1/2 touch-none cursor-grab place-items-center rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--wh-accent-text)]" style={{left:percent+'%'}}><span className={'block h-6 w-6 rounded-full border-[3px] border-[var(--wh-surface)] bg-violet-500 shadow-md motion-safe:transition '+(active?'scale-110 ring-4 ring-violet-400/20':'')}/></button>;
}
function ValueBox({label,value,placeholder,active,onFocus,onChange,onBlur}:{label:string;value:string;placeholder?:string;active:boolean;onFocus:()=>void;onChange:(value:string)=>void;onBlur:()=>void}){
 return <label className={'flex min-h-16 min-w-0 flex-col justify-center gap-1 rounded-xl border px-3 py-2 '+(active?'border-violet-500/50 bg-[var(--wh-accent-surface)]':'border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)]')}>
  <span className="text-xs font-medium text-[var(--wh-text-muted)]">{label}</span><span className="flex min-w-0 items-center gap-1"><span className="text-xs text-[var(--wh-text-muted)]">{currencySymbol()}</span><input aria-label={label==='From'?'Minimum price amount':'Maximum price amount'} inputMode="numeric" value={value} placeholder={placeholder} onFocus={onFocus} onChange={event=>onChange(event.target.value)} onBlur={onBlur} onKeyDown={event=>{if(event.key==='Enter')event.currentTarget.blur();}} className="min-w-0 flex-1 bg-transparent text-right text-sm font-semibold text-[var(--wh-text)] outline-none placeholder:text-xs placeholder:font-normal placeholder:text-[var(--wh-text-secondary)]"/></span>
 </label>;
}
