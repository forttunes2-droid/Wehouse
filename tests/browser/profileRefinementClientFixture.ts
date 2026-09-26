/** Isolated API boundary. Production components and their query/permission paths are not mocked. */
const w = window as any;
export const state = w.__profileFixture = {
  calls: [] as any[], failPosts: false, failTrust: false, failReviews: false, failMedia: false, failComments: false, failHelp: false,
  wrongAccount: false, delayWorker: '', pending: [] as Array<() => void>, hidden: [] as string[], deleted: [] as string[], comments: [] as any[],
};
const ok = (data: any) => ({ data, error: null });
const bad = () => ({ data: null, error: { message: 'Fixture unavailable' } });
function dataPosts(worker: string) {
 return Array.from({length:28}, (_, index) => ({id:`${worker}-p${index}`,worker_id:worker,kind:'work_post',media_type:index===1?'video':'image',storage_path:index===1?'demo-video':`work-${index}.jpg`,caption:index===0?'Kitchen fitting':index===1?'A closer look at the finish':`Work sample ${index+1}`,booking_id:null,verified_job:index===0,job_confirmation_status:index===0?'confirmed':'not_linked',hidden_at:index===2||state.hidden.includes(`${worker}-p${index}`)?'2026-09-23T12:00:00Z':null,deleted_at:state.deleted.includes(`${worker}-p${index}`)?'2026-09-23T12:00:00Z':null,expires_at:null,created_at:new Date(Date.UTC(2026,8,23,12,0,0)-index*3600000).toISOString()}));
}
function query(table: string) {
 const conditions:any[]=[];let start=0,end=49,single=false;
 const chain:any={select(){return chain},eq(key:string,value:any){conditions.push(['eq',key,value]);return chain},is(key:string,value:any){conditions.push(['is',key,value]);return chain},or(value:string){conditions.push(['or',value]);return chain},order(){return chain},range(a:number,b:number){start=a;end=b;return chain},limit(count:number){end=count-1;return chain},maybeSingle(){single=true;return chain},then(resolve:any,reject:any){
  const worker=conditions.find(row=>row[1]==='worker_id')?.[2]||'worker-a';
  state.calls.push({name:table,conditions:[...conditions],start,end,worker});
  const result=()=>{
   if(table==='worker_bookings')return ok([{id:'job-complete',booking_code:'WH-JOB-123',service_type:'Carpentry'}]);
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
 rpc:async(name:string,args:any={})=>{
  state.calls.push({name,args});
  if(name==='get_my_workspace_help_targets')return state.failHelp?bad():ok(help());
  if(name==='get_worker_marketplace_trust')return state.failTrust?bad():ok({reviewed:true,trusted:false,completed_jobs:7,rating:4.8,review_count:1});
  if(name==='get_public_worker_reviews')return state.failReviews?bad():ok([{id:'review-1',rating:5,comment:'Careful work and a tidy finish.',created_at:'2026-09-21T12:00:00Z',reviewer_name:'Ada Example',service_name:'Carpentry'}]);
  if(name==='get_worker_showcase_reactions')return ok([]);
  if(name==='get_worker_showcase_post_comments')return state.failComments?bad():ok(state.comments.filter(row=>row.post_id===args.p_post_id));
  if(name==='add_my_worker_showcase_comment'){state.comments.push({id:`comment-${state.comments.length}`,post_id:args.p_post_id,body:args.p_body,user_id:'viewer',created_at:'2026-09-24T12:00:00Z',display_name:'Ada Example',avatar_url:null});return ok(null);}
  if(name==='set_my_worker_showcase_reaction')return ok(args.p_emoji?{'♥':1}:{});
  if(name==='set_my_worker_work_post_hidden'){state.hidden=state.hidden.filter(id=>id!==args.p_post_id);if(args.p_hidden)state.hidden.push(args.p_post_id);return ok(null);}
  if(name==='delete_my_worker_showcase_post'){state.deleted.push(args.p_post_id);return ok('test-only-file');}
  if(name==='create_my_worker_showcase_post')return ok({id:'created-test-post'});
  throw new Error(`Unexpected fixture RPC ${name}`);
 },
 storage:{from:(bucket:string)=>({createSignedUrls:async(paths:string[])=>{state.calls.push({name:'sign-many',bucket,paths});return state.failMedia?bad():ok(paths.map(path=>({path,signedUrl:path==='demo-video'?w.__demoVideo:'https://assets.wehouse.test/work.jpg'})));},createSignedUrl:async(path:string)=>{state.calls.push({name:'sign-one',bucket,path});return state.failMedia?bad():ok({signedUrl:path==='demo-video'?w.__demoVideo:'https://assets.wehouse.test/work.jpg'});},remove:async(paths:string[])=>{state.calls.push({name:'remove-media',paths});return ok(null);}})},
};
export const compressImageFile=async(file:File)=>file;
export const uploadStorageObjectWithProgress=async(...args:any[])=>{state.calls.push({name:'upload-media',path:args[1]});args.at(-1)?.(100);};
