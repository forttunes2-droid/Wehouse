/** Isolated transport for the real assigned-field conversation UI, not hosted acceptance. */
export const conversationId='99999999-1111-4111-8111-111111111111';
const w=window as any;
const messages:any[]=[{id:'99999999-2222-4222-8222-222222222222',sender_id:'customer',sender_name:'Property Partner',sender_role:'user',sender_side:'requester',content:'Please coordinate the assigned inspection.',created_at:'2026-10-22T08:00:00Z',is_read:false,attachments:[]}];
const row={conversation_id:conversationId,requester_id:'customer',requester_name:'Property Partner',requester_role:'property_partner',requester_state:'Nasarawa',requester_lga:'Lafia',subject:'Property inspection',status:'in_progress',category:'field_visit',context_type:'operational_case',context_id:'inspection-a',context_snapshot:{reason_code:'field_visit',reason_label:'Property inspection',subject_type:'inspection',source_type:'inspection',source_id:'inspection-a',owning_domain:'property_operations',field_assignee_id:'field-a'},assigned_staff_id:'property-a',assigned_staff_name:'Property Operations handler',unread_count:1,created_at:'2026-10-22T08:00:00Z'};
export const control=w.__fieldCase={calls:[] as any[]};
const ok=(data:any)=>Promise.resolve({data:structuredClone(data),error:null});
export const supabase:any={
 rpc(name:string,args:any={}){
  control.calls.push({name,args});
  if(name==='support_inbox'){
   if(args.p_queue!=='field_operations')throw Error('Wrong operational queue');
   return ok([{...row,last_message:messages.at(-1)?.content}]);
  }
  if(name==='get_operational_conversation_bundle')return ok({conversation:{...row},messages,internal_notes:[{id:'99999999-3333-4333-8333-333333333333',sender_id:'property-a',sender_name:'Property Operations handler',content:'Coordinate the evidence with the assigned property case.',created_at:'2026-10-22T08:01:00Z',is_read:true,attachments:[]}],events:[]});
  if(name==='mark_support_messages_read'){messages.forEach(message=>{message.is_read=true;});return ok(null);}
  if(name==='send_support_message_v2'){
   if(!messages.some(message=>message.id===args.p_request_id))messages.push({id:args.p_request_id,sender_id:'field-a',sender_name:'Assigned inspector',sender_role:'staff',sender_side:'wehouse',content:args.p_content,created_at:'2026-10-22T08:02:00Z',is_read:false,attachments:[]});
   return ok(args.p_request_id);
  }
  throw Error('Unexpected field-case RPC '+name);
 },
 channel(){const channel={on(){return channel;},subscribe(){return channel;}};return channel;},
 async removeChannel(){},
};
// The forced Inbox has no broadcast surface. Broadcast behavior is outside this fixture.
export function AnnouncementsTab(){return null;}
