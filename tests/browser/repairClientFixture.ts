// Synthetic, offline transport for the actual production hook/chat components.
// Never imported by the application entry or production build.
type Row = Record<string, any>;
let listeners: Array<() => void> = [];
export const control = {
  calls: [] as Array<{name: string; args: Row}>,
  rows: { alpha: [{id:'existing', sender_id:'guest', sender_name:'Guest Example', sender_role:'guest', content:'Arriving after six', attachments:['slow-photo'], attachment_types:['image/jpeg'], reactions:{}, is_read:false, created_at:'2026-09-23T09:00:00Z'}], beta: [{id:'other-booking',sender_id:'guest2',sender_name:'Other guest',sender_role:'guest',content:'Other booking only',attachments:[],attachment_types:[],reactions:{},is_read:false,created_at:'2026-09-23T10:00:00Z'}] } as Record<string, Row[]>,
  access: {identity:{user_id:'qa-viewer'},personal_workspace:true,privileged_workspaces:[{role:'property_partner'},{role:'worker'}]},
  guestView: (window as any).__mode === "guest-chat", denyContext: false,
  holdAccess: false, holdMessages: false, holdMedia: true, holdSend: true,
  accessWaiters: [] as Array<() => void>, messageWaiters: [] as Array<() => void>, mediaWaiters: [] as Array<() => void>, sendWaiters: [] as Array<(fail?: boolean) => void>,
  fire() { listeners.forEach(fn=>fn()); },
  releaseAccess(){this.holdAccess=false;this.accessWaiters.splice(0).forEach(fn=>fn())},
  releaseMessages(){this.holdMessages=false;this.messageWaiters.splice(0).forEach(fn=>fn())},
  releaseMedia(){this.holdMedia=false;this.mediaWaiters.splice(0).forEach(fn=>fn())},
  releaseSend(fail=false){this.sendWaiters.splice(0).forEach(fn=>fn(fail))},
};
const copy = <T,>(value:T):T=>JSON.parse(JSON.stringify(value));
export const supabase = {
  rpc(name:string,args:Row={}) {
    control.calls.push({name,args});
    if(name==='get_my_workspace_access') return new Promise(resolve=>{const done=()=>resolve({data:copy(control.access),error:null});if(control.holdAccess)control.accessWaiters.push(done);else done()});
    if(name==='get_my_hotel_conversation_bundle') return new Promise(resolve=>{
      const rows=copy(control.rows[args.p_conversation_id]||[]);
      const context={conversation_id:args.p_conversation_id,booking_id:args.p_booking_id,hotel_id:7,hotel_name:'Garden Lodge',room_name:'Deluxe',rate_plan_name:'Room only',check_in:'2026-09-24',check_out:'2026-09-26',booking_status:'confirmed',payment_status:'paid',viewer_party:control.guestView?'guest':'hotel',other_party_label:control.guestView?'Garden Lodge':args.p_booking_id===1?'Guest Example':'Other guest',request_visible:true,special_requests:args.p_booking_id===1?'Please arrange a quiet room.\nI may arrive at 6 pm.':null,can_reply:true};
      const done=()=>resolve(control.denyContext?{data:null,error:{message:'Hotel conversation access denied',code:'42501'}}:{data:{context,messages:rows},error:null});if(control.holdMessages)control.messageWaiters.push(done);else done();
    });
    if(name==='send_hotel_booking_message')return new Promise(resolve=>{
      const done=(fail=false)=>{
        if(fail)return resolve({data:null,error:{message:'Synthetic send failure'}});
        const id='sent-'+control.calls.filter(call=>call.name===name).length;
        control.rows[args.p_conversation_id].push({id,sender_id:'qa-viewer',sender_name:'Hotel Example',sender_role:control.guestView?'guest':'hotel',content:args.p_content,attachments:args.p_attachments,attachment_types:args.p_attachment_types,reactions:{},is_read:false,created_at:new Date().toISOString()});
        control.fire();resolve({data:id,error:null});
      };
      if(control.holdSend)control.sendWaiters.push(done);else done();
    });
    if(name==='open_my_hotel_booking_conversation')return Promise.resolve({data:args.p_booking_id===1?'alpha':'beta',error:null});
    return Promise.resolve({data:null,error:null});
  },
  storage:{from:()=>({
    createSignedUrl:()=>new Promise(resolve=>{const done=()=>resolve({data:{signedUrl:'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="100" height="100"%3E%3Crect width="100" height="100" fill="purple"/%3E%3C/svg%3E'},error:null});if(control.holdMedia)control.mediaWaiters.push(done);else done()}),
    upload:()=>Promise.resolve({data:{},error:null}),remove:()=>Promise.resolve({data:[],error:null}),
  })},
  channel:()=>{const callbacks:Array<()=>void>=[];const channel={on:(_event:string,_filter:Row,fn:()=>void)=>{callbacks.push(fn);return channel},subscribe:()=>{listeners.push(...callbacks);return channel},__callbacks:callbacks};return channel},
  removeChannel:(channel:{__callbacks:Array<()=>void>})=>{listeners=listeners.filter(fn=>!channel.__callbacks.includes(fn));return Promise.resolve('ok')},
};
control.rows.alpha.push({id:'colleague-message',sender_id:'desk-a',sender_name:'Reception A',sender_role:'hotel',content:'We have noted your quiet-room request.',attachments:[],attachment_types:[],reactions:{},is_read:false,created_at:'2026-09-23T09:01:00Z'});
if (control.guestView) control.rows.alpha=control.rows.alpha.filter(row=>row.sender_role==='hotel');
(window as any).__transport=control;
