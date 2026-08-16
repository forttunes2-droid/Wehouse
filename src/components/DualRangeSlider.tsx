import { useCallback,useEffect,useRef,useState } from 'react';

interface DualRangeSliderProps{min:number;max:number;floor:number;ceiling:number;step:number;onChange:(min:number,max:number)=>void}
function short(v:number){if(v>=1000000)return `₦${(v/1000000).toFixed(v%1000000?1:0)}M`;if(v>=1000)return `₦${Math.round(v/1000)}k`;return `₦${v}`}
function money(v:number){return `₦${v.toLocaleString()}`}

export default function DualRangeSlider({min,max,floor,ceiling,step,onChange}:DualRangeSliderProps){
  const trackRef=useRef<HTMLDivElement>(null);
  const[dragging,setDragging]=useState<'min'|'max'|null>(null);
  const[editing,setEditing]=useState<'min'|'max'|null>(null);
  const[minDraft,setMinDraft]=useState(String(min));
  const[maxDraft,setMaxDraft]=useState(String(max));
  const safeMin=Math.max(floor,Math.min(min,max-step));
  const safeMax=Math.max(safeMin+step,Math.min(max,ceiling));
  const range=ceiling-floor;
  const minPercent=((safeMin-floor)/range)*100;
  const maxPercent=((safeMax-floor)/range)*100;

  useEffect(()=>{if(editing!=='min')setMinDraft(String(safeMin))},[safeMin,editing]);
  useEffect(()=>{if(editing!=='max')setMaxDraft(String(safeMax))},[safeMax,editing]);

  const fromPosition=useCallback((clientX:number)=>{if(!trackRef.current)return floor;const rect=trackRef.current.getBoundingClientRect();const x=Math.max(0,Math.min(clientX-rect.left,rect.width));const raw=floor+(x/rect.width)*range;return Math.round(raw/step)*step},[floor,range,step]);
  const move=useCallback((clientX:number)=>{if(!dragging)return;const val=fromPosition(clientX);if(dragging==='min')onChange(Math.max(floor,Math.min(val,safeMax-step)),safeMax);else onChange(safeMin,Math.max(safeMin+step,Math.min(val,ceiling)))},[dragging,fromPosition,onChange,floor,ceiling,step,safeMin,safeMax]);
  useEffect(()=>{if(!dragging)return;const mouse=(e:MouseEvent)=>move(e.clientX),up=()=>setDragging(null),touch=(e:TouchEvent)=>{if(e.touches[0])move(e.touches[0].clientX)};window.addEventListener('mousemove',mouse);window.addEventListener('mouseup',up);window.addEventListener('touchmove',touch,{passive:true});window.addEventListener('touchend',up);return()=>{window.removeEventListener('mousemove',mouse);window.removeEventListener('mouseup',up);window.removeEventListener('touchmove',touch);window.removeEventListener('touchend',up)}},[dragging,move]);

  function track(e:React.MouseEvent<HTMLDivElement>){const val=fromPosition(e.clientX);if(Math.abs(val-safeMin)<Math.abs(val-safeMax))onChange(Math.max(floor,Math.min(val,safeMax-step)),safeMax);else onChange(safeMin,Math.max(safeMin+step,Math.min(val,ceiling)))}
  function digits(value:string){return value.replace(/[^0-9]/g,'')}
  function live(which:'min'|'max',raw:string){const nextDraft=digits(raw);if(which==='min')setMinDraft(nextDraft);else setMaxDraft(nextDraft);if(!nextDraft)return;const parsed=Number(nextDraft);if(!Number.isFinite(parsed))return;if(which==='min'){if(parsed>=floor&&parsed<=safeMax-step)onChange(parsed,safeMax)}else if(parsed>=safeMin+step&&parsed<=ceiling){onChange(safeMin,parsed)}}
  function commit(which:'min'|'max'){if(which==='min'){const parsed=Number(minDraft),wanted=Number.isFinite(parsed)&&minDraft!==''?parsed:safeMin,snapped=Math.round(wanted/step)*step,next=Math.max(floor,Math.min(snapped,safeMax-step));onChange(next,safeMax);setMinDraft(String(next))}else{const parsed=Number(maxDraft),wanted=Number.isFinite(parsed)&&maxDraft!==''?parsed:safeMax,snapped=Math.round(wanted/step)*step,next=Math.min(ceiling,Math.max(snapped,safeMin+step));onChange(safeMin,next);setMaxDraft(String(next))}setEditing(null)}

  return <div className="w-full select-none rounded-2xl border border-white/[.06] bg-black/10 p-3.5">
    <div className="flex items-center justify-between gap-3"><div><p className="text-[8px] uppercase tracking-wider text-[#666C7C]">Minimum</p><p className="mt-1 text-sm font-bold text-violet-300">{money(safeMin)}</p></div><div className="h-px flex-1 bg-white/[.06]"/><div className="text-right"><p className="text-[8px] uppercase tracking-wider text-[#666C7C]">Maximum</p><p className="mt-1 text-sm font-bold text-violet-300">{money(safeMax)}</p></div></div>
    <div ref={trackRef} onClick={track} className="relative mt-2 flex h-11 touch-none cursor-pointer items-center"><div className="absolute inset-x-0 h-1.5 rounded-full bg-[#242733]"/><div className="absolute h-1.5 rounded-full bg-gradient-to-r from-violet-500 to-purple-400" style={{left:`${minPercent}%`,width:`${maxPercent-minPercent}%`}}/><Handle percent={minPercent} active={dragging==='min'} onMouse={(e)=>{e.stopPropagation();setDragging('min')}} onTouch={(e)=>{e.stopPropagation();setDragging('min')}}/><Handle percent={maxPercent} active={dragging==='max'} onMouse={(e)=>{e.stopPropagation();setDragging('max')}} onTouch={(e)=>{e.stopPropagation();setDragging('max')}}/></div>
    <div className="flex justify-between text-[8px] text-[#5C6272]"><span>{short(floor)}</span><span>{short(ceiling)}</span></div>
    <div className="mt-3 grid grid-cols-2 gap-3"><BudgetInput label="Minimum" value={minDraft} onFocus={()=>setEditing('min')} onChange={v=>live('min',v)} onBlur={()=>commit('min')}/><BudgetInput label="Maximum" value={maxDraft} onFocus={()=>setEditing('max')} onChange={v=>live('max',v)} onBlur={()=>commit('max')}/></div>
  </div>
}
function Handle({percent,active,onMouse,onTouch}:{percent:number;active:boolean;onMouse:(e:React.MouseEvent)=>void;onTouch:(e:React.TouchEvent)=>void}){return <div onMouseDown={onMouse} onTouchStart={onTouch} className={`absolute z-10 h-6 w-6 cursor-grab rounded-full border-[3px] border-[#0A0A0F] bg-violet-500 shadow-lg shadow-violet-500/25 ${active?'scale-110 ring-2 ring-violet-400/25':''}`} style={{left:`${percent}%`,transform:'translateX(-50%)'}}/>}
function BudgetInput({label,value,onFocus,onChange,onBlur}:{label:string;value:string;onFocus:()=>void;onChange:(v:string)=>void;onBlur:()=>void}){return <label className="block"><span className="mb-1 block text-[8px] text-[#6C7080]">{label}</span><div className="flex h-11 items-center rounded-xl border border-white/[.08] bg-[#171923] px-3 focus-within:border-violet-500/45"><span className="mr-1 text-xs text-[#777B8C]">₦</span><input inputMode="numeric" value={value} onFocus={onFocus} onChange={e=>onChange(e.target.value)} onBlur={onBlur} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur()}} className="min-w-0 flex-1 bg-transparent text-xs text-white outline-none"/></div></label>}
