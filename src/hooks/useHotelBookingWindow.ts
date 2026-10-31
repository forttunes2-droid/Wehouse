import {useEffect,useMemo,useState} from 'react';
import {hotelBookingWindow} from '@/lib/hotelBookingWindow';

export function useHotelBookingWindow(hotel:{timezone?:string|null;same_day_booking_cutoff?:string|null}|null|undefined){
 const [clock,setClock]=useState(()=>Date.now());
 const timezone=hotel?.timezone,cutoff=hotel?.same_day_booking_cutoff;
 const bounds=useMemo(()=>hotelBookingWindow({timezone,same_day_booking_cutoff:cutoff},new Date(clock)),[timezone,cutoff,clock]);
 useEffect(()=>{
  const refresh=()=>setClock(Date.now());refresh();globalThis.window.addEventListener('focus',refresh);
  return()=>globalThis.window.removeEventListener('focus',refresh);
 },[timezone,cutoff]);
 useEffect(()=>{
  const timer=globalThis.window.setTimeout(()=>setClock(Date.now()),Math.max(25,bounds.nextRefreshAt-Date.now()));
  return()=>globalThis.window.clearTimeout(timer);
 },[bounds.nextRefreshAt]);
 return bounds;
}
