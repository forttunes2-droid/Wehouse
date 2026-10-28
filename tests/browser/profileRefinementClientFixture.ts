/** Isolated API boundary. Production components and their query/permission paths are not mocked. */
const w = window as any;
export const state = w.__profileFixture = {
  accountSuspended:false,loseAccessResponse:true,
  recoveryLost:false,recoveryFail:false,recoveryDecision:null as string|null,recoveryAssigned:false,recoveryCase:false,recoveryStatus:'open',recoveryRestrictions:{worker:true,property_partner:true},
  calls: [] as any[], failPosts: false, failTrust: false, failReviews: false, failMedia: false, failComments: false, failHelp: false,
  wrongAccount: false, delayWorker: '', delaySigning: false, pending: [] as Array<() => void>, pendingSigning: [] as Array<() => void>, hidden: [] as string[], deleted: [] as string[], comments: [] as any[],
};
const revision='b8220000-0000-4000-8000-000000000001',caseId='b8220000-0000-4000-8000-000000000002';
const recoveryRow=()=>({case_id:caseId,case_number:52,user_id:'worker-a',username:'sani-carpentry',workspace:'worker',explanation:'Please review the event and existing approved evidence.',status:state.recoveryStatus,updated_at:'2026-10-28T12:00:00.123456Z',decision:state.recoveryDecision,public_decision:null,assigned_user_id:state.recoveryAssigned?'creator-example':null,restriction_version:revision,current_version:revision,restricted:state.recoveryRestrictions.worker,updates:[]});
const recoveryPortal=()=>({restrictions:Object.entries(state.recoveryRestrictions).filter(([,active])=>active).map(([workspace])=>({workspace,version:revision,reason:'Conduct review for this workspace.',changed_at:'2026-10-28T12:00:00Z'})),appeals:state.recoveryCase?[recoveryRow()]:[]});
const ok = (data: any) => ({ data, error: null });
const bad = () => ({ data: null, error: { message: 'Fixture unavailable' } });
function dataPosts(worker: string) {
 return Array.from({length:w.__refinementMode==='owner-new'?3:28}, (_, index) => ({id:`${worker}-p${index}`,worker_id:worker,kind:'work_post',media_type:index===1?'video':'image',storage_path:index===1?'demo-video':`work-${index}.jpg`,caption:index===0?'Kitchen fitting':index===1?'A closer look at the finish':`Work sample ${index+1}`,booking_id:null,verified_job:index===0,job_confirmation_status:index===0?'confirmed':'not_linked',hidden_at:index===2||state.hidden.includes(`${worker}-p${index}`)?'2026-09-23T12:00:00Z':null,deleted_at:state.deleted.includes(`${worker}-p${index}`)?'2026-09-23T12:00:00Z':null,expires_at:null,created_at:new Date(Date.UTC(2026,8,23,12,0,0)-index*3600000).toISOString()}));
}
function query(table: string) {
 const conditions:any[]=[];let start=0,end=49,single=false;
 const chain:any={select(){return chain},eq(key:string,value:any){conditions.push(['eq',key,value]);return chain},is(key:string,value:any){conditions.push(['is',key,value]);return chain},or(value:string){conditions.push(['or',value]);return chain},order(){return chain},range(a:number,b:number){start=a;end=b;return chain},limit(count:number){end=count-1;return chain},maybeSingle(){single=true;return chain},then(resolve:any,reject:any){
  const worker=conditions.find(row=>row[1]==='worker_id')?.[2]||'worker-a';
  state.calls.push({name:table,conditions:[...conditions],start,end,worker});
  const result=()=>{
   if(table==='profiles'){const id=conditions.find(row=>row[1]==='user_id')?.[2]||'worker-a';return ok({user_id:id,suspended:state.accountSuspended});}
   if(table==='worker_bookings')return ok([{id:'job-complete',booking_code:'WH-JOB-123',service_type:'Carpentry'}]);
   if(table==='worker_services')return ok([{service_name:'Carpentry',price:15000,price_type:'fixed'}]);
   if(state.failPosts)return bad();
   let rows=dataPosts(worker);
   for(const [op,key,value] of conditions)if(op==='eq'||op==='is')rows=rows.filter((row:any)=>row[key]===value);
   return ok(single?rows[0]||null:rows.slice(start,end+1));
  };
  const promise=state.delayWorker===worker?new Promise(res=>state.pending.push(()=>res(result()))):Promise.resolve(result());
  return promise.then(resolve,reject);
 }};return chain;
}
const target=(id:string,label:string,status:string,context_type='hotel_booking')=>({subject_id:id,subject_type:context_type==='hotel_booking'?'hotel_booking':'apartment',context_type,label,status,record_date:'2026-09-24',record_reference:'Record 12345678'});
function help() {
 const cancelled=target('old-cancelled','Cancelled test stay','cancelled'), refund=target('refund','Refund under review','cancelled');
 return {account:{subject_type:'account',subject_id:state.wrongAccount?'another-user':'viewer',label:'My account'},reservations:[target('home-current','Long Let in Lafia','payment_pending','apartment_reservation')],hotel_bookings:[target('stay-current','Garden Lodge','confirmed'),cancelled],worker_jobs:[],payment_targets:[refund]};
}
export const supabase:any={
 from:query,
 functions:{invoke:async(name:string,{body}:any)=>{state.calls.push({name,args:body});if(state.recoveryFail)return bad();if(body.action==='close')return ok({success:true});if(body.action==='send_code')return ok({success:true});if(body.action==='verify_code')return ok({success:true,recovery_token:'a'.repeat(64)});return ok({success:true,portal:recoveryPortal()});}},

  rpc:async(name:string,args:any={})=>{
  state.calls.push({name,args});
  if(name==='my_account_reviews'){
   if(state.recoveryFail)return bad();
   if(args.p_workspace){state.recoveryCase=true;if(state.recoveryLost)return bad();}
   return ok(recoveryPortal());
  }
  if(name==='review_workspace_access'){
   if(args.p_workspace){(state.recoveryRestrictions as any)[args.p_workspace]=args.p_restricted;if(state.recoveryLost)return bad();}
   return ok({protected:false,workspaces:['personal','worker','property_partner'],restrictions:Object.entries(state.recoveryRestrictions).map(([workspace,restricted])=>({workspace,restricted,version:revision,public_reason:'Conduct review'}))});
  }
  if(name==='list_account_review_queue')return state.recoveryFail?bad():ok(state.recoveryCase?[recoveryRow()]:[]);
  if(name==='decide_account_review'){
   if(args.p_action==='claim'){state.recoveryAssigned=true;state.recoveryStatus='investigating';}
   else if(args.p_action==='request_information')state.recoveryStatus='waiting_customer';
   else{state.recoveryStatus='resolved';state.recoveryDecision=args.p_action;if(args.p_action==='restored')state.recoveryRestrictions.worker=false;}
   if(state.recoveryLost)return bad();return ok({success:true,case_id:caseId,action:args.p_action});
  }

  if(name==='get_my_worker_showcase_capacity'){const posts=dataPosts('worker-a').filter(row=>!row.deleted_at);return ok({posts:posts.length,videos:posts.filter(row=>row.media_type==='video').length,post_limit:12,video_limit:3,photo_bytes:2000000,video_bytes:13000000});}
  if(name==='creator_get_people')return ok([{user_id:'worker-a',full_name:'Sani Example',username:'sani-carpentry',worker_occupation:'Carpenter',city:'Lafia',state:'Nasarawa',worker_status:'verified',worker_verified:true,available:true,suspended:state.accountSuspended}]);
  if(name==='admin_get_worker_review_trust_status')return ok({profile_ready:true,identity_captured:true,identity_passed:true,readiness_passed:true,evidence_saved:true,submitted:true,review_status:'approved'});
  if(name==='creator_set_account_suspension'){state.accountSuspended=args.p_suspended;return state.loseAccessResponse?bad():ok(null);}
  if(name==='creator_get_worker_publication')return ok({enabled:false,launch_approved:false,worker:null});
  if(name==='get_my_workspace_help_targets')return state.failHelp?bad():ok(help());
  if(name==='get_worker_marketplace_trust')return state.failTrust?bad():ok({reviewed:true,trusted:false,completed_jobs:7,rating:4.8,review_count:1});
  if(name==='get_worker_pro_service_packages')return ok([]);
  if(name==='get_worker_pro_featured_posts')return ok([]);
  if(name==='get_public_worker_reviews')return state.failReviews?bad():ok([{id:'review-1',rating:5,comment:'Careful work and a tidy finish.',created_at:'2026-09-21T12:00:00Z',reviewer_name:'Ada Example',service_name:'Carpentry'}]);
  if(name==='get_worker_showcase_reactions')return ok([]);
  if(name==='get_worker_showcase_post_comments_page'){
    if(state.failComments)return bad();
    const all=state.comments.filter(row=>row.post_id===args.p_post_id).reverse();
    const offset=args.p_before_id?all.findIndex(row=>row.id===args.p_before_id)+1:0;
    const rows=all.slice(offset,offset+(args.p_limit||30));
    const last=rows.at(-1);
    return ok({items:rows,total:all.length,has_more:offset+rows.length<all.length,next_cursor:last?{at:last.created_at,id:last.id}:null});
  }
  if(name==='add_my_worker_showcase_comment'){state.comments.push({id:`comment-${state.comments.length}`,post_id:args.p_post_id,body:args.p_body,user_id:'viewer',created_at:'2026-09-24T12:00:00Z',display_name:'Ada Example',avatar_url:null});return ok(null);}
  if(name==='set_my_worker_showcase_reaction')return ok(args.p_emoji?{'♥':1}:{});
  if(name==='set_my_worker_work_post_hidden'){state.hidden=state.hidden.filter(id=>id!==args.p_post_id);if(args.p_hidden)state.hidden.push(args.p_post_id);return ok(null);}
  if(name==='delete_my_worker_showcase_post'){state.deleted.push(args.p_post_id);return ok('test-only-file');}
  if(name==='create_my_worker_showcase_post')return ok({id:'created-test-post'});
  throw new Error(`Unexpected fixture RPC ${name}`);
 },
 storage:{from:(bucket:string)=>({createSignedUrls:async(paths:string[])=>{state.calls.push({name:'sign-many',bucket,paths});const result=()=>state.failMedia?bad():ok(paths.map(path=>({path,signedUrl:path==='demo-video'?w.__demoVideo:'https://assets.wehouse.test/work.jpg'})));return state.delaySigning?new Promise(resolve=>state.pendingSigning.push(()=>resolve(result()))):result();},createSignedUrl:async(path:string)=>{state.calls.push({name:'sign-one',bucket,path});const result=()=>state.failMedia?bad():ok({signedUrl:path==='demo-video'?w.__demoVideo:'https://assets.wehouse.test/work.jpg'});return state.delaySigning?new Promise(resolve=>state.pendingSigning.push(()=>resolve(result()))):result();},remove:async(paths:string[])=>{state.calls.push({name:'remove-media',paths});return ok(null);}})},
};
// The isolated browser fixture never exercises passkeys. Keep the optional
// production feature explicitly disabled while bundling account help screens.
export const isWebPasskeyEnabled = false;
export const getWorkers=async()=>{state.calls.push({name:'get_public_workers'});return {workers:[{user_id:'worker-a',full_name:'Sani Example',username:'sani-carpentry',worker_occupation:'Carpenter',worker_bio:'Furniture fitting and repairs.',worker_skills:['Carpentry'],worker_price:15000,city:'Lafia',state:'Nasarawa',worker_status:'verified',worker_verified:true,available:true,role:'worker'}],error:null};};
export const compressImageFile=async(file:File)=>file;
export const uploadStorageObjectWithProgress=async(...args:any[])=>{state.calls.push({name:'upload-media',path:args[1]});args.at(-1)?.(100);};
