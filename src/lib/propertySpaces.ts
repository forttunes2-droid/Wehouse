export type PhysicalHomeDraft={
 siteId:string;siteLabel:string;unitId:string;unitLabel:string;
 spaceId:string;spaceLabel:string;scope:'entire_unit'|'private_room';
 layoutName:string;sharedAreas:string;
};
export function newPhysicalHomeDraft():PhysicalHomeDraft{
 const unitId=crypto.randomUUID();
 return{siteId:crypto.randomUUID(),siteLabel:'',unitId,unitLabel:'',spaceId:unitId,spaceLabel:'',scope:'entire_unit',layoutName:'',sharedAreas:''};
}
export function physicalHomeError(value:PhysicalHomeDraft|null):string|null{
 if(!value)return null;
 for(const id of [value.siteId,value.unitId,value.spaceId])if(typeof id!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id))return 'Reload this unit draft before continuing.';
 for(const [label,text] of [['Compound or building name',value.siteLabel],['Unit label',value.unitLabel]]){
  if(typeof text!=='string'||!text.trim()||text.trim().length>120)return label+' must contain 1 to 120 characters.';
 }
 if(typeof value.layoutName!=='string'||value.layoutName.length>120)return 'Keep the layout name within 120 characters.';
 if(value.scope==='private_room'){
  if(value.spaceId===value.unitId)return 'A private room needs its own identity within the home.';
  if(typeof value.spaceLabel!=='string'||!value.spaceLabel.trim()||value.spaceLabel.trim().length>120)return 'Add a room label within 120 characters.';
  if(typeof value.sharedAreas!=='string')return 'Describe the shared areas.';
  const shared=value.sharedAreas.split(',').map(x=>x.trim()).filter(Boolean);
  if(!shared.length||shared.length>12||shared.some(x=>x.length>80))return 'Describe up to 12 shared areas, separated by commas.';
 }else if(value.scope!=='entire_unit'||value.spaceId!==value.unitId)return 'The whole home must use its own unit identity.';
 return null;
}
export function physicalHomePayload(value:PhysicalHomeDraft|null){
 if(!value)return undefined;
 const error=physicalHomeError(value);if(error)throw Error(error);
 return{site_id:value.siteId,site_label:value.siteLabel.trim(),unit_id:value.unitId,unit_label:value.unitLabel.trim(),
 space_id:value.spaceId,space_label:value.scope==='entire_unit'?value.unitLabel.trim():value.spaceLabel.trim(),scope:value.scope,
 layout_name:value.layoutName.trim(),shared_areas:value.scope==='private_room'?value.sharedAreas.split(',').map(x=>x.trim()).filter(Boolean):[]};
}
type HomeCopy={id:string;propertyType:string;files:unknown[];accessChallenge:unknown;accessVideo:unknown;physicalSpace:PhysicalHomeDraft|null};
type GroupedHomeDraft={propertyType:string;physicalSpace:PhysicalHomeDraft|null;propertyAddress:string;propertyCity:string;propertyState:string};
/** Keep shared physical facts aligned inside one draft batch; prices remain per offer. */
export function patchHomeDraft<T extends GroupedHomeDraft>(rows:T[],index:number,next:Partial<T>):T[]{
 const before=rows[index];if(!before)return rows;
 const updated={...before,...next};const previous=before.physicalSpace;const space=updated.physicalSpace;
 return rows.map((row,i)=>{
  if(i===index)return updated;
  if(before.propertyType!=='apartment'||updated.propertyType!=='apartment'||row.propertyType!=='apartment'||!previous||!space||!row.physicalSpace)return row;
  const physicalSpace={...row.physicalSpace};const result={...row,physicalSpace};
  if(previous.siteId===space.siteId&&physicalSpace.siteId===space.siteId){
   physicalSpace.siteLabel=space.siteLabel;
   for(const field of ['propertyAddress','propertyCity','propertyState'] as const)if(updated[field]!==before[field])result[field]=updated[field];
  }
  if(previous.unitId===space.unitId&&physicalSpace.unitId===space.unitId){physicalSpace.unitLabel=space.unitLabel;physicalSpace.layoutName=space.layoutName;}
  if(previous.spaceId===space.spaceId&&physicalSpace.spaceId===space.spaceId){physicalSpace.spaceLabel=space.spaceLabel;physicalSpace.sharedAreas=space.sharedAreas;}
  return result;
 });
}
export function propertySubmissionReceipt(value:unknown,batchId:string,count:number):{count:number}{
 const receipt=value as {batch_id?:unknown;count?:unknown;requests?:unknown;payload_matches?:unknown};
 if(!Number.isSafeInteger(count)||count<1||count>25||!receipt||receipt.payload_matches!==true||receipt.batch_id!==batchId||receipt.count!==count||!Array.isArray(receipt.requests)||receipt.requests.length!==count)throw Error('Property submission receipt could not be confirmed.');
 const ids=new Set<string>();const positions=new Set<number>();
 for(const value of receipt.requests){
  const row=value as {id?:unknown;position?:unknown;request_code?:unknown};
  if(!row||typeof row.id!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(row.id)||ids.has(row.id.toLowerCase())||typeof row.position!=='number'||!Number.isSafeInteger(row.position)||row.position<1||row.position>count||positions.has(row.position)||typeof row.request_code!=='string'||!row.request_code)throw Error('Property submission receipt could not be confirmed.');
  ids.add(row.id.toLowerCase());positions.add(row.position);
 }
 return{count};
}
export function copyHomeUnit<T extends HomeCopy>(source:T,newId:string):T{
 if(source.propertyType!=='apartment'||!source.physicalSpace)throw Error('Choose a home in a compound before adding a similar unit.');
 const previous=source.physicalSpace;
 const unitId=previous.scope==='private_room'?previous.unitId:crypto.randomUUID();
 const spaceId=previous.scope==='private_room'?crypto.randomUUID():unitId;
 return{...source,id:newId,files:[],accessChallenge:null,accessVideo:null,
 physicalSpace:{...previous,unitId,spaceId,unitLabel:previous.scope==='private_room'?previous.unitLabel:'',spaceLabel:''}};
}
