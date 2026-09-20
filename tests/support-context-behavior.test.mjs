import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
const require=createRequire(import.meta.url);
function moduleAt(path, dependencies={}, globals={}) {
  const code=ts.transpileModule(readFileSync(new URL('../'+path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  const exports={};vm.runInNewContext(code,{exports,require:name=>dependencies[name]??require(name),...globals});return exports;
}
const api=moduleAt('src/lib/supabase/support.ts',{'./client':{},'@/lib/propertyBookingLifecycle':{propertyBookingStatusLabel:()=> 'Status unavailable'}});
const dates=moduleAt('src/lib/displayDate.ts');
const topic=id=>({contextType:'hotel_property',contextId:id,contextSnapshot:{hotel_name:id}});
const thread=id=>({conversation_id:'chat-'+id,subject:id,status:'open',context_type:'hotel_property',context_id:id,context_snapshot:{hotel_name:id}});
const tick=()=>new Promise(setImmediate);
test('Property conversation client passes canonical subjects and reads the returned conversation ID',async()=>{
  const calls=[];
  const client=moduleAt('src/lib/supabase/support.ts',{'./client':{supabase:{rpc:async(name,args)=>{calls.push({name,args});return {data:{conversation_id:'saved-'+args.p_subject_id},error:null};}}},'@/lib/propertyBookingLifecycle':{}});
  for(const [contextType,subject] of [['property_listing','listing'],['hotel_property','hotel_property']]) {
    const result=await client.createSupportConversation({contextType,contextId:'record-1',contextSnapshot:{requester_workspace:'personal'}});
    assert.equal(result.conversationId,'saved-record-1');
    assert.equal(calls.at(-1).name,'open_property_operations_conversation');
    assert.equal(calls.at(-1).args.p_subject_type,subject);
    assert.equal(calls.at(-1).args.p_snapshot.requester_workspace,'personal');
  }
});
test('Thread lookup never substitutes a different hotel, booking, workspace or help reason',()=>{
  assert.equal(api.findSupportThread([thread('A')],topic('B')),null);
  assert.equal(api.findSupportThread([thread('A')],{conversationId:'missing'}),null);
  assert.equal(api.findSupportThread([{...thread('A'),context_type:'general',context_id:'workspace:personal'}],{contextType:'general',contextId:'workspace:worker'}),null);
  assert.equal(api.findSupportThread([{...thread('A'),context_type:'contextual_help',context_snapshot:{reason_code:'payment'}}],{contextType:'contextual_help',contextId:'A',contextSnapshot:{reason_code:'arrival'}}),null);
  assert.equal(api.findSupportThread([thread('A')],topic('A')).conversation_id,'chat-A');
});
test('Support previews strip arrival credentials even inside nested attachment metadata',()=>{
  const source={hotel_name:'Hotel A',booking_code:'secret',nested:{check_in_code:'secret',room_name:'Deluxe'},items:[{handover_code:'secret',reference:'public'}]};
  assert.deepEqual(JSON.parse(JSON.stringify(api.sanitizeSupportSnapshot(source))),{hotel_name:'Hotel A',nested:{room_name:'Deluxe'},items:[{reference:'public'}]});
  assert.equal(source.nested.check_in_code,'secret');
});
function harness() {
  let cursor=0;const slots=[],effects=[],listeners=new Map(),requests=[],messageRequests=[],sends=[];
  const same=(a,b)=>a?.length===b?.length&&a.every((v,i)=>Object.is(v,b[i]));
  const react={useState(initial){const i=cursor++;slots[i]??={value:typeof initial==='function'?initial():initial};return[slots[i].value,v=>{slots[i].value=typeof v==='function'?v(slots[i].value):v;}];},useRef(value){const i=cursor++;return slots[i]??={current:value};},useCallback(fn,deps){const i=cursor++;if(!same(slots[i]?.deps,deps))slots[i]={fn,deps};return slots[i].fn;},useEffect(fn,deps){const i=cursor++;if(!same(slots[i]?.deps,deps)){slots[i]?.cleanup?.();slots[i]={deps};effects.push(()=>{slots[i].cleanup=fn();});}}};
  const chain={on(){return this;},subscribe(){return this;}};
  const noop=()=>{};
  const fakeApi={...api,getMySupportConversations:()=>new Promise(resolve=>requests.push(resolve)),getSupportMessages:id=>new Promise(resolve=>messageRequests.push({id,resolve})),getSupportCaseEvents:async()=>({events:[],error:null}),markSupportMessagesRead:async()=>{},createSupportMessageDraft:async()=>({draftId:'draft-'+sends.length}),sendFirstWeHouseMessage:async(draftId,context)=>{sends.push({draftId,context});return {error:{message:'network'}};},getSupportMessageDraftStatus:async()=>({error:{message:'network'}})};
  const component=moduleAt('src/components/SupportChat.tsx',{
    react,'react-dom':{createPortal:node=>node},sonner:{toast:Object.assign(noop,{error:noop,success:noop})},'@/lib/supabase/support':fakeApi,'@/lib/supabase':{supabase:{channel:()=>chain,removeChannel:noop}},'@/lib/displayDate':dates,'@/components/BackButton':'BackButton','@/components/SecureSupportAttachment':'SecureSupportAttachment',
  },{window:{addEventListener:(key,fn)=>listeners.set(key,fn),removeEventListener:key=>listeners.delete(key),dispatchEvent:noop,matchMedia:()=>({matches:false})},document:{body:{}},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options?.detail;}}}).default;
  const profile={user_id:'user-a',username:'user',email:'test@example.invalid',role:'user'};
  let tree;
  const nodes=(node)=>!node||typeof node!=='object'?[]:Array.isArray(node)?node.flatMap(nodes):[node,...nodes(node.props?.children)];
  return {requests,messageRequests,sends,render(){cursor=0;tree=component({profile});effects.splice(0).forEach(fn=>fn());return tree;},open(context){listeners.get('openSupportChat')({detail:context});},find(predicate){return nodes(tree).find(predicate);},close(){for(const slot of slots)slot?.cleanup?.();}};
}
test('Opening another hotel clears the old topic immediately and ignores its delayed lookup',async()=>{
  const h=harness();h.render();h.open(topic('A'));h.render();h.open(topic('B'));h.render();
  assert.equal(h.find(n=>n.props?.['aria-label']==='Send').props.disabled,true);
  h.requests[1]({conversations:[],error:null});await tick();h.render();
  assert.equal(h.find(n=>n.type?.name==='PendingContext').props.context.contextId,'B');
  h.requests[0]({conversations:[thread('A')],error:null});await tick();h.render();
  assert.equal(h.find(n=>n.type?.name==='PendingContext').props.context.contextId,'B');
  assert.equal(h.messageRequests.length,0);h.close();
});
test('Old conversation messages cannot appear after opening a different hotel',async()=>{
  const h=harness();h.render();h.open(topic('A'));h.requests[0]({conversations:[thread('A')],error:null});await tick();h.render();
  h.open(topic('B'));h.requests[1]({conversations:[],error:null});await tick();h.render();
  h.messageRequests[0].resolve({messages:[{id:'old',sender_id:'other',content:'Old hotel message'}],error:null});await tick();h.render();
  assert.equal(h.find(n=>n.type?.name==='MessageBubble'),undefined);
  assert.equal(h.find(n=>n.type?.name==='PendingContext').props.context.contextId,'B');h.close();
});
test('A failed first send and its retry remain attached to their own topic',async()=>{
  const h=harness();h.render();h.open(topic('A'));h.requests[0]({conversations:[],error:null});await tick();h.render();
  h.find(n=>n.type==='textarea').props.onChange({target:{value:'Question A'}});h.render();
  h.find(n=>n.props?.['aria-label']==='Send').props.onClick();await tick();h.render();
  h.find(n=>n.type==='BackButton').props.onClick();h.render();
  h.open(topic('B'));h.requests[1]({conversations:[],error:null});await tick();h.render();
  assert.equal(h.find(n=>n.type==='textarea').props.value,'');
  h.find(n=>n.type==='textarea').props.onChange({target:{value:'Question B'}});h.render();
  h.find(n=>n.props?.['aria-label']==='Send').props.onClick();await tick();h.render();
  assert.equal(h.sends[0].context.contextId,'A');assert.equal(h.sends[1].context.contextId,'B');
  h.find(n=>n.type==='BackButton').props.onClick();h.render();
  h.open(topic('A'));h.requests[2]({conversations:[],error:null});await tick();h.render();
  assert.equal(h.find(n=>n.type==='textarea').props.value,'Question A');
  h.find(n=>n.props?.['aria-label']==='Send').props.onClick();await tick();
  assert.equal(h.sends[2].draftId,h.sends[0].draftId);assert.equal(h.sends[2].context.contextId,'A');h.close();
});
test('A failed lookup keeps Send disabled until the selected topic is recovered',async()=>{
  const h=harness();h.render();h.open(topic('A'));h.requests[0]({conversations:[],error:{message:'offline'}});await tick();h.render();
  assert.equal(h.find(n=>n.props?.['aria-label']==='Send').props.disabled,true);
  assert.ok(h.find(n=>n.type?.name==='ConversationLoadError'));h.close();
});

const menuPosition=moduleAt('src/lib/messageMenuPosition.ts').messageMenuPosition;
test('Message options stay by the selected bubble within narrow and keyboard-reduced viewports',()=>{
  const phone={width:360,height:740,top:0};
  let position=menuPosition({left:180,right:350,top:400,bottom:450},336,212,phone);
  assert.equal(position.top,180);assert.equal(position.left,12);
  position=menuPosition({left:12,right:230,top:20,bottom:60},336,212,phone);
  assert.equal(position.top,68);
  position=menuPosition({left:180,right:350,top:500,bottom:550},336,212,{width:360,height:320,top:0});
  assert.equal(position.top,96);
  position=menuPosition({left:10,right:200,top:20,bottom:60},296,500,{width:320,height:280,top:50});
  assert.equal(position.top,62);assert.equal(position.left,12);
});
test('Hotel enquiry and service-job entry points reopen their canonical saved conversation',()=>{
  const hotel={...thread('A'),context_type:'hotel_operations',context_snapshot:{source_type:'hotel',source_id:'A',hotel_name:'A'}};
  assert.equal(api.findSupportThread([hotel],topic('A')).conversation_id,'chat-A');
  const service={...thread('job-1'),context_type:'operational_case',context_snapshot:{source_type:'worker_job',reason_code:'worker_job_issue'}};
  assert.equal(api.findSupportThread([service],{contextType:'worker_booking',contextId:'job-1'}).conversation_id,'chat-job-1');
  assert.equal(api.findSupportThread([service],{contextType:'contextual_help',contextId:'job-1',contextSnapshot:{subject_type:'hotel_booking',reason_code:'worker_job_issue'}}),null);
});
