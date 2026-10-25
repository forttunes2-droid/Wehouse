import assert from 'node:assert/strict';

// Called only by the disposable loopback mixed-journey runner after Auth setup.
export async function checkFriendLiveDelivery(actors){
 const [sender,reactor,outsider]=actors;
 const received=[[],[],[]];const clients=[sender,reactor,outsider];
 const waitFor=async(predicate)=>{
  const deadline=Date.now()+10000;
  while(!predicate()){assert.ok(Date.now()<deadline,'Friend signal delivery deadline');await new Promise(resolve=>setTimeout(resolve,25));}
 };
 try{
  await Promise.all(clients.map(async(actor,index)=>{
   await actor.client.realtime.setAuth();
   await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('Private Friend join deadline')),15000);
    actor.client.channel(`wehouse:friend:${actor.authId}`,{config:{private:true}})
     .on('broadcast',{event:'friend_chat_changed'},({payload})=>received[index].push(payload))
     .subscribe(status=>{
      if(status==='SUBSCRIBED'){clearTimeout(timer);resolve();}
      else if(['CHANNEL_ERROR','TIMED_OUT'].includes(status)){clearTimeout(timer);reject(Error('Private Friend join failed'));}
     });
   });
  }));
  const request=await sender.client.rpc('send_friend_request',{p_user_id:reactor.userId});
  assert.ifError(request.error);assert.ok(request.data?.id,'Friend request receipt');
  const friendId=request.data.id;
  const acceptance=await reactor.client.rpc('respond_to_friend_request',{p_friend_id:friendId,p_accept:true});assert.ifError(acceptance.error);
  const message=await sender.client.rpc('send_friend_encrypted_message',{p_friend_id:friendId,p_ciphertext:'ZmFrZQ==',p_encryption_iv:'aXY=',p_client_message_id:crypto.randomUUID()});
  assert.ifError(message.error);assert.equal(typeof message.data,'string');
  const observed=(index,kind)=>received[index].some(payload=>payload.friend_id===friendId&&payload.message_id===message.data&&payload.kind===kind);
  await waitFor(()=>observed(0,'message')&&observed(1,'message'));
  const reaction=await reactor.client.rpc('set_friend_message_reaction',{p_friend_id:friendId,p_message_id:message.data,p_emoji:'👍'});
  assert.ifError(reaction.error);assert.equal(reaction.data?.[reactor.userId],'👍');
  await waitFor(()=>observed(0,'reaction')&&observed(1,'reaction'));
  assert.equal(received[2].filter(payload=>payload.friend_id===friendId).length,0,'outsider received a private Friend hint');
  assert.ok(received.flat().every(payload=>Object.keys(payload).every(key=>['id','friend_id','message_id','kind'].includes(key))),'Friend signal exposed message content');
  return {passed:true,authenticated_participants:2,authenticated_outsiders:1,message_delivery:true,reaction_delivery:true,
   scope:'Disposable WebSocket signals and authorized RPCs; synthetic ciphertext, not a two-device encryption or push test'};
 }catch(error){
  error.friendLiveDiagnostics={received_counts:received.map(rows=>rows.length),
   received_kinds:received.map(rows=>[...new Set(rows.map(row=>typeof row?.kind==='string'?row.kind:'missing-kind'))])};
  throw error;
 }finally{await Promise.all(clients.map(actor=>actor.client.removeAllChannels()));}
}
