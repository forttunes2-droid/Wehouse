import SharedStayInvite from '@/components/SharedStayInvite';
import {createSharedHotel,type SharedHousingGroup} from '@/lib/supabase/shared-housing';
import type {HotelHold} from '@/lib/hotelCheckout';

export default function HotelBookingShares({booking,userId,onCreated}:{booking:HotelHold;userId:string;onCreated:(group:SharedHousingGroup)=>void}){
 if(booking.status!=='pending'||booking.payment_status!=='unpaid'||booking.shared_payment_group_id||booking.guest_count<2)return null;
 return <SharedStayInvite key={`${userId}:${booking.booking_id}`} bookingKey={`hotel:${booking.booking_id}`} userId={userId} kind="Hotel"
  guests={booking.guest_count} rent={booking.total_price}
  description="Invite Friends joining this room booking before starting a payment. Everyone gets the same saved room, dates and cancellation terms. The organiser manages changes and cancellation of the whole stay."
  onInvite={async friendIds=>{const result=await createSharedHotel(booking.booking_id,friendIds);
   if(result.error)throw result.error;if(!result.group||result.group.hotel_booking_id!==booking.booking_id)throw Error('The shared Hotel booking could not be confirmed. Refresh this hold.');
   onCreated(result.group);
  }}/>;
}
