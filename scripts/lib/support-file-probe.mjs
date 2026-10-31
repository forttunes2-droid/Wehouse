import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {totp} from './authenticator-probe.mjs';

/** Existing local synthetic actors; tiny files; real Auth, RPC and Storage. */
export async function checkSupportFileAuthority(origin,actors){
 const target=new URL(origin);
 assert.ok(target.protocol==='http:'&&['127.0.0.1','localhost'].includes(target.hostname),'Disposable loopback Storage only');
 assert.equal(process.env.GITHUB_ACTIONS,'true','This role fixture is isolated CI only');
 const [requester,team]=actors;assert.ok(requester&&team);
 const literal=value=>"'"+String(value).replaceAll("'","''")+"'";
 const sql=query=>execFileSync('docker',['exec','-i','supabase_db_wehouse','psql','-U','postgres','-d','postgres','-At','-v','ON_ERROR_STOP=1','-c',query],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 const prefix=randomUUID();const paths=[],requests=[];let factor,granted=false;
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j7R8AAAAASUVORK5CYII=','base64');
 const upload=async(actor,label)=>{
  const path=`${requester.conversationId}/${prefix}-${label}.png`;
  const ticket=await actor.client.rpc('reserve_my_media_upload',{p_bucket:'support-files',p_name:path});assert.ifError(ticket.error);
  const result=await actor.client.storage.from('support-files').upload(path,png,{contentType:'image/png',upsert:false});assert.ifError(result.error);
  paths.push({actor,path});
  const receipt=await actor.client.rpc('complete_my_media_upload',{p_reservation_id:ticket.data.id});assert.ifError(receipt.error);assert.equal(receipt.data,true);
  return path;
 };
 const send=async(actor,path)=>{
  const key=randomUUID();requests.push(key);
  return actor.client.rpc('send_support_message_v2',{p_request_id:key,p_conversation_id:requester.conversationId,p_content:'Synthetic file authority proof',p_attachments:[path],p_attachment_types:['image/png'],p_visibility:'customer'});
 };
 const keep=async(actor,path)=>{const result=await actor.client.storage.from('support-files').download(path);assert.ifError(result.error);assert.deepEqual(Buffer.from(await result.data.arrayBuffer()),png);};
 const deniedRemove=async(actor,path)=>{
  const result=await actor.client.storage.from('support-files').remove([path]);
  assert.ok(result.error||result.data.length===0,'Storage reported deleting referenced evidence');
  assert.equal(sql(`select count(*) from storage.objects where bucket_id='support-files' and name=${literal(path)}`),'1');
 };
 try{
  // One canonical identity gains a temporary internal fixture role only after
  // completing the same real MFA API used by the other role-boundary probe.
  const enrolled=await team.client.auth.mfa.enroll({factorType:'totp',friendlyName:'Synthetic Support file proof'});assert.ifError(enrolled.error);
  factor=enrolled.data.id;
  const verified=await team.client.auth.mfa.challengeAndVerify({factorId:factor,code:totp(enrolled.data.totp.secret)});assert.ifError(verified.error);
  assert.equal(sql(`select count(*) from public.workspace_role_assignments where user_id=${literal(team.userId)} and workspace_role='creator'`),'0');
  sql(`insert into public.workspace_role_assignments(user_id,workspace_role,scope_type,status) values(${literal(team.userId)},'creator','global','active')`);granted=true;
  assert.ifError((await team.client.rpc('claim_my_communication_case',{p_conversation_id:requester.conversationId})).error);
  const staffPath=await upload(team,'staff');assert.ifError((await send(team,staffPath)).error);
  await keep(requester,staffPath);await deniedRemove(requester,staffPath);await deniedRemove(team,staffPath);await keep(requester,staffPath);
  assert.ok((await send(requester,staffPath)).error,'Requester claimed another uploader file');
  const ownPath=await upload(requester,'own-sent');assert.ifError((await send(requester,ownPath)).error);
  await deniedRemove(requester,ownPath);await keep(requester,ownPath);
  const unsent=await upload(requester,'unsent');const cleaned=await requester.client.storage.from('support-files').remove([unsent]);
  assert.ifError(cleaned.error);assert.equal(cleaned.data.length,1);
  assert.ok((await send(requester,unsent)).error,'Deleted upload was published');
  for(let index=0;index<3;index++){
   const path=await upload(requester,'race-'+index);
   const [sent,removed]=await Promise.all([send(requester,path),requester.client.storage.from('support-files').remove([path])]);
   if(!sent.error){assert.ok(sent.data);await keep(requester,path);assert.ok(removed.error||removed.data.length===0);}
   else{assert.ifError(removed.error);assert.equal(removed.data.length,1);assert.equal(sql(`select count(*) from storage.objects where bucket_id='support-files' and name=${literal(path)}`),'0');}
  }
  return{scope:'Disposable real Storage/Auth/RPC; no hosted project or payment provider',staff_evidence_readable:true,participant_delete_denied:true,sender_delete_denied:true,foreign_upload_claim_denied:true,own_unsent_cleanup:true,deleted_upload_send_denied:true,send_delete_races_without_dangling_files:3,uploaded_bytes:png.length*paths.length};
 }finally{
  // Only this probe's synthetic message intents are removed. Actual bytes are
  // always cleaned through Storage, never by SQL metadata deletion.
  if(requests.length)sql(`delete from public.partner_support_messages where conversation_id=${literal(requester.conversationId)}::uuid and client_request_id in(${requests.map(literal).join(',')})`);
  for(const {actor,path} of paths){const removed=await actor.client.storage.from('support-files').remove([path]);assert.ifError(removed.error);}
  if(granted)sql(`delete from public.workspace_role_assignments where user_id=${literal(team.userId)} and workspace_role='creator' and scope_type='global'`);
  if(factor)assert.ifError((await team.client.auth.mfa.unenroll({factorId:factor})).error);
 }
}
