// Synthetic, offline transport for attachment UI only. No production import.
const image='https://assets.wehouse.test/home.svg';
export const control={calls:[] as Array<{name:string;args:any}>,failProperty:(window as any).__attachmentMode==='error',hiddenProperty:false};
export const supabase={rpc:async(name:string,args:any={})=>{
 control.calls.push({name,args});
 if(name==='get_public_listing_detail'){
  if(control.failProperty)return {data:null,error:{message:'Synthetic unavailable transport'}};
  if(control.hiddenProperty||args.p_listing_id==='unavailable-home')return {data:null,error:null};
  return {data:{id:args.p_listing_id,title:'Courtyard Long Let',sub_type:'long_stay',price:100000,city:'Lafia',state:'Nasarawa',images:[image],videos:[],status:'available',bedrooms:2,bathrooms:1},error:null};
 }
 if(name==='get_public_hotel_detail')return {data:{hotel_id:7,name:'Garden Lodge',city:'Lafia',state:'Nasarawa',images:[image],status:'active'},error:null};
 if(name==='get_user_conversations')return {data:[{id:'chat-ada',participant_a:'qa-personal',participant_b:'qa-ada',conversation_type:'roommate',status:'active'},{id:'chat-blocked',participant_a:'qa-personal',participant_b:'qa-blocked',conversation_type:'roommate',status:'active'},{id:'chat-pending',participant_a:'qa-personal',participant_b:'qa-pending',conversation_type:'roommate',status:'pending'}],error:null};
 if(name==='get_my_roommate_peer_details')return {data:[{user_id:'qa-ada',full_name:'Ada Example',username:'ada-example',is_blocked:false},{user_id:'qa-blocked',full_name:'Blocked Example',username:'blocked',is_blocked:true},{user_id:'qa-pending',full_name:'Pending Example',username:'pending',is_blocked:false}],error:null};
 throw new Error('Unexpected attachment API: '+name);
}};
(window as any).__attachmentTransport=control;

export const uploadStorageObjectWithProgress = async () => { throw new Error("Uploads are disabled in this fixture"); };
