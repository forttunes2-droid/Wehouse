import {Capacitor,type PluginListenerHandle} from '@capacitor/core';
import {supabase} from '@/lib/supabase/client';
import {getDeviceId} from '@/lib/supabase/session';
import {withTimeout} from '@/lib/withTimeout';

type Bridge=typeof import('@capacitor/push-notifications')['PushNotifications'];
type Controller={userId:string;active:boolean;bridge:Bridge|null;handles:PluginListenerHandle[];revision:number;registration?:Promise<string>;resolve?: (token:string)=>void;reject?: (error:Error)=>void};
let current:Controller|null=null;
export const nativePushPlatform=(): 'android'|'ios'|null=>Capacitor.isNativePlatform()&&['android','ios'].includes(Capacitor.getPlatform())?Capacitor.getPlatform() as 'android'|'ios':null;
export function validPushTap(data:unknown,userId:string):boolean {
 if(!data||typeof data!=='object')return false;
 const value=data as Record<string,unknown>;
 return value.recipient===userId&&value.destination==='inbox'&&typeof value.eventId==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.eventId);
}
async function device(userId:string,action:'status'|'enable'|'disable',token?:string){
 const platform=nativePushPlatform();if(!platform)throw new Error('Phone notifications require the Android or iOS app.');
 const deviceId=getDeviceId();
 const {data,error}=await withTimeout(supabase.rpc('my_native_push_device',{p_device_id:deviceId,p_platform:platform,p_action:action,p_token:token||null,p_expected_user_id:userId}),10000,'Notification settings could not be confirmed. Refresh before retrying.');
 if(error)throw error;
 if(data?.user_id!==userId||data?.device_id!==deviceId||data?.platform!==platform||typeof data.enabled!=='boolean'||(action!=='status'&&data.enabled!==(action==='enable')))throw new Error('Notification settings could not be confirmed. Refresh before retrying.');
 return data as {enabled:boolean};
}
export async function phonePushStatus(userId:string){
 const platform=nativePushPlatform();if(!platform)return{available:false,enabled:false,permission:'unsupported'};
 const [{data,error},state,{PushNotifications}]=await Promise.all([
  withTimeout(supabase.functions.invoke('native-push',{body:{action:'status'}}),10000,'Phone notification status timed out.'),device(userId,'status'),import('@capacitor/push-notifications'),
 ]);
 if(error||typeof data?.[platform]!=='boolean')throw new Error('Phone notification availability could not be checked.');
 const permission=(await PushNotifications.checkPermissions()).receive;
 return{available:data[platform]===true,enabled:state.enabled,permission};
}
async function register(controller:Controller){
 if(controller.registration)return controller.registration;
 const bridge=controller.bridge;if(!bridge||!controller.active)throw new Error('Notification registration is not ready. Try again.');
 const token=new Promise<string>((resolve,reject)=>{controller.resolve=resolve;controller.reject=reject;});
 const receipt=withTimeout(token,12000,'Phone registration timed out. Try again.');void receipt.catch(()=>{});
 controller.registration=(async()=>{try{await bridge.register();return await receipt;}finally{controller.resolve=undefined;controller.reject=undefined;controller.registration=undefined;}})();
 return controller.registration;
}
export function startNativePush(userId:string,onOpenInbox:(workspace:string)=>void){
 if(!nativePushPlatform())return()=>{};
 const controller:Controller={userId,active:true,bridge:null,handles:[],revision:0};current=controller;
 const alive=()=>controller.active&&current===controller;
 void (async()=>{
  const {PushNotifications:bridge}=await import('@capacitor/push-notifications');if(!alive())return;
  controller.bridge=bridge;
  const add=async(handle:Promise<PluginListenerHandle>)=>{const item=await handle;if(alive())controller.handles.push(item);else await item.remove();};
  await add(bridge.addListener('registration',token=>{
   if(!alive())return;
   if(controller.resolve)controller.resolve(token.value);
   // Token refresh only updates installations that already have server consent.
   else {const revision=controller.revision;void device(userId,'status').then(state=>{if(state.enabled&&alive()&&revision===controller.revision)return device(userId,'enable',token.value);}).catch(()=>{});}
  }));
  await add(bridge.addListener('registrationError',()=>controller.reject?.(new Error('The phone could not register for notifications. Try again.'))));
  await add(bridge.addListener('pushNotificationActionPerformed',notification=>{if(alive()&&validPushTap(notification.notification.data,userId))onOpenInbox(String(notification.notification.data.workspace||'personal'));}));
  if(!alive())return;
  if(nativePushPlatform()==='android')await bridge.createChannel({id:'wehouse_updates',name:'WeHouse updates',description:'Messages and account activity',importance:3,visibility:0});
  const revision=controller.revision,status=await phonePushStatus(userId);
  if(alive()&&status.available&&status.enabled&&status.permission==='granted'){
   const token=await register(controller);if(alive()&&revision===controller.revision)await device(userId,'enable',token);
  }
 })().catch(()=>{/* Settings presents retryable errors; foreground Inbox remains available. */});
 return()=>{controller.active=false;controller.reject?.(new Error('The signed-in account changed.'));for(const handle of controller.handles)void handle.remove();if(current===controller)current=null;};
}
export async function setPhonePush(userId:string,enabled:boolean){
 const controller=current;
 if(!controller||controller.userId!==userId||!controller.active||!controller.bridge)throw new Error('Phone notifications are starting. Try again.');
 const revision=++controller.revision;
 if(!enabled){await device(userId,'disable');await controller.bridge.removeAllDeliveredNotifications().catch(()=>{});return;}
 const status=await phonePushStatus(userId);if(!status.available)throw new Error('Phone notifications are not activated for this app yet.');
 let permission=await controller.bridge.checkPermissions();
 if(permission.receive==='prompt'||permission.receive==='prompt-with-rationale')permission=await controller.bridge.requestPermissions();
 if(permission.receive!=='granted')throw new Error('Allow notifications in your phone settings, then try again.');
 const token=await register(controller);
 if(current!==controller||!controller.active||revision!==controller.revision)throw new Error('The account or notification setting changed. Try again.');
 await device(userId,'enable',token);
}
