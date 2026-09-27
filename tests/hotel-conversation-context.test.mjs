import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source=fs.readFileSync('src/lib/hotelConversationContext.ts','utf8');
const exports={};
vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Date});
const {parseHotelConversationBundle:parse,hotelMessagePresentation:present}=exports;
const context={conversation_id:'alpha',booking_id:1,hotel_id:7,hotel_name:'Garden Lodge',room_name:'Deluxe',rate_plan_name:'Room only',check_in:'2026-09-24',check_out:'2026-09-26',booking_status:'confirmed',payment_status:'paid',viewer_party:'guest',other_party_label:'Garden Lodge',request_visible:true,special_requests:'A quiet room, please',can_reply:true};
const message={id:'m1',sender_id:'desk-a',sender_name:'Reception A',sender_role:'hotel',content:'We have noted your request',attachments:[],attachment_types:[],reactions:{},is_read:false,created_at:'2026-09-23T15:00:00Z'};
const bundle=(change={})=>({context:{...context,...change},messages:[{...message}]});
test('one verified bundle supplies the original request and reply from any entry route',()=>{
 const value=parse(bundle(),'alpha',1);
 assert.equal(value.context.special_requests,'A quiet room, please');assert.equal(value.messages[0].content,'We have noted your request');
 assert.equal(value.context.viewer_party,'guest');assert.equal(value.context.can_reply,true);
});
test('the booking and conversation pair must match, including repeat stays at one hotel',()=>{
 for(const change of [{booking_id:2},{conversation_id:'beta'}])assert.throws(()=>parse(bundle(change),'alpha',1));
});
test('malformed or missing context fails closed, without a role-derived fallback',()=>{
 for(const value of [null,[],{}, {messages:[]},bundle({viewer_party:'creator'}),bundle({can_reply:'true'}),bundle({check_out:'yesterday'}),bundle({check_out:'2026-09-24'}),bundle({hotel_id:'7'})])assert.throws(()=>parse(value,'alpha',1));
});
test('message-only hotel access never receives the special-request note from client props or extra fields',()=>{
 const value=parse({...bundle({viewer_party:'hotel',request_visible:false}),booking_code:'SECRET',guest_phone:'SECRET'},'alpha',1);
 assert.equal(value.context.special_requests,null);assert.equal('booking_code' in value.context,false);assert.equal('guest_phone' in value.context,false);
});
test('returned context is an explicit allowlist, not a spread of a private booking',()=>{
 const value=parse(bundle({booking_code:'SECRET',guest_phone:'SECRET',payment_reference:'SECRET'}),'alpha',1);
 for(const key of ['booking_code','guest_phone','payment_reference'])assert.equal(key in value.context,false);
});
test('checked-out, cancelled or unpaid stays cannot enable the composer',()=>{
 for(const booking_status of ['checked_out','completed','cancelled','expired'])assert.equal(parse(bundle({booking_status}),'alpha',1).context.can_reply,false);
 assert.equal(parse(bundle({payment_status:'unpaid'}),'alpha',1).context.can_reply,false);
 assert.equal(parse(bundle({can_reply:false}),'alpha',1).context.can_reply,false);
});
test('hotel colleagues share one outgoing side but retain their own author',()=>{
 const view={...context,viewer_party:'hotel'};
 assert.equal(present(message,'desk-b',view).outgoing,true);assert.equal(present(message,'desk-b',view).author,'Reception A');assert.equal(present(message,'desk-b',view).teammate,true);
 assert.equal(present({...message,sender_role:'guest',sender_id:'guest',sender_name:'Guest'},'desk-b',view).outgoing,false);
});
test('a professional account booking as a guest still sees hotel replies incoming',()=>{
 assert.equal(present(message,'creator-guest',context).outgoing,false);assert.equal(present(message,'creator-guest',context).author,'Garden Lodge');
 assert.equal(present({...message,sender_role:'guest',sender_id:'creator-guest'},'creator-guest',context).outgoing,true);
});
test('the current staff member is You; colleagues are not mislabeled as the guest',()=>{
 const view={...context,viewer_party:'hotel'};
 assert.equal(present(message,'desk-a',view).author,'You');assert.equal(present(message,'desk-a',view).teammate,false);
});
test('malformed message data does not render as a valid empty history',()=>{
 for(const change of [{sender_role:'admin'},{attachments:'private'},{is_read:'false'},{created_at:'bad'}, {reactions:{x:42}}])assert.throws(()=>parse({context,messages:[{...message,...change}]},'alpha',1));
});
test('chat uses the same bundle before media signing, not a second full booking-list request',()=>{
 const transport=fs.readFileSync('src/lib/supabase/hotel-chat.ts','utf8');const screen=fs.readFileSync('src/components/HotelBookingChat.tsx','utf8');
 assert.match(transport,/get_my_hotel_conversation_bundle/);assert.ok(transport.indexOf('onTextReady?.')<transport.indexOf('createSignedUrl'));
 assert.doesNotMatch(screen,/profile.role === "user" \? "guest" : "hotel"/);assert.match(screen,/context\?\.request_visible/);assert.match(screen,/sender_role: context.viewer_party/);
});
