import { supabase } from './client';
import type { Announcement,AnnouncementRecipient,AnnouncementTargetType } from '@/types';

type AnnouncementDispatchResult={id?:number;recipient_count?:number};
type AnnouncementListRow=Announcement&{profiles?:{username:string|null}|null};
type AnnouncementInboxRow=Pick<AnnouncementRecipient,'id'|'announcement_id'|'read_status'|'delivered_at'>&{announcement:Announcement|null};

function sentAnnouncement(data:unknown,senderId:string,senderRole:string,title:string,content:string,targetType:AnnouncementTargetType):Announcement{
  const result=(data&&typeof data==='object'?data:{}) as AnnouncementDispatchResult;
  return{id:Number(result.id||0),title,content,sender_id:senderId,sender_role:senderRole,target_type:targetType,scope:null,recipient_count:Number(result.recipient_count||0),read_count:0,created_at:new Date().toISOString()};
}

export async function checkAnnouncementTables(){return{ok:true,issues:[] as string[]}}

export async function sendAnnouncement(
  senderId:string,
  senderRole:string,
  _senderName:string,
  title:string,
  message:string,
  targetType:AnnouncementTargetType,
  options:{recipientIds?:string[];scopeState?:string;scopeLga?:string;targetRoles?:string[]}={}
){
  const{recipientIds,scopeState,scopeLga,targetRoles}=options;
  const cleanTitle=title.trim();
  const cleanMessage=message.trim();
  const roles=(targetRoles||[]).filter(r=>['user','worker','staff','property_partner','admin'].includes(r));
  if(!cleanTitle)return{error:{message:'Announcement title is required'},announcement:null,recipientCount:0};
  if(!cleanMessage)return{error:{message:'Announcement content is required'},announcement:null,recipientCount:0};

  if(senderRole==='admin'){
    const{data,error}=await supabase.rpc('admin_send_branch_announcement',{
      p_title:cleanTitle,
      p_content:cleanMessage,
      p_target_roles:roles,
      p_recipient_ids:targetType==='specific_user'?(recipientIds||[]):null,
    });
    const result=(data&&typeof data==='object'?data:{}) as AnnouncementDispatchResult;
    return{error,announcement:error?null:sentAnnouncement(data,senderId,senderRole,cleanTitle,cleanMessage,targetType),recipientCount:error?0:Number(result.recipient_count||0)};
  }

  if(senderRole==='creator'){
    const{data,error}=await supabase.rpc('creator_send_announcement',{
      p_title:cleanTitle,
      p_content:cleanMessage,
      p_target_roles:roles,
      p_recipient_ids:targetType==='specific_user'?(recipientIds||[]):null,
      p_scope_state:scopeState||null,
      p_scope_lga:scopeLga||null,
    });
    const result=(data&&typeof data==='object'?data:{}) as AnnouncementDispatchResult;
    return{error,announcement:error?null:sentAnnouncement(data,senderId,senderRole,cleanTitle,cleanMessage,targetType),recipientCount:error?0:Number(result.recipient_count||0)};
  }

  return{error:{message:'This role cannot send announcements'},announcement:null,recipientCount:0};
}

export async function getAnnouncementsForUser(userId:string){
  void userId;
  const{data,error}=await supabase.rpc('get_my_announcement_inbox');
  if(error)return{messages:[],error};
  const rows=(data||[]) as AnnouncementInboxRow[];
  return{messages:rows.map((row)=>({...row,announcements:row.announcement?[row.announcement]:[],message:row.announcement||null})),error:null};
}
export async function markAnnouncementRead(announcementId:number,userId:string){void userId;const{error}=await supabase.rpc('mark_my_announcement_read',{p_announcement_id:announcementId});return{error}}
export async function deleteAnnouncement(announcementId:number){const{error}=await supabase.from('announcements').delete().eq('id',announcementId);return{error}}
export async function getAnnouncementsSentBy(senderId:string){const{data,error}=await supabase.from('announcements').select('id,title,content,sender_id,sender_role,target_type,scope,recipient_count,read_count,created_at,profiles:sender_id (username)').eq('sender_id',senderId).order('created_at',{ascending:false});return{messages:data as AnnouncementListRow[]|null,error}}
export async function getAllAnnouncements(){const{data,error}=await supabase.from('announcements').select('id,title,content,sender_id,sender_role,target_type,scope,recipient_count,read_count,created_at,profiles:sender_id (username)').order('created_at',{ascending:false});return{messages:data as AnnouncementListRow[]|null,error}}
export async function getUnreadAnnouncementCount(userId:string){const{count,error}=await supabase.from('announcement_recipients').select('*',{count:'exact',head:true}).eq('user_id',userId).eq('read_status',false);return{count:count||0,error}}
export async function getAnnouncementStats(announcementId:number){const{data,error}=await supabase.from('announcements').select('recipient_count,read_count').eq('id',announcementId).maybeSingle();return{stats:data||{recipient_count:0,read_count:0},error}}
export const getOfficialMessagesForUser=getAnnouncementsForUser;
export const markOfficialMessageRead=(id:string)=>markAnnouncementRead(Number(id),'');
export const deleteOfficialMessage=(id:string)=>deleteAnnouncement(Number(id));
export const getOfficialMessagesSentBy=getAnnouncementsSentBy;
export const getAllOfficialMessages=getAllAnnouncements;
export const getUnreadOfficialCount=getUnreadAnnouncementCount;
export const checkOfficialMessageTables=checkAnnouncementTables;
export const getMessageRecipientCount=async(id:string|number)=>{const{stats}=await getAnnouncementStats(Number(id));return{count:stats.recipient_count,error:null}};
export const getFilteredRecipientCount=async(includeUsers:boolean,includeWorkers:boolean,includeStaff:boolean,includePartners:boolean,scopeState?:string,scopeLga?:string,senderRole?:string)=>{
  const roles:string[]=[];if(includeUsers)roles.push('user');if(includeWorkers)roles.push('worker');if(includeStaff)roles.push('staff');if(includePartners)roles.push('property_partner');if(!roles.length)return{count:0,error:null};
  if(senderRole==='admin'){const{data,error}=await supabase.rpc('admin_count_branch_announcement_recipients',{p_target_roles:roles});return{count:Number(data||0),error}}
  let q=supabase.from('profiles').select('*',{count:'exact',head:true}).is('deleted_at',null).in('role',roles);if(scopeState)q=q.eq('state',scopeState);if(scopeLga)q=q.or(`local_government.eq.${scopeLga},city.eq.${scopeLga},assigned_lga.eq.${scopeLga}`);const{count,error}=await q;return{count:count||0,error};
};
