const mode = new URLSearchParams(location.search).get('mode') || 'worker';
const state = { mode, recover: false, failActivity:false, failReminderReceipt:false, rpcCalls: [] as Array<{ name: string; args: any }>, queries: [] as any[], invokeCalls: [] as any[] };
let propertyReview:any=null;
let experienceSessionRows:any[]=[];
const activityPhotoRows:any[]=(mode.includes('photo-review')||mode.includes('approval-'))?[{id:'10000000-0000-4000-8000-000000000002',activity_id:'10100000-0000-4000-8000-000000000091',revision:2,object_path:'10100000-0000-4000-8000-000000000091/10000000-0000-4000-8000-000000000002.jpg',byte_size:9,caption:'Guided orientation route',context_current:true,status:mode.includes('approval-')?'approved':'submitted'}]:[];
let activityEvidence:any={configured:mode.includes('approval-')||mode.includes('evidence-host'),revision:mode.includes('evidence-host')?1:0,ready:mode.includes('approval-'),can_review:mode.includes('review'),can_submit:mode.includes('evidence-host'),context_current:mode.includes('approval-')||mode.includes('evidence-host'),requirements:mode.includes('evidence-host')?[{code:'venue_permission',label:'Venue permission',instructions:'Provide permission for this activity at the proposed venue.',requires_expiry:false}]:[],documents:[]};
let hotelDiscountRows:any[]=[];
let hostControlsAccepting=true;let hostControlsPrice=25000;
let refundResolved=false;let hotelCancelled=false;
let reminderDone=false;
let privateCallStatus=mode==='private-call-media'?'accepted':'ringing';
const privateCall=()=>({id:'10100000-0000-4000-8000-000000000081',context_type:'roommate',context_id:'10100000-0000-4000-8000-000000000082',caller_id:'call-peer',callee_id:'wallet-qa-owner',call_type:'audio',status:privateCallStatus,created_at:now,peer_name:'Call test member',incoming:true});
(window as any).__walletPro = state;
const bankId = '10100000-0000-4000-8000-000000000031';
const wallet = { id: '10100000-0000-4000-8000-000000000021', available_balance: 25000,
  pending_balance: 7000, frozen_balance: 0, total_withdrawn: 0, is_frozen: false, frozen_reason: null };
const bank = { id: bankId, bank_name: 'Current Test Bank', bank_code: '058', account_number: '0123456789',
  account_name: 'Test Owner', is_default: true, is_active: true, verified_at: '2026-10-19T10:00:00Z' };
const now = '2026-10-19T10:00:00Z';
const experienceDetails={title:'Campus orientation walk',category:'culture_tours',what_to_expect:'Explore local landmarks with a guided route, useful orientation information and time to ask questions.',host_expertise:'I have led local orientation walks and know the route and meeting arrangements.',country_code:'NG',state:'Nasarawa',local_area:'Lafia',city:'Lafia',meeting_area:'Public main gate',timezone:'Africa/Lagos',participation_requirements:'Comfortable shoes; adults only.',accessibility_information:'Step-free route with assistance available.',duration_minutes:60,max_group_size:8,inclusions:['Guided walk'],exclusions:['Transport']};
let experienceRows:any[]=mode.startsWith('experience-applications')&&mode!=='experience-applications-create'?[{id:'10100000-0000-4000-8000-000000000091',host_user_id:'wallet-qa-owner',revision:mode.includes('review')?2:1,status:mode.includes('review')?'submitted':'draft',category_name:'Culture and local tours',details:experienceDetails,created_at:now,updated_at:now}]:[];
if(mode==='experience-applications-approval-host')experienceRows=experienceRows.map(row=>({...row,status:'approved',revision:3,approved_from_revision:2,approved_by:'fixture-independent-creator',approved_at:now,approval_note:'Activity evidence, photos and sessions reviewed.'}));
const reportId = '10100000-0000-4000-8000-000000000041';
function reports() { return JSON.parse(localStorage.getItem('qa-hotel-reports') || '[]'); }
const plan = { active: true, current_period_end: '2027-10-19T00:00:00Z', sales_enabled: false,
  monthly_price_ngn: 0, yearly_price_ngn: 0, terms_content: '', terms_version: '', terms_accepted: false, auto_renews: false };
