/** Transport fixture only; no real accounts, external requests or payment. */
const w = window as any;
export const control = w.__supportInbox = {
 calls: [] as any[], threads: {} as Record<string, any[]>, messages: {} as Record<string, any[]>,
 failInbox: false, holdSend: false, releaseSend: null as null | (() => void), firstSends: 0,
 role: w.__supportRole || 'user',
};
const ok=(data:any)=>Promise.resolve({data,error:null});
const scope=()=>control.role==='user'?'personal':control.role==='hotel_staff'?'hotel':control.role;
export const supabase:any={
 rpc(name:string,args:any={}) {
  control.calls.push({name,args});
  if(name==='get_my_workspace_help_targets')return ok({account:{subject_type:'account',subject_id:'viewer',label:'My account'},reservations:[],hotel_bookings:[],worker_jobs:[],payment_targets:[]});
  if(name==='get_my_workspace_inbox')return control.failInbox?Promise.resolve({data:null,error:{message:'Cannot load Inbox'}}):ok(control.threads[args.p_workspace]||[]);
  if(name==='get_support_messages')return ok(control.messages[args.p_conversation_id]||[]);
  if(name==='get_my_support_case_events')return ok([]);
  if(name==='mark_support_messages_read')return ok(true);
  if(name==='create_my_support_message_draft')return ok('draft-'+(control.firstSends+1));
  if(name==='send_my_first_contextual_help_message') {
   return new Promise(resolve=>{
    const finish=()=>{
     const workspace=String(args.p_snapshot.requester_workspace), id='support-'+workspace;
     if(!control.threads[workspace]?.length) {
      control.firstSends++;
      control.threads[workspace]=[{conversation_id:id,subject:args.p_summary,category:args.p_reason_code,context_type:'contextual_help',context_id:args.p_subject_id,context_snapshot:args.p_snapshot,status:'open',priority:'normal',created_at:'2026-09-25T00:00:00Z',last_message:args.p_content,unread_count:0}];
      control.messages[id]=[{id:'msg-1',sender_id:'viewer',sender_name:'Viewer',sender_role:'user',content:args.p_content,created_at:'2026-09-25T00:00:00Z',is_read:false}];
     }
     resolve({data:{conversation_id:id,message_id:'msg-1',replayed:false},error:null});
    };
    if(control.holdSend)control.releaseSend=finish;else finish();
   });
  }
  if(name==='send_support_message'){
   const id=args.p_conversation_id;
   control.messages[id].push({id:'follow-up',sender_id:'viewer',sender_role:'user',content:args.p_content,created_at:'2026-09-25T00:01:00Z'});
   return ok('follow-up');
  }
  if(name==='get_my_support_message_draft_status')return ok({state:'sent',conversation_id:'support-'+scope(),message_id:'msg-1'});
  throw new Error('Unexpected test RPC '+name);
 },
 channel:()=>{const c={on(){return c},subscribe(){return c}};return c},removeChannel:async()=>{},
};
