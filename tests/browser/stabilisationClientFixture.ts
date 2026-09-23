// Deterministic network boundary. Production components and API wrappers are real.
// No production endpoint or credential is imported into this harness.
const w=window as any;
const owner='qa-owner', guest='qa-bola';
export const control={calls:[] as Array<{name:string;args:any}>,elevations:[] as string[],denied:false,
 enabled:false,approved:true,paused:false,allAccepted:false,actor:w.__practicalMode==='shared-guest'?guest:owner};
const members=()=>[{user_id:owner,name:'Ada Example',invitation_status:'accepted',payment_status:'unpaid',share_amount:500,eligible_partner_share:333.34,refundable_share:166.66},
{user_id:guest,name:'Bola Example',invitation_status:w.__accepted?'accepted':'invited',payment_status:'unpaid',share_amount:500,eligible_partner_share:333.33,refundable_share:166.67},
{user_id:'qa-chika',name:'Chika Example',invitation_status:control.allAccepted?'accepted':'invited',payment_status:'unpaid',share_amount:500,eligible_partner_share:333.33,refundable_share:166.67}];
function group(){const people=members();return{id:'shared-existing',created_by:owner,reservation_id:'reservation-existing',listing_id:'listing-existing',status:control.allAccepted?'ready':'inviting',booking_status:'payment_pending',product_type:'short_let',payment_phase:'stay_charge',guest_count:3,stay_check_in:'2027-03-20',stay_check_out:'2027-03-21',expires_at:new Date(Date.now()+1800000).toISOString(),total_amount:1500,members:people,listing:{id:'listing-existing',title:'Courtyard Short Let',city:'Lafia',state:'Nasarawa'}};}
function publication(){return{enabled:control.enabled,launch_approved:control.approved,review:{authority:'Test reviewer',reference:'synthetic-reference'},worker:{publicly_visible:control.enabled&&!control.paused,eligible:!control.paused,publication_paused:control.paused,identity_required:false,identity_current:false,reasons:control.paused?['Creator has paused marketplace publication']:control.enabled?[]:['Worker marketplace is paused']}};}
export const supabase={rpc:async(name:string,args:any={})=>{
 control.calls.push({name,args});
 if(control.denied)return{data:null,error:{message:'Permission denied'}};
 if(name==='creator_get_worker_publication')return{data:publication(),error:null};
 if(name==='creator_record_worker_launch_review'){if(args.p_creator_elevation_id!=='test-elevation')throw new Error('Missing step-up');control.approved=true;return{data:publication(),error:null};}
 if(name==='creator_set_worker_marketplace'||name==='creator_set_worker_publication'){
  if(args.p_creator_elevation_id!=='test-elevation'||!args.p_reason)throw new Error('Missing reason or step-up');
  if(name==='creator_set_worker_marketplace')control.enabled=args.p_enabled;else control.paused=args.p_paused;
  return{data:publication(),error:null};
 }
 if(name==='get_user_conversations')return{data:[['chat-bola','qa-bola','active'],['chat-chika','qa-chika','active'],['chat-pending','qa-pending','pending'],['chat-blocked','qa-blocked','active']].map(([id,b,status])=>({id,participant_a:owner,participant_b:b,conversation_type:'roommate',status})),error:null};
 if(name==='get_my_roommate_peer_details')return{data:[['qa-bola','Bola Example'],['qa-chika','Chika Example'],['qa-pending','Pending Example'],['qa-blocked','Blocked Example']].map(([id,name])=>({user_id:id,full_name:name,username:id.replace('qa-',''),is_blocked:id==='qa-blocked'})),error:null};
 if(name==='create_my_shared_short_let'){if(args.p_reservation_id!=='reservation-existing'||args.p_conversation_ids.length!==2)throw new Error('Lost stored reservation or recipients');return{data:group(),error:null};}
 if(name==='get_my_shared_housing_group')return{data:group(),error:null};
 if(name==='respond_to_shared_housing_invite'){if(args.p_group_id!=='shared-existing'||control.actor!==guest)throw new Error('Wrong invitation actor');w.__accepted=args.p_accept;return{data:group(),error:null};}
 if(name==='create_my_shared_housing_payment'){if(!control.allAccepted)throw new Error('Payment too early');return{data:{reference:'own-share-reference'},error:null};}
 throw new Error('Unexpected practical fixture API '+name);
},functions:{invoke:async(name:string,args:any)=>{control.calls.push({name,args});if(name!=='payment-init'||args.body.reference!=='own-share-reference')throw new Error('Wrong payment');return{data:{already_paid:true},error:null};}}};
w.__practicalTransport=control;
export const uploadStorageObjectWithProgress=async()=>{throw new Error('Fixture uploads prohibited');};