const tasks: any[] = [];
let managementConfigured=!['management-read-error','management-malformed','management-timeout','management-mutation-error'].includes(mode);
let invitationWithdrawn=false;
const managementState=()=>({listing_id:'management-home',management_mode:mode.includes('wehouse')?'wehouse':'host',wehouse_management_status:mode.includes('wehouse')?(mode.endsWith('approved')?'approved':'requested'):'not_required',management_updated_at:managementConfigured?now:null,management_host_user_id:mode.includes('wehouse')?null:mode==='management-cohost'?'other-owner':'wallet-qa-owner',assignments:mode==='management-cohost'?[{assignment_id:'other-owner',user_id:'other-owner',name:'Property Owner',role:'owner',status:'active',access_level:'full_hosting'},{assignment_id:'my-cohost',user_id:'wallet-qa-owner',role:'manager',status:'active',access_level:'operations'}]:[{assignment_id:'management-owner',user_id:'wallet-qa-owner',name:'Property Owner',role:'owner',status:'active',access_level:'full_hosting'}]});
const docRules=[{code:'authority',label:'Authority to list',instructions:'Provide the current signed authority naming this property and its owner.',requires_expiry:false},{code:'address',label:'Property address evidence',instructions:'Provide the accepted evidence matching this property address.',requires_expiry:false}];
function docState(){return JSON.parse(localStorage.getItem('qa-property-documents')||JSON.stringify({configured:mode!=='documents-unconfigured',revision:1,documents:[{id:'address-approved',request_id:'document-request',requirement_code:'address',object_path:'document-request/address.pdf',original_name:'address.pdf',mime_type:'application/pdf',byte_size:9,status:'approved',submitted_at:now,review_note:'Address reviewed.',expires_at:null}]}));}
function saveDocState(value:any){localStorage.setItem('qa-property-documents',JSON.stringify(value));}
const credentialRule={code:'licence',label:'Trade licence',instructions:'Provide the current accepted trade qualification for your service and operating area.',requires_expiry:true};
function credentialState(){return JSON.parse(localStorage.getItem('qa-worker-credentials')||JSON.stringify({configured:mode!=='credentials-unconfigured',revision:1,context_current:mode!=='credentials-context-changed',requirements:[credentialRule],documents:[]}));}
function saveCredentialState(value:any){localStorage.setItem('qa-worker-credentials',JSON.stringify(value));}
let cost = 1250;
const never = () => new Promise<any>(() => {});
function saved() { return JSON.parse(localStorage.getItem('qa-wallet-receipts') || '{}'); }
let followPaused=false,followRemoved=false,activityRead=false;
function result(table: string, filters: any[]) {
 if(table==='platform_countries')return {data:{currency_code:'NGN'},error:null};
  if(mode.startsWith('property-spaces-')){
    state.queries.push({table,filters});
    if(table==='property_submission_batches')return{data:filters.some(x=>x[0]==='insert')?{id:'10100000-0000-4000-8000-000000000061'}:null,error:null};
    if(table==='property_submission_items')return{data:[],error:null};
  }
  if(mode.startsWith('private-call')&&table==='profiles')return{data:{user_id:'wallet-qa-owner'},error:null};
  if(mode.startsWith('worker-profile-') && table==='worker_service_coverage')return{data:{state:'Lagos',lga:'Ikeja',areas:['Alausa']},error:null};
  if(mode.startsWith('worker-profile-') && table==='worker_services')return{data:[{service_name:'Electrical repairs'}],error:null};
  if(table==='saved_searches') {
    const update=filters.find(x=>x[0]==='update');const remove=filters.some(x=>x[0]==='delete');
    if((update||remove)&&mode==='followed-missing-receipt'&&!state.recover)return{data:null,error:null};
    if(update)followPaused=update[1].notifications_enabled===false;
    if(remove){followRemoved=true;return{data:{id:'followed-1'},error:null};}
    const row={id:'followed-1',user_id:'wallet-qa-owner',name:'Lafia homes under budget',search_kind:'homes',criteria:{city:'Lafia',max_price:200000},notifications_enabled:!followPaused,created_at:now,updated_at:now,last_notified_at:null};
    return{data:update?row:followRemoved?[]:[row],error:null};
  }
  if(table==='profiles'&&filters.some(x=>x[0]==='update')){
    const update=filters.find(x=>x[0]==='update')[1];
    if(mode==='notification-preference-missing'&&!state.recover)return{data:null,error:null};
    return{data:{user_id:'wallet-qa-owner',...update},error:null};
  }
  state.queries.push({ table, filters });
  if (mode.includes('read-error') && !state.recover) return { data: null, error: { message: 'Synthetic read failure' } };
  let rows: any[] = [];
  if (table === 'wallets') return { data: mode.includes('wallet-malformed')&&!state.recover?{...wallet,available_balance:null}:wallet, error: null };
  if (table === 'bank_accounts') rows = [bank, { ...bank, id: '10100000-0000-4000-8000-000000000032', bank_name: 'Retired Test Bank', is_active: false, is_default: false }];
  if (table === 'bank_accounts' && mode.startsWith('payout-') && mode !== 'payout-existing' && !state.recover) rows = [];
  if (table === 'wallet_transactions') rows = [{ id: 'one-credit', amount: 25000, transaction_type: 'canonical_protected_release', description: 'Released job earnings', created_at: now }];
  if (table === 'withdrawals') rows = Object.values(saved());
  if (table === 'property_partner_earning_releases') rows = [
    { id: 'already-released', earning_type: 'hotel', net_amount: 25000, status: 'available', created_at: now },
    { id: 'held', earning_type: 'hotel', net_amount: 7000, status: 'held', created_at: now },
  ];
  for (const [op, column, value] of filters) {
    if (column === 'user_id' || column === 'owner_id' || column === 'owner_type' || column === 'partner_id' || column === 'wallet_id') continue;
    if (op === 'eq') rows = rows.filter(row => row[column] === value);
    if (op === 'in') rows = rows.filter(row => value.includes(row[column]));
    if (op === 'not') rows = rows.filter(row => row[column] != null);
  }
  return { data: rows, error: null };
}
export const supabase: any = {
  channel:()=>({on(...args:any[]){if(mode==='activity-partial-failure')(window as any).__refreshActivity=args.at(-1);return this;},subscribe(){return this;}}),removeChannel:async()=>{},
  storage:{from:()=>({upload:async()=>({error:null}),download:async()=>({data:new Blob(['%PDF-1.7\n'],{type:'application/pdf'}),error:null}),createSignedUrls:async(paths:string[])=>({data:paths.map(path=>({path,signedUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZkAAAAASUVORK5CYII='})),error:null})})},
  functions: { invoke: async (_name: string, options: any = {}) => {
    if(_name==='financial-action-reconcile'){
      state.invokeCalls.push(options.body);
      if(mode.endsWith('missing'))return{data:{},error:null};
      refundResolved=true;
      if(mode.endsWith('lost'))throw new Error('Provider check outcome was not confirmed. Refresh current status.');
      return{data:{success:true,financial_action_id:options.body.financial_action_id,status:'completed'},error:null};
    }
    if(_name==='email-account-security') {
      const body=options.body||{};state.invokeCalls.push(body);
      if(mode==='email-recovery-unavailable'&&!state.recover)return{data:{error:'Email confirmation is not available yet.'},error:null};
      if(body.action==='start')return{data:{success:true,challenge_id:'email-challenge',expires_in:600},error:null};
      if(body.code!=='12345678')return{data:{error:'That code is invalid or expired.'},error:null};
      return{data:body.purpose==='password_recovery'?{success:true,password_changed:true}:{success:true,session_id:'email-pending-session',trust_status:'trusted'},error:null};
    }
    if (mode.startsWith('finance-')) { state.invokeCalls.push(options.body); state.recover = true; throw new Error('Synthetic lost transfer response'); }
    if (!mode.startsWith('payout-')) throw new Error('Synthetic management failure');
    const body = options.body || {};
    state.invokeCalls.push(body);
    if (body.action === 'banks' && mode === 'payout-banks-timeout' && !state.recover) return never();
    if (body.action === 'banks' && mode === 'payout-banks-malformed' && !state.recover) return {data:{success:true,banks:[{}]},error:null};
    if (body.action === 'resolve' && mode === 'payout-resolve-timeout' && !state.recover) return never();
    if (body.action === 'banks') return { data: { success: true, banks: [{ code: bank.bank_code, name: bank.bank_name },...(mode==='payout-bank-search'?[{code:'057',name:'Zenith Test Bank'},{code:'011',name:'First Bank Test'}]:[])] }, error: null };
    if (body.action === 'resolve') return { data: { success: true, bank: { code: bank.bank_code, name: bank.bank_name }, account_number: bank.account_number, account_name: bank.account_name, addition_allowed: true }, error: null };
    if (body.action === 'save') throw new Error('Synthetic lost save response');
    if (body.action === 'get_change_status') return { data: state.recover ? { success: true, status: 'succeeded', account: bank } : { success: true, pending: true, status: 'not_found' }, error: null };
    throw new Error('Unexpected synthetic payout action');
  } },
  auth: {
    verifyOtp:async(args:any)=>{state.invokeCalls.push(args);return{data:{user:{id:'signup-auth',email:'signup@example.invalid',email_confirmed_at:now}},error:null};},
    resend:async()=>({error:null}),
    getUser: async () => ({ data: { user: { id:'wallet-auth', app_metadata: { providers: ['email'] }, last_sign_in_at: new Date().toISOString() } }, error: null }),
    signInWithPassword: async () => ({ data: {}, error: null }),
  },
  from(table: string) {
    const filters: any[] = [];
    let single = false;
    const query: any = {
      select: () => query, insert:(value:any)=>{filters.push(['insert',value]);return query;},upsert:(value:any)=>{filters.push(['upsert',value]);return query;},single:()=>{single=true;return query;},update:(value:any)=>{filters.push(['update',value]);return query;},delete:()=>{filters.push(['delete']);return query;},order: () => query, limit: () => query, maybeSingle: () => { single = true; return query; },
      eq: (column: string, value: any) => { filters.push(['eq', column, value]); return query; },
      in: (column: string, value: any) => { filters.push(['in', column, value]); return query; },
      not: (column: string, _op: string, value: any) => { filters.push(['not', column, value]); return query; },
      then: (resolve: any, reject: any) => { const response = result(table, filters); if (single && Array.isArray(response.data)) response.data = response.data[0] || null; return Promise.resolve(response).then(resolve, reject); },
    };
    return query;
  },
  async rpc(name: string, args: any = {}) {
    if(mode.startsWith('hotel-presence-')&&name==='issue_my_hotel_stay_code'){
      state.rpcCalls.push({name,args});
      if(mode==='hotel-presence-delay'&&args.p_booking_id===71)return new Promise(resolve=>{(window as any).__finishHotelCode=()=>resolve({data:'11112222',error:null});});
      if(mode==='hotel-presence-failure'&&!state.recover)throw Error('Guest code connection interrupted');
      if(mode==='hotel-presence-malformed'&&!state.recover)return{data:'not-a-code',error:null};
      return{data:args.p_action==='checked_out'?'99998888':'55556666',error:null};
    }
    if(mode.startsWith('share-journey-')){
      if(name==='get_my_roommate_peer_details')return {data:[{user_id:'roommate-peer',conversation_id:'roommate-chat',full_name:'Accepted Roommate',is_blocked:false}],error:null};
      if(name==='list_my_friends')return {data:[{user_id:'friend-peer',friend_id:'friend-chat',full_name:'Accepted Friend',status:'accepted'},{user_id:'blocked-peer',friend_id:'blocked-chat',full_name:'Blocked Friend',status:'blocked'},{user_id:'pending-peer',friend_id:'pending-chat',full_name:'Pending Friend',status:'pending'}],error:null};
      if(name==='get_public_listing_detail')return {data:{id:'shared-home',title:'Shared home',sub_type:'long_stay',city:'Lafia',state:'Nasarawa',images:[]},error:null};
      if(name==='get_public_hotel_detail')return {data:{hotel_id:42,name:'Shared hotel',city:'Lafia',state:'Nasarawa',images:[]},error:null};
    }

    if(mode.startsWith('service-activity-')&&name==='admin_get_my_branch_worker_bookings')return {data:mode==='service-activity-missing'&&!state.recover?[]:[{id:'linked-job',booking_code:'WH-LINKED'}],error:null};
    if(mode.startsWith('service-activity-')&&name==='admin_get_my_branch_worker_booking_summaries')return {data:[{booking_code:'WH-OTHER',service_type:'Unrelated booking',status:'confirmed',updated_at:now},{booking_code:'WH-LINKED',service_type:'Linked plumbing visit',status:'confirmed',worker_name:'Test professional',customer_name:'Test customer',updated_at:now}],error:mode==='service-activity-error'&&!state.recover?{message:'Unavailable'}:null};

    if(name==='get_my_property_booking_review'){
      if(mode==='property-review-read-error'&&!state.recover)return{data:null,error:{message:'Review unavailable'}};
      return{data:{reservation_id:args.p_reservation_id,stay_type:mode==='property-review-short'?'short_let':'long_stay',eligible:!propertyReview&&mode!=='property-review-ineligible',review:propertyReview},error:null};
    }
    if(name==='submit_my_property_booking_review'){
      state.rpcCalls.push({name,args});const row={review_id:'fixture-review',reservation_id:args.p_reservation_id,rating:args.p_rating,comment:args.p_comment,created_at:now};
      if(mode==='property-review-wrong-receipt'&&!state.recover)return{data:{...row,reservation_id:'wrong-booking'},error:null};
      propertyReview=row;return{data:row,error:null};
    }

    if(name==='get_experience_activity_photos')return{data:activityPhotoRows.filter(row=>row.status!=='archived').map(row=>({...row})),error:null};
    if(name==='begin_experience_activity_photo'){
      state.rpcCalls.push({name,args});const old=activityPhotoRows.find(row=>row.id===args.p_photo_id);if(old)return{data:{...old},error:null};
      const row={id:args.p_photo_id,activity_id:args.p_activity_id,revision:1,object_path:args.p_activity_id+'/'+args.p_photo_id+'.jpg',byte_size:args.p_byte_size,caption:args.p_caption,context_current:true,status:'uploading'};activityPhotoRows.push(row);return{data:{...row},error:null};
    }
    if(name==='finish_experience_activity_photo'){
      const row=activityPhotoRows.find(row=>row.id===args.p_photo_id);Object.assign(row,{status:'submitted',revision:2});
      if(mode.includes('photo-lost')&&!state.recover)throw Error('Failed to fetch');return{data:row,error:null};
    }
    if(name==='change_experience_activity_photo'){
      const row=activityPhotoRows.find(row=>row.id===args.p_photo_id);Object.assign(row,{revision:args.p_expected_revision+1,status:args.p_action==='archive'?'archived':args.p_action==='refresh_context'?'submitted':args.p_action,review_note:args.p_note});return{data:row,error:null};
    }
    if(name==='get_experience_evidence_review')return{data:{...activityEvidence,can_review:activityEvidence.can_review&&experienceRows[0]?.status!=='approved',can_submit:activityEvidence.can_submit&&experienceRows[0]?.status!=='approved'},error:null};
    if(name==='configure_experience_evidence_requirements'){
      activityEvidence={...activityEvidence,configured:true,revision:activityEvidence.revision+1,requirements:args.p_requirements,requirements_note:args.p_note,context_current:true,ready:args.p_requirements.length===0};
      return{data:{success:true,revision:activityEvidence.revision},error:null};
    }
    if(name==='begin_experience_evidence_upload'){
      state.rpcCalls.push({name,args});const existing=activityEvidence.documents.find((d:any)=>d.id===args.p_request_key);if(existing)return{data:existing,error:null};
      const row={id:args.p_request_key,request_id:args.p_activity_id,requirement_code:args.p_requirement_code,requirements_revision:activityEvidence.revision,version:1,original_name:args.p_original_name,mime_type:args.p_mime_type,byte_size:args.p_byte_size,object_path:args.p_activity_id+'/'+args.p_request_key+'.pdf',status:'uploading',submitted_at:null};activityEvidence.documents=[row];return{data:row,error:null};
    }
    if(name==='finish_experience_evidence_upload'){
      const row=activityEvidence.documents.find((d:any)=>d.id===args.p_document_id);Object.assign(row,{status:args.p_discard?'abandoned':'submitted',submitted_at:now});return{data:row,error:null};
    }
    if(name==='get_my_experience_sessions'||name==='get_experience_review_sessions'){
      if(mode==='experience-sessions-read-error'&&!state.recover)return{data:null,error:{message:'Sessions unavailable'}};
      if(name==='get_experience_review_sessions')return{data:[{id:'10000000-0000-4000-8000-000000000002',activity_id:args.p_activity_id,revision:1,activity_revision:(experienceRows[0]?.approved_from_revision||args.p_expected_revision)-1,starts_at:'2040-01-01T10:00:00Z',ends_at:'2040-01-01T11:00:00Z',timezone:'Africa/Lagos',capacity:8,price_minor:250000,currency:'NGN',status:'draft'}],error:null};
      return{data:experienceSessionRows,error:null};
    }
    if(name==='save_my_experience_session'){
      state.rpcCalls.push({name,args});
      const row={id:args.p_session_id,activity_id:args.p_activity_id,revision:args.p_expected_revision+1,activity_revision:args.p_activity_revision,starts_at:args.p_starts_at,ends_at:new Date(Date.parse(args.p_starts_at)+3600000).toISOString(),timezone:'Africa/Lagos',capacity:args.p_capacity,price_minor:args.p_price_minor,currency:args.p_currency,status:'draft'};
      if(mode==='experience-sessions-wrong-receipt'&&!state.recover)return{data:{...row,capacity:1},error:null};
      experienceSessionRows=[row,...experienceSessionRows.filter(item=>item.id!==row.id)];return{data:row,error:null};
    }
    if(name==='archive_my_experience_session'){
      if(mode==='experience-sessions-archive-error'&&!state.recover)return{data:null,error:{message:'Archive unavailable'}};
      const row=experienceSessionRows.find(item=>item.id===args.p_session_id);experienceSessionRows=experienceSessionRows.filter(item=>item.id!==row.id);return{data:{...row,status:'archived',revision:row.revision+1},error:null};
    }

    if(name==='get_property_site_offers'){
      state.rpcCalls.push({name,args});
      if(mode==='site-offers-error'&&!state.recover)return{data:null,error:{message:'Other homes temporarily unavailable'}};
      if(mode==='site-offers-malformed'&&!state.recover)return{data:{},error:null};
      const id=args.p_after_id?'site-flat-b':'site-flat-a';
      const items=mode==='site-offers-empty'||mode==='site-offers-ungrouped'?[]:[{id,title:'Compound apartment',space_label:args.p_after_id?'Flat B':'Flat A',price:25000,currency:'NGN',bedrooms:0,sub_type:args.p_stay_type||'short_let',space_scope:'entire_unit',home_style:'apartment',unit_id:id}];
      const more=mode==='site-offers-paging'&&!args.p_after_id;
      return{data:{listing_id:args.p_listing_id,grouped:mode!=='site-offers-ungrouped',items,has_more:more,next_id:more?id:null},error:null};
    }

    if(mode.startsWith('hotel-discount-')){
      state.rpcCalls.push({name,args});
      if(name==='partner_list_hotel_discounts'){
        if(mode==='hotel-discount-read-error'&&!state.recover)throw Error('Hotel discount read unavailable');
        return{data:hotelDiscountRows,error:null};
      }
      if(mode==='hotel-discount-write-error'&&!state.recover)throw Error('Hotel discount write unavailable');
      if(name==='partner_set_hotel_discount'){hotelDiscountRows=[{id:'discount-receipt',room_id:null,rate_plan_id:null,percent:args.p_percent,starts_on:'2026-10-23',ends_on:null,funded_by:'host'}];return{data:'discount-receipt',error:null};}
      if(name==='partner_clear_hotel_discount'){hotelDiscountRows=[];return{data:null,error:null};}
    }
    if(mode.startsWith('building-schedule-')){
      state.rpcCalls.push({name,args});
      if(mode==='building-schedule-error'&&!state.recover)throw Error('Schedule unavailable');
      const items=mode==='building-schedule-empty'?[]:[{listing_id:args.p_after_id?'home-b':'home-a',title:'Compound home',space_label:args.p_after_id?'Flat B':'Flat A',space_scope:'entire_unit',sub_type:args.p_after_id?'long_stay':'short_let',events:args.p_after_id?[{event_id:'stay-b',kind:'stay',status:'occupied',starts_on:null,ends_on:null}]:[{event_id:'block-a',kind:'closure',status:'closed',starts_on:args.p_from,ends_on:args.p_until}],events_truncated:false}];
      return{data:{site_id:args.p_site_id,from:args.p_from,until:args.p_until,items,has_more:mode==='building-schedule-paging'&&!args.p_after_id,next_id:'home-a'},error:null};
    }
    if(mode.startsWith('hosting-controls-')){
      state.rpcCalls.push({name,args});
      if(name==='listing_discount_breakdown')return{data:{total_percent:0,host_percent:0,wehouse_percent:0,ends_on:null},error:null};
      if(name==='get_my_property_host_controls'&&mode==='hosting-controls-read-error'&&!state.recover)throw Error('Read unavailable');
      if(name!=='get_my_property_host_controls'){
        if(mode==='hosting-controls-write-error'&&!state.recover)throw Error('Write receipt unavailable');
        if(name==='set_my_property_booking_availability')hostControlsAccepting=args.p_accepting;
        if(name==='set_my_property_future_price')hostControlsPrice=args.p_price;
      }
      return{data:{listing_id:mode==='hosting-controls-wrong-receipt'&&name!=='get_my_property_host_controls'?'another-home':'host-control-home',sub_type:'short_let',price:hostControlsPrice,currency:mode==='hosting-controls-usd'?'USD':'NGN',status:'available',availability_status:'available',host_booking_paused:!hostControlsAccepting,accepting_reservations:hostControlsAccepting,can_manage_commercials:true,date_blocks:[]},error:null};
    }
    if(mode==='space-review-field'&&name==='get_my_inspections')return{data:[{id:'10100000-0000-4000-8000-000000000071',_source:'partner',status:'pending',property_address:'12 Test Road',property_city:'Lafia',property_state:'Nasarawa',owner_name:'Test owner',space_scope:'private_room',space_label:'Home B / Room 1',shared_areas:['Kitchen','Entrance'],photo_urls:[],video_urls:[]}],error:null};
    if(mode.startsWith('hotel-cancel-')){
      state.rpcCalls.push({name,args});
      if(name==='cancel_my_hotel_booking'){
        if(mode==='hotel-cancel-write-error'&&!state.recover)return{data:null,error:{message:'Cancellation unavailable'}};
        hotelCancelled=true;if(mode==='hotel-cancel-lost')throw Error('Lost cancellation response');return{data:true,error:null};
      }
      if(name==='get_my_hotel_cancellation_preview'){
        if(mode==='hotel-cancel-read-error'&&!state.recover)return{data:null,error:{message:'Preview unavailable'}};
        if(mode==='hotel-cancel-malformed'&&!state.recover)return{data:{},error:null};
        return{data:hotelCancelled?{booking_id:71,kind:'already_cancelled',can_cancel:false,message:'This booking is cancelled',refund_status:'provider_pending'}:mode==='hotel-cancel-review'?{booking_id:71,kind:'review_required',can_cancel:false,message:'This booking requires WeHouse cancellation review'}:{booking_id:71,kind:'full_refund',can_cancel:true,message:'Cancel the stay and request a refund to the original payment method',currency:'NGN',refund_amount_ngn:40000,fee_ngn:0,deadline:'2027-10-20T13:00:00Z',timezone:'Africa/Lagos'},error:null};
      }
      throw Error('Unexpected Hotel cancellation fixture RPC: '+name);
    }
    if(name==='get_my_property_partner_stays'&&mode.startsWith('partner-stays-history')){
      state.rpcCalls.push({name,args});
      const historyState=mode.split('history-')[1]||'';
      const row=(id:string)=>({reservation_id:id,created_at:id==='old-stay'?null:'2026-01-01T10:00:00.123456+00:00',page_created_at:id==='old-stay'?'1970-01-01T00:00:00Z':'2026-01-01T10:00:00.123456+00:00',status:id==='old-stay'&&historyState==='fee-only'?'reserved':id==='old-stay'&&['cancelled','expired','refunded','payment_conflict'].includes(historyState)?historyState:'completed',stay_type:id==='old-stay'&&!mode.endsWith('linked')?'long_stay':'short_let',management_mode_snapshot:'host',payment_status:id==='old-stay'&&historyState==='refunded'?'refunded':id==='old-stay'&&historyState==='fee-only'?'not_started':'paid',manual_payment_status:'paid',reservation_fee_status:'paid',check_in:'2026-01-10',check_out:'2026-01-11',guest_count:id==='old-stay'?3:1,occupant_count:id==='old-stay'?3:1,payer_count:id==='old-stay'?2:1,booked_by_name:id==='old-stay'?'Amina Yusuf':null,tenancy_start_date:id==='old-stay'&&historyState==='fee-only'?null:'2026-01-10',tenancy_end_date:id==='old-stay'&&historyState==='fee-only'?null:'2027-01-10'});
      if(args.p_reservation_id)return{data:[row('old-stay')],error:null};
      if(args.p_before_id){if(mode==='partner-stays-history-error'&&!state.recover)return{data:null,error:{message:'Older history unavailable'}};return{data:[row('stay-1'),row('old-stay')],error:null};}
      return{data:Array.from({length:51},(_,i)=>row('stay-'+(51-i))),error:null};
    }
    if(name==='get_my_property_partner_stays')return{data:mode==='partner-stays-malformed'&&!state.recover?{}:[],error:mode==='partner-stays-error'&&!state.recover?{message:'Reservations unavailable'}:null};
    if(name==='get_my_property_assets_page'){
      state.rpcCalls.push({name,args});
      if(mode==='partner-assets-error'&&!state.recover)return{data:null,error:{message:'Properties unavailable'}};
      if(mode==='partner-assets-malformed'&&!state.recover)return{data:{},error:null};
      if(mode==='partner-assets-bad-row'&&!state.recover)return{data:[{id:'bad',price:0,currency:'NGN'}],error:null};
      if(mode==='partner-assets-grouped')return{data:[
        {id:'10100000-0000-4000-8000-000000000063',title:'Home A',site_id:'10100000-0000-4000-8000-000000000061',site_label:'Lafia compound',space_label:'Home A',space_scope:'entire_unit',sub_type:'long_stay',bedrooms:0,price:600000,currency:'NGN',created_at:now,status:'available'},
        {id:'10100000-0000-4000-8000-000000000064',title:'Home B',site_id:'10100000-0000-4000-8000-000000000061',site_label:'Lafia compound',space_label:'Home B',space_scope:'entire_unit',sub_type:'long_stay',bedrooms:5,price:600000,currency:'NGN',created_at:now,status:'available'},
        {id:'10100000-0000-4000-8000-000000000065',title:'Home C',site_id:'10100000-0000-4000-8000-000000000061',site_label:'Lafia compound',space_label:'Home C',space_scope:'entire_unit',sub_type:'short_let',price:20000,currency:'NGN',created_at:now,status:'available'},
        {id:'10100000-0000-4000-8000-000000000066',title:'Separate home',site_label:'Lafia compound',price:600000,currency:'NGN',created_at:now,status:'available'},
      ],error:null};
      return{data:[{id:'10100000-0000-4000-8000-000000000063',listing_id:'HOME-QA',title:'Compound home',site_label:'Lafia compound',space_label:'Home A / Room 1',space_scope:'private_room',shared_areas:['Kitchen','Entrance'],status:'available',availability_status:'available',created_at:now,_assignment_role:'owner',price:mode==='partner-assets-price-unavailable'?null:600000,currency:mode==='partner-assets-currency'?'USD':'NGN'}],error:null};
    }
    if(mode.startsWith('property-spaces-')){
      state.rpcCalls.push({name,args});
      if(name!=='get_my_property_space_options')throw Error('Unexpected property fixture RPC: '+name);
      if(mode==='property-spaces-new')return{data:[],error:null};
      if(mode==='property-spaces-recovery'&&!state.recover)return{data:null,error:{message:'Saved properties unavailable'}};
      const siteId='10100000-0000-4000-8000-000000000062';
      if(args.p_parent_id==='10100000-0000-4000-8000-000000000063')return{data:[{id:'10100000-0000-4000-8000-000000000064',parent_id:args.p_parent_id,kind:'private_room',label:'Room 1',layout_name:null,address:null,city:null,state:null,shared_areas:['Kitchen','Entrance']}],error:null};
      return{data:args.p_parent_id?[{id:'10100000-0000-4000-8000-000000000063',parent_id:siteId,kind:'unit',label:'Home A',layout_name:'Bungalow',address:null,city:null,state:null}]:[{id:siteId,parent_id:null,kind:'site',label:'Saved compound',layout_name:null,address:'12 Test Road',city:'Lafia',state:'Nasarawa'}],error:null};
    }
    if(mode.startsWith('private-call')){
      state.rpcCalls.push({name,args});
      if(name==='get_my_private_call_preferences')return{data:{allow_audio_calls:true,allow_video_calls:true},error:null};
      if(name==='get_my_active_private_calls')return{data:['ringing','accepted'].includes(privateCallStatus)?[privateCall()]:[],error:null};
      if(name==='get_private_call_details')return{data:privateCall(),error:null};
      if(name==='respond_private_call'){privateCallStatus=args.p_accept?'accepted':'declined';return{data:privateCall(),error:null};}
      if(name==='end_private_call'){privateCallStatus='ended';return{data:privateCall(),error:null};}
      throw Error('Unexpected private-call fixture RPC: '+name);
    }
    if(mode.startsWith('experience-applications')){
      state.rpcCalls.push({name,args});
      if(name==='get_experience_categories')return mode.includes('category-error')&&!state.recover?{data:null,error:{message:'Synthetic category failure'}}:{data:[{code:'culture_tours',name:'Culture and local tours',description:'Guided activities to understand a place.',examples:['Campus orientation walks']}],error:null};
      if(name==='get_experience_approval_readiness'){
        const row=experienceRows.find(row=>row.id===args.p_activity_id);const ready=mode.includes('approval-')&&!mode.includes('blocked');
        return{data:{activity_id:args.p_activity_id,revision:row.revision,checks:{details:ready,provider_access:ready,identity:ready,evidence:ready,photos:ready,sessions:ready},can_approve:ready&&row.status==='submitted'},error:null};
      }
      if(name==='approve_experience_activity'){
        const row=experienceRows.find(row=>row.id===args.p_activity_id);
        if(mode.includes('approval-error')&&!state.recover)throw Error('Synthetic approval failure');
        if(row.status!=='approved')Object.assign(row,{status:'approved',revision:args.p_expected_revision+1,approved_from_revision:args.p_expected_revision,approved_by:'fixture-independent-creator',approved_at:now,approval_note:args.p_note});
        if(mode.includes('approval-lost')&&!state.recover)throw Error('Synthetic lost approval response');
        return{data:{...row},error:null};
      }
      if(name==='get_my_experience_activities')return{data:experienceRows,error:null};
      if(name==='get_experience_activity_review_queue')return{data:experienceRows.filter(row=>row.status==='submitted'),error:null};
      if(name==='request_experience_activity_changes'){if(mode.endsWith('review-error')&&!state.recover)return{data:null,error:{message:'Synthetic review failure'}};const row=experienceRows.find(item=>item.id===args.p_activity_id);row.status=args.p_decision;row.revision+=1;return{data:row,error:null};}
      if(name==='get_experience_activity')return mode.includes('linked')&&!state.recover?{data:null,error:{message:'Synthetic linked application failure'}}:{data:experienceRows.find(row=>row.id===args.p_activity_id),error:null};
      if(name==='get_experience_activity_history')return{data:[],error:null};
      if(name==='save_my_experience_activity'){
        let row=experienceRows.find(item=>item.id===args.p_activity_id);
        if(!row){row={id:args.p_activity_id,host_user_id:'wallet-qa-owner',revision:1,status:'draft',details:args.p_details,created_at:now,updated_at:now};experienceRows=[row,...experienceRows];}
        else if(JSON.stringify(row.details)!==JSON.stringify(args.p_details)){row={...row,details:args.p_details,revision:row.revision+1};experienceRows=experienceRows.map(item=>item.id===row.id?row:item);}
        return mode.includes('missing-save')&&!state.recover?{data:null,error:null}:{data:{activity:row,issues:[]},error:null};
      }
      if(name==='transition_my_experience_activity'){
        const row=experienceRows.find(item=>item.id===args.p_activity_id);row.status={submit:'submitted',withdraw:'withdrawn',archive:'archived'}[args.p_action as string];row.revision+=1;return{data:row,error:null};
      }
    }
    state.rpcCalls.push({ name, args });
    if(mode.startsWith('worker-profile-') && name==='get_my_worker_activation') {
      if(mode==='worker-profile-read-error'&&!state.recover)throw Error('Synthetic profile read failure');
      return{data:mode==='worker-profile-malformed'&&!state.recover?{live:'yes'}:{worker_status:'verified',reviewed:true,live:mode==='worker-profile-live'},error:null};
    }
    if(mode.startsWith('worker-profile-') && name==='get_worker_marketplace_trust')return{data:{reviewed:true,trusted:false,completed_jobs:7,review_count:0,rating:0},error:null};
    if(name==='get_worker_credential_review'){
      if(mode==='credentials-read-error'&&!state.recover)throw Error('Synthetic credential read failure');
      const value=credentialState();return{data:{...value,service_context:{occupation:'Electrician',country:'Nigeria',state:'Lagos',skills:['Electrical repairs'],coverage:[{state:'Lagos',lga:'Ikeja'}]},ready:value.configured&&value.context_current&&value.requirements.every((rule:any)=>value.documents.some((doc:any)=>doc.requirement_code===rule.code&&doc.status==='approved')),can_review:Boolean((window as any).__credentialOperator),can_submit:!(window as any).__credentialOperator&&value.configured&&value.context_current},error:null};
    }
    if(name==='configure_worker_credential_requirements'){const value=credentialState();Object.assign(value,{configured:true,revision:value.revision+1,requirements:args.p_requirements,requirements_note:args.p_note,context_current:true});saveCredentialState(value);return{data:{success:true,revision:value.revision},error:null};}
    if(name==='begin_worker_credential_upload'){
      if(mode==='credentials-submit-error'&&!state.recover)throw Error('Synthetic credential reservation failure');
      const value=credentialState(),doc={id:args.p_request_key,request_id:args.p_worker_id,worker_id:args.p_worker_id,requirement_code:args.p_requirement_code,original_name:args.p_original_name,mime_type:args.p_mime_type,byte_size:args.p_byte_size,requirements_revision:value.revision,version:1,object_path:`${args.p_worker_id}/${args.p_request_key}.pdf`,status:'uploading',submitted_at:null,expires_at:null};
      const existing=value.documents.find((item:any)=>item.id===doc.id);if(existing)return{data:existing,error:null};value.documents=value.documents.filter((item:any)=>item.requirement_code!==doc.requirement_code);value.documents.push(doc);saveCredentialState(value);return{data:doc,error:null};
    }
    if(name==='finish_worker_credential_upload'){const value=credentialState(),doc=value.documents.find((item:any)=>item.id===args.p_document_id);doc.status=args.p_discard?'abandoned':'submitted';doc.submitted_at=now;saveCredentialState(value);return{data:doc,error:null};}
    if(name==='review_worker_credential'){
      if(mode==='credentials-review-error'&&!state.recover)throw Error('Synthetic credential review failure');
      const value=credentialState(),doc=value.documents.find((item:any)=>item.id===args.p_document_id);Object.assign(doc,{status:args.p_decision,review_note:args.p_note,expires_at:args.p_expires_at});saveCredentialState(value);return{data:doc,error:null};
    }
    if(['get_my_legal_status','get_current_legal_documents'].includes(name))return{data:null,error:null};
    if(name==='get_my_announcement_inbox')return{data:[],error:null};
    if(name==='get_my_canonical_activity_v2'&&mode==='activity-partial-failure'&&state.failActivity)return{data:null,error:{message:'Activity temporarily unavailable'}};
    if(name==='get_my_canonical_activity_v2')return{data:mode.startsWith('activity-')?[{id:'activity-1',type:'saved_search_match',title:'A new home matches your search',message:'Lafia home',read:activityRead,created_at:now,source_type:'listing',source_id:'home-1',destination_route:'detail',destination_params:{listingId:'home-1'},workspace:'personal',action_required:false,resolved_at:null}]:[],error:null};
    if(name==='mark_my_canonical_activity_read')return{data:mode==='activity-missing-receipt'&&!state.recover?false:(activityRead=true),error:null};
    if(name==='mark_all_my_canonical_activity_read'){if(mode==='activity-missing-receipt'&&!state.recover)return{data:null,error:null};activityRead=true;return{data:1,error:null};}
    if(name==='get_my_pending_device_login_alert')return{data:{notificationId:'login-notice',sessionId:'other-session',device:'Windows laptop',os:'Windows',browser:'Edge',loginTime:now},error:null};
    if(name==='review_new_device_login')return mode==='login-notice-malformed'&&!state.recover?{data:{},error:null}:{data:{session_id:args.p_session_id,decision:args.p_was_me?'recognized':'terminated'},error:null};
    if(name==='list_my_friends')return{data:[],error:null};
    if(name==='preview_friend_recipient')return mode==='friends-preview-error'&&!state.recover?{data:{error:'Synthetic lookup failure'},error:null}:{data:{user_id:'confirmed-friend',username:args.p_username,full_name:'Confirmed Friend'},error:null};
    if(name==='send_friend_request')return{data:{id:'friend-receipt',status:'pending'},error:null};
    if(['host_confirm_short_stay_check_in','host_confirm_long_let_handover'].includes(name)){
      if(args.p_reservation_id!=='arrival-booking')throw Error('Wrong reservation target');
      if(!state.recover)throw Error('Synthetic arrival failure');
      return{data:mode.endsWith('malformed')?{id:'another-booking',status:'occupied'}:{id:'arrival-booking',status:'occupied',occupancy_started_at:now},error:null};
    }
    if(name==='get_my_property_management'){
      if(!state.recover&&mode==='management-read-error')throw Error('Synthetic management read failure');
      if(!state.recover&&mode==='management-timeout')return never();
      if(!state.recover&&mode==='management-malformed')return{data:{listing_id:'other-home',assignments:[]},error:null};
      return{data:managementState(),error:null};
    }
    if(name==='set_my_property_management_mode'){
      if(!state.recover&&mode==='management-mutation-error')throw Error('Synthetic management mutation failure');
      managementConfigured=true;return{data:managementState(),error:null};
    }
    if(name==='create_property_cohost_invitation'){
      if(mode==='management-invite-receipt')return{data:null,error:null};
      return{data:{invitation_id:'sent-invitation',status:'pending',delivery:'direct'},error:null};
    }
    if(name==='get_my_resource_invitations'){
      if(!state.recover&&mode==='management-invitations-error')throw Error('Synthetic invitation read failure');
      return{data:invitationWithdrawn||!['management-invitations-error','management-withdraw-error'].includes(mode)?[]:[{invitation_id:'pending-invitation',status:'pending',role_key:'property_cohost',permission_profile:'operations',delivery:'direct',recipient_name:'Pending co-host',expires_at:'2027-01-01T00:00:00Z',created_at:now}],error:null};
    }
    if(name==='revoke_resource_invitation'){
      if(!state.recover&&mode==='management-withdraw-error')throw Error('Synthetic withdrawal failure');
      invitationWithdrawn=true;return{data:true,error:null};
    }
    if(name==='get_property_document_review'){
      if(mode==='documents-read-error'&&!state.recover)throw Error('Synthetic document read failure');
      const value=docState();return{data:{...value,requirements:docRules,ready:docRules.every(rule=>value.documents.some((doc:any)=>doc.requirement_code===rule.code&&doc.status==='approved')),can_review:Boolean((window as any).__documentOperator),can_submit:!(window as any).__documentOperator&&value.configured},error:null};
    }
    if(name==='configure_property_document_requirements'){const value=docState();value.configured=true;value.revision++;value.requirements_note=args.p_note;saveDocState(value);return{data:{success:true,revision:value.revision},error:null};}
    if(name==='begin_property_document_upload'){
      if(mode==='documents-submit-error'&&!state.recover)throw Error('Synthetic document reservation failure');
      const value=docState();const doc={id:args.p_request_key,request_id:args.p_request_id,requirement_code:args.p_requirement_code,original_name:args.p_original_name,mime_type:args.p_mime_type,byte_size:args.p_byte_size,requirements_revision:value.revision,version:1,object_path:`document-request/${args.p_request_key}.pdf`,status:'uploading',submitted_at:null,expires_at:null};
      const existing=value.documents.find((item:any)=>item.id===doc.id);if(existing)return{data:existing,error:null};
      value.documents=value.documents.filter((item:any)=>item.requirement_code!==doc.requirement_code);value.documents.push(doc);saveDocState(value);return{data:doc,error:null};
    }
    if(name==='finish_property_document_upload'){
      const value=docState();const doc=value.documents.find((item:any)=>item.id===args.p_document_id);doc.status=args.p_discard?'abandoned':'submitted';doc.submitted_at=now;saveDocState(value);
      if(mode==='documents-lost-confirmation'&&!state.recover)throw Error('Synthetic lost submission response');return{data:doc,error:null};
    }
    if(name==='review_property_document'){
      if(mode==='documents-review-error'&&!state.recover)throw Error('Synthetic document review failure');
      const value=docState();const doc=value.documents.find((item:any)=>item.id===args.p_document_id);Object.assign(doc,{status:args.p_decision,review_note:args.p_note,expires_at:args.p_expires_at});saveDocState(value);return{data:doc,error:null};
    }
    if(name==='report_hotel'||name==='report_content') {
      if(mode==='reports-generic-throw'&&!state.recover)throw new Error('Synthetic report connection failure');
      if(mode==='reports-generic-no-receipt'&&!state.recover)return{data:null,error:null};
      if(mode==='reports-submit-error'&&!state.recover)return{data:null,error:{message:'Synthetic report failure'}};
      if(mode==='reports-no-receipt'&&!state.recover)return{data:null,error:null};
      const rows=reports();
      if(!rows.length){rows.push({id:reportId,report_id:reportId,subject_type:name==='report_hotel'?'hotel':'profile',subject_ref:name==='report_hotel'?'42':null,subject_user_id:'qa-owner',reason:args.p_reason,details:args.p_details,status:'open',created_at:now,resolved_at:null});localStorage.setItem('qa-hotel-reports',JSON.stringify(rows));}
      return{data:reportId,error:null};
    }
    if(name==='admin_list_content_reports') {
      if(mode==='reports-queue-error'&&!state.recover)throw new Error('Synthetic queue failure');
      return{data:reports().filter((row:any)=>row.status===args.p_status),error:null};
    }
    if(name==='admin_resolve_content_report') {
      const rows=reports();const row=rows.find((item:any)=>item.id===args.p_report_id);
      if(row){row.status=args.p_status;row.resolution_note=args.p_note;row.resolved_at=args.p_status==='reviewing'?null:now;localStorage.setItem('qa-hotel-reports',JSON.stringify(rows));}
      return{data:null,error:null};
    }
    if(name==='list_my_content_reports')return{data:reports(),error:null};
    if (name === 'get_my_staff_finance_queue') {
      if (['finance-read-error','finance-summary-error'].includes(mode) && !state.recover) throw new Error('Synthetic finance queue failure');
      if (['finance-malformed','finance-summary-malformed'].includes(mode) && !state.recover) return { data: {}, error: null };
      return { data: { actor_role:'staff', payments:[],commissions:[],payment_protection:[],audit:[], withdrawals: [{ id: 'finance-withdrawal', owner_name: 'Test Owner', amount: 5000, status: state.recover ? 'processing' : 'awaiting_review' }], refunds: [], financial_actions: (mode.startsWith('finance-recovery')||mode.startsWith('finance-summary'))&&!refundResolved?[{id:'recovery-action-reference',action_type:'refund_hotel_cancellation',subject_type:'hotel',subject_id:'123',amount:5000,status:'manual_review',provider_action_id:mode.endsWith('unbound')?null:'42',last_error:'Processing interrupted; reconcile the original provider outcome before any retry'}]:[] }, error: null };
    }
    if (name === 'get_my_property_partner_finance') {
      if(mode.includes('wallet-malformed')&&!state.recover)return{data:{...wallet,wallet_id:wallet.id,available_balance:null},error:null};
      if (mode.includes('read-error') && !state.recover) throw new Error('Synthetic finance failure');
      return { data: { ...wallet, wallet_id: wallet.id, long_let_commission_rate: 5, short_let_commission_rate: 10, hotel_commission_rate: 12, minimum_withdrawal: 100 }, error: null };
    }
    if (name === 'request_my_wallet_withdrawal') {
      const receipts = saved();
      const existing = receipts[args.p_request_id];
      if (existing && mode.includes('retry-denied') && !state.recover) return { data: null, error: { code: '42501', message: 'Confirm your session' } };
      if (existing) return { data: { success: true, request_id: existing.id, status: 'paid', replayed: true }, error: null };
      const receipt = { id: args.p_request_id, amount: args.p_amount, status: 'awaiting_review', created_at: now };
      receipts[args.p_request_id] = receipt;
      localStorage.setItem('qa-wallet-receipts', JSON.stringify(receipts));
      if (mode.includes('lost-response')) return never();
      return { data: { success: true, request_id: receipt.id, status: receipt.status }, error: null };
    }
    if (name === 'get_my_worker_pro') {
      if (mode === 'worker-pro-timeout' && !state.recover) return never();
      if (mode === 'worker-pro-rejected' && !state.recover) throw new Error('Synthetic worker plan failure');
      return { data: { ...plan, active: ['worker-pro-active','worker-pro-reminder'].includes(mode), provider: 'paystack', features: [], plans: [] }, error: null };
    }
    if (name === 'get_my_worker_work_insights') return { data: { completed_jobs: 1, released_earnings_ngn: 25000, active_jobs: 1, review_count: 0, repeat_customers: 0, worker_cancelled_jobs: 0, definitions: {}, generated_at: now }, error: null };
    if(name==='save_my_worker_pro_reminder'&&mode==='worker-pro-reminder'){if(state.failReminderReceipt)return{data:null,error:null};reminderDone=args.p_done===true;return{data:'reminder-id',error:null};}
    if (name === 'get_my_worker_pro_business') return { data: { schedule: [], customers: [], packages: [], reminders: mode==='worker-pro-reminder'?[{id:'reminder-id',booking_id:'reminder-booking',note:'Bring the supplies',due_at:now,done_at:reminderDone?now:null}]:[], receipts: [] }, error: null };
    if (name === 'get_my_worker_pro_job_costs') return { data: [{ id: '10100000-0000-4000-8000-000000000051', booking_code: 'JOB-51', service_type: 'Cleaning', scheduled_date: '2026-10-19', status: 'approved_released', released_earnings_ngn: 25000, cost_ngn: cost, note: 'Materials' }], error: null };
    if (name === 'save_my_worker_pro_job_cost') {
      if (!('p_amount' in args)) throw new Error('Cost RPC parameter does not match the database');
      cost = args.p_amount; return { data: true, error: null };
    }
    if (name === 'get_my_worker_work_documents') return { data: [], error: null };
    if(name==='get_my_property_arrival_instructions') {
      if(mode==='arrival-read-error'&&!state.recover)throw Error('Synthetic read failure');
      return {data:localStorage.getItem('qa-arrival-instructions')||'',error:null};
    }
    if(name==='save_my_property_arrival_instructions') {
      localStorage.setItem('qa-arrival-instructions',args.p_instructions);
      if(mode==='arrival-lost-response'&&!state.recover)throw Error('Synthetic lost save confirmation');
      return {data:true,error:null};
    }
    if (name === 'get_my_partner_pro') {
      if (mode === 'partner-pro-timeout' && !state.recover) return never();
      if (mode === 'partner-pro-rejected' && !state.recover) throw new Error('Synthetic partner plan failure');
      return { data: { ...plan, active: mode !== 'partner-pro-offer' }, error: null };
    }
    if (name === 'get_my_partner_pro_overview') {
      if (mode === 'portfolio-timeout' && !state.recover) return never();
      return { data: { assets: [{ kind: 'hotel', id: '42', title: 'Test Hotel' }], stays: [], income: [], tasks: [...tasks], stays_limited: false, tasks_limited: false }, error: null };
    }
    if(name==='get_my_partner_operating_report'){
      if(mode==='partner-pro-cost-read-error'&&!state.recover)throw Error('Synthetic cost report failure');
      const rows=JSON.parse(localStorage.getItem('qa-operating-costs')||'[]').filter((row:any)=>!row.voided_at);const total=rows.reduce((sum:number,row:any)=>sum+row.amount_ngn,0);const mixed=mode==='partner-pro-cost-mixed';
      return{data:{month:args.p_month,currency:'NGN',reporting_timezone:'UTC',costs:rows,cost_count:rows.length,recorded_costs_ngn:total,released_income_ngn:mixed?null:50000,recorded_margin_ngn:mixed?null:50000-total,mixed_currency:mixed,unattributed_earnings:0,next_before_on:null,next_before_id:null},error:null};
    }
    if(name==='record_my_partner_operating_cost'){
      const rows=JSON.parse(localStorage.getItem('qa-operating-costs')||'[]');let row=rows.find((item:any)=>item.id===args.p_request_key);
      if(!row){row={id:args.p_request_key,asset_kind:args.p_kind,asset_id:args.p_asset_id,category:args.p_category,title:args.p_title,amount_ngn:args.p_amount_ngn,incurred_on:args.p_incurred_on,voided_at:null};rows.push(row);localStorage.setItem('qa-operating-costs',JSON.stringify(rows));if(mode==='partner-pro-cost-lost-response'&&!state.recover)throw Error('Synthetic lost cost confirmation');}
      return{data:row,error:null};
    }
    if(name==='void_my_partner_operating_cost'){
      const rows=JSON.parse(localStorage.getItem('qa-operating-costs')||'[]');const row=rows.find((item:any)=>item.id===args.p_cost_id);row.voided_at=now;row.void_reason=args.p_reason;localStorage.setItem('qa-operating-costs',JSON.stringify(rows));return{data:row,error:null};
    }
    if (name === 'create_my_partner_pro_recurring_task') {
      if (mode === 'partner-pro-task-error' && !state.recover) throw new Error('Synthetic task failure');
      const id = `task-${tasks.length + 1}`;
      tasks.push({ id, asset_kind: args.p_kind, asset_id: args.p_asset_id, title: args.p_title, due_on: args.p_due_on, repeat_days: args.p_repeat_days, status: 'open' });
      return { data: id, error: null };
    }
    throw new Error(`Unexpected fixture RPC: ${name}`);
  },
};
export function useCreatorAuth() { return { requestElevation: (_scope: string, callback: (id: string) => void) => callback('synthetic-browser-elevation') }; }
export async function setWorkerAvailability(workerId:string,available:boolean){
  if(mode==='worker-availability-error'&&!state.recover)throw Error('Synthetic availability failure');
  return{profile:mode==='worker-availability-missing'&&!state.recover?null:{user_id:workerId,available},error:null};
}
export async function getHotelById(hotelId:number){return{hotel:{hotel_id:hotelId,name:'Report Journey Hotel',state:'Lagos',city:'Ikeja',images:[],hotel_rooms:[],amenities:[],location_exact:false},error:null};}
export async function getHotelReviews(){return{reviews:[],eligible:false,error:null};}
export async function getHotelRooms(){return{rooms:[],error:null};}
export async function addHotelReview(){return{error:null};}
export function useDiscoveryLocation(){return{location:null};}
export async function getDiscoveryDistanceMap(){return new Map();}
export function directionsUrl(){return 'https://example.invalid/directions';}
export async function uploadStorageObjectWithProgress(){throw new Error('Uploads are outside this isolated fixture');}

export { createInspectionRequest, createReservation, createShortStayReservation, cancelReservation, getInspectionRequestForReservation, getReservationForListing, initializeReservationPayment } from '../../src/lib/supabase/reservations';
export { getListing } from '../../src/lib/supabase/listings';
export const isWebPasskeyEnabled=false;
