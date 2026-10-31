import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';

/** Two disposable actors, tiny Storage files, no hosted endpoint or paid provider. */
export async function checkMediaUploadReservations(origin,actors){
 const target=new URL(origin);assert.ok(target.protocol==='http:'&&['127.0.0.1','localhost'].includes(target.hostname),'Disposable Storage only');
 assert.ok(actors.length>=2);
 const sql=query=>execFileSync('docker',['exec','-i','supabase_db_wehouse','psql','-U','postgres','-d','postgres','-At','-v','ON_ERROR_STOP=1','-c',query],{encoding:'utf8'}).trim();
 const suffix=randomUUID(),a=actors[0],b=actors[1],path=`${a.authId}/media-probe-${suffix}.png`;
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j7R8AAAAASUVORK5CYII=','base64');
 const bypass=await a.client.storage.from('avatars').upload(path,png,{contentType:'image/png',upsert:false});
 assert.ok(bypass.error,'Storage accepted an upload without a durable reservation');
 const reserved=await a.client.rpc('reserve_my_media_upload',{p_bucket:'avatars',p_name:path});
 assert.ok(!reserved.error&&reserved.data?.id,'Storage allocation was not returned');
 const uploaded=await a.client.storage.from('avatars').upload(path,png,{contentType:'image/png',upsert:false});
 assert.equal(uploaded.error,null,'Reserved upload was not accepted by the actual Storage API');
 const completed=await a.client.rpc('complete_my_media_upload',{p_reservation_id:reserved.data.id});
 assert.equal(completed.error,null);assert.equal(completed.data,true,'Storage commit was not confirmed');
 const removed=await a.client.storage.from('avatars').remove([path]);assert.equal(removed.error,null);
 const previous=sql('select project_bytes from private.media_upload_policy where singleton');assert.match(previous,/^\d+$/);
 const racePaths=actors.slice(0,2).map(actor=>`${actor.authId}/media-race-${suffix}.png`);
 try{
  sql("update private.media_upload_policy set project_bytes=(select coalesce(sum((metadata->>'size')::bigint),0) from storage.objects)+(select file_size_limit from storage.buckets where id='avatars')+1 where singleton");
  const results=await Promise.all([a,b].map((actor,i)=>actor.client.rpc('reserve_my_media_upload',{p_bucket:'avatars',p_name:racePaths[i]})));
  assert.equal(results.filter(result=>!result.error&&result.data?.id).length,1,'Concurrent callers overspent one remaining file allowance');
  assert.equal(results.filter(result=>result.error).length,1);
  const winner=results.findIndex(result=>!result.error);
  const ticket=results[winner].data.id;assert.match(ticket,/^[0-9a-f-]{36}$/i);
  sql(`update private.media_upload_reservations set expires_at=now()-interval '1 minute' where id='${ticket}'::uuid`);
  const retry=await actors[1-winner].client.rpc('reserve_my_media_upload',{p_bucket:'avatars',p_name:racePaths[1-winner]});
  assert.ok(!retry.error&&retry.data?.id,'Verified expiry did not reclaim the abandoned allocation');
  const late=await actors[winner].client.storage.from('avatars').upload(racePaths[winner],png,{contentType:'image/png',upsert:false});
  assert.ok(late.error,'An expired allocation still accepted a late file');
  return {scope:'Disposable local Storage API',unreserved_upload_rejected:true,reserved_upload_completed:true,one_remaining_allocation_race:true,expired_capacity_reclaimed:true,late_expired_upload_rejected:true,uploaded_bytes:png.byteLength};
 }finally{
  sql(`update private.media_upload_policy set project_bytes=${previous} where singleton`);
  // These race tickets never started a Storage upload. Only test-owned private
  // fixture rows are removed; actual assets were removed through Storage API.
  sql(`delete from private.media_upload_reservations where object_name like '%media-race-${suffix}.png'`);
 }
}
