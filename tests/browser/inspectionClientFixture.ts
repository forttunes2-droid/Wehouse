/** Isolated inspection transport. Database authority has its separate SQL contract. */
const partner=new URLSearchParams(location.search).get('source')!=='user';
const row:any={id:'99999999-4444-4444-8444-444444444444',_source:partner?'partner':'user',status:'in_progress',property_address:'Assigned property visit',property_city:'Lafia',property_state:'Nasarawa',owner_name:'Property contact',photo_urls:partner?['one','two','three','four']:[],review_status:partner?'changes_requested':null,review_note:partner?'Add clearer entrance evidence.':null,notes:partner?'Previous inspection report':null};
const control=(window as any).__inspection={calls:[] as any[],failNext:true};
export const supabase:any={
 rpc(name:string,args:any={}){
  control.calls.push({name,args});
  if(name==='get_my_inspections')return Promise.resolve({data:[structuredClone(row)],error:null});
  if(name==='update_inspection_status'){
   if(control.failNext){control.failNext=false;return Promise.resolve({data:false,error:null});}
   Object.assign(row,{status:args.p_new_status,notes:args.p_report,completed_at:new Date().toISOString()});
   return Promise.resolve({data:true,error:null});
  }
  throw Error('Unexpected inspection RPC '+name);
 },
 storage:{from(){return {createSignedUrl:async()=>({data:null,error:null})};}},
};
export async function uploadStorageObjectWithProgress(){throw Error('Uploads are outside this fixture');}
