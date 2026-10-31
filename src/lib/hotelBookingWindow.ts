import {dateInZone,propertyTimeZone,zonedInputToISO} from './regional';
import {hotelCalendarDay} from './hotelCheckout';

type Policy={timezone?:string|null;same_day_booking_cutoff?:string|null};
/** This is presentation. The canonical Hotel quote/hold validates its own clock. */
export function hotelBookingWindow(hotel:Policy|null|undefined,now=new Date()){
 const timeZone=propertyTimeZone(hotel?.timezone),today=dateInZone(timeZone,now);
 const cutoff=/^(\d{2}):(\d{2})(?::00)?$/.exec(hotel?.same_day_booking_cutoff||'');
 const cutoffTime=cutoff&&Number(cutoff[1])<24&&Number(cutoff[2])<60?`${cutoff[1]}:${cutoff[2]}`:null;
 const cutoffAt=cutoffTime?zonedInputToISO(`${today}T${cutoffTime}`,timeZone):null;
 const cutoffLabel=cutoffAt?new Date(cutoffAt).toLocaleTimeString(undefined,{timeZone,hour:'numeric',minute:'2-digit'}):'';
 const sameDayOpen=Boolean(cutoffAt&&now.getTime()<Date.parse(cutoffAt));
 const tomorrow=hotelCalendarDay(today),midnight=Date.parse(zonedInputToISO(`${tomorrow}T00:00`,timeZone));
 return{today,timeZone,cutoffTime,cutoffAt,cutoffLabel,sameDayOpen,earliest:sameDayOpen?today:tomorrow,lastCheckIn:hotelCalendarDay(today,365),latest:hotelCalendarDay(today,366),
  nextRefreshAt:Math.min(midnight,sameDayOpen?Date.parse(cutoffAt!):Infinity)+25};
}
