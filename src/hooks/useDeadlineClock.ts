import {useEffect,useState} from 'react';

/** Update at meaningful boundaries and on return to the app, without polling. */
export function useDeadlineClock(deadlines:ReadonlyArray<string|null|undefined>){
 const [clock,setClock]=useState(()=>Date.now());
 const key=deadlines.filter(Boolean).join('|');
 useEffect(()=>{const update=()=>setClock(Date.now());window.addEventListener('focus',update);return()=>window.removeEventListener('focus',update);},[]);
 useEffect(()=>{
  const next=Math.min(...key.split('|').map(value=>Date.parse(value)).filter(at=>Number.isFinite(at)&&at>clock));
  if(!Number.isFinite(next))return;
  const timer=window.setTimeout(()=>setClock(Date.now()),Math.max(25,Math.min(2147483647,next-Date.now()+25)));
  return()=>window.clearTimeout(timer);
 },[key,clock]);
 return clock;
}
