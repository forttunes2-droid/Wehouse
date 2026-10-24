import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {webcrypto} from 'node:crypto';
const compile=path=>ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const api={};vm.runInNewContext(compile('src/lib/propertySpaces.ts'),{exports:api,crypto:webcrypto,Error});
const valid=()=>({...api.newPhysicalHomeDraft(),siteLabel:'Example compound',unitLabel:'Home A',layoutName:'Any layout'});

test('shared draft facts stay aligned without changing separate unit prices or linking another compound',()=>{
 const first={id:'a',propertyType:'apartment',physicalSpace:valid(),propertyAddress:'Old road',propertyCity:'Lafia',propertyState:'Nasarawa',expectedRent:'600000',files:[],accessChallenge:null,accessVideo:null};
 const second={...api.copyHomeUnit(first,'b'),expectedRent:'700000'};
 const other={...first,id:'c',physicalSpace:valid()};
 const changed=api.patchHomeDraft([first,second,other],0,{propertyAddress:'New road',physicalSpace:{...first.physicalSpace,siteLabel:'Updated compound'}});
 assert.equal(changed[1].propertyAddress,'New road');assert.equal(changed[1].physicalSpace.siteLabel,'Updated compound');assert.equal(changed[1].expectedRent,'700000');
 assert.equal(changed[2].propertyAddress,'Old road');assert.equal(first.propertyAddress,'Old road');
 const switched=api.patchHomeDraft([first,second],0,{physicalSpace:valid()});
 assert.equal(switched[1].physicalSpace.siteId,second.physicalSpace.siteId);assert.equal(switched[1].physicalSpace.siteLabel,'Example compound');
});
test('similar units reuse arbitrary layouts, prices and location but keep separate physical identities and evidence',()=>{
 for(const bedrooms of [0,1,2,3,5,12]){
  const original={id:'old',propertyType:'apartment',physicalSpace:valid(),propertyAddress:'Test street',bedrooms,expectedRent:'600000',files:['old-photo'],accessChallenge:{id:'old-proof'},accessVideo:'old-video'};
  const copied=api.copyHomeUnit(original,'new');
  assert.equal(copied.bedrooms,bedrooms);assert.equal(copied.expectedRent,'600000');assert.equal(copied.propertyAddress,'Test street');
  assert.equal(copied.physicalSpace.siteId,original.physicalSpace.siteId);
  assert.notEqual(copied.physicalSpace.unitId,original.physicalSpace.unitId);
  assert.equal(copied.physicalSpace.spaceId,copied.physicalSpace.unitId);assert.equal(copied.physicalSpace.unitLabel,'');
  assert.equal(copied.files.length,0);assert.equal(copied.accessChallenge,null);assert.equal(copied.accessVideo,null);
  assert.equal(original.files.length,1);
 }
});
test('another private room retains its parent home but receives its own space identity',()=>{
 const physicalSpace={...valid(),scope:'private_room',spaceId:webcrypto.randomUUID(),spaceLabel:'Room A',sharedAreas:'Kitchen, entrance'};
 const source={id:'old',propertyType:'apartment',physicalSpace,files:[],accessChallenge:null,accessVideo:null};
 const copied=api.copyHomeUnit(source,'new');
 assert.equal(copied.physicalSpace.unitId,physicalSpace.unitId);assert.notEqual(copied.physicalSpace.spaceId,physicalSpace.spaceId);
 assert.equal(copied.physicalSpace.spaceLabel,'');assert.equal(copied.physicalSpace.sharedAreas,physicalSpace.sharedAreas);
 assert.equal(api.physicalHomeError(physicalSpace),null);
 assert.deepEqual(Array.from(api.physicalHomePayload(physicalSpace).shared_areas),['Kitchen','entrance']);
});
test('space validation rejects malformed identities, missing labels and undisclosed shared areas',()=>{
 const value=valid();assert.equal(api.physicalHomeError(value),null);assert.equal(api.physicalHomePayload(null),undefined);
 for(const change of [{siteId:null},{unitId:'bad'},{siteLabel:''},{unitLabel:undefined},{layoutName:null},{scope:'other'},{scope:'private_room'}]){
  assert.ok(api.physicalHomeError({...value,...change}));assert.throws(()=>api.physicalHomePayload({...value,...change}));
 }
});
const batch='91111111-1111-4111-8111-111111111111';
const receipt=()=>({batch_id:batch,count:1,payload_matches:true,requests:[{id:'92222222-2222-4222-8222-222222222222',position:1,request_code:'WHIR-check'}]});
test('submission confirmation binds batch, exact payload proof, count and unique request identities',()=>{
 assert.equal(api.propertySubmissionReceipt(receipt(),batch,1).count,1);
 for(const change of [{batch_id:'other'},{payload_matches:false},{count:2},{requests:[]},{requests:[{id:'-'.repeat(36),position:1,request_code:'x'}]}]){
  assert.throws(()=>api.propertySubmissionReceipt({...receipt(),...change},batch,1));
 }
 assert.throws(()=>api.propertySubmissionReceipt({batch_id:batch,count:0,payload_matches:true,requests:[]},batch,0));
});
async function submission(options={}){
 const calls=[],deadlines=[];const exports={};
 const supabase={rpc:async(name,args)=>{
  calls.push({name,args});
  if(name==='create_my_property_inspection_batch_v4'){
   if(options.lost)throw Error('Lost response');
   return{data:options.malformed?{}:receipt(),error:null};
  }
  return{data:options.unresolved?null:receipt(),error:null};
 }};
 vm.runInNewContext(compile('src/lib/submitPropertyBatch.ts'),{exports,Error,require:name=>name.includes('withTimeout')?{withTimeout:async(task,ms)=>{deadlines.push(ms);return task;}}:name.includes('propertySpaces')?api:{supabase}});
 try{return{result:await exports.submitPropertyBatch(batch,[{physical_space:'fixture'}]),calls,deadlines};}catch(error){return{error,calls,deadlines};}
}
test('lost or malformed submission responses recover the same exact batch without another submission',async()=>{
 for(const options of [{},{lost:true},{malformed:true}]){
  const result=await submission(options);assert.equal(result.result.count,1);
  assert.equal(result.calls.filter(call=>call.name==='create_my_property_inspection_batch_v4').length,1);
  if(options.lost||options.malformed){assert.equal(result.calls[1].args.p_batch_id,batch);assert.ok(result.calls[1].args.p_items);assert.deepEqual(result.deadlines,[15000,15000]);}
 }
});
test('an unresolved submission keeps evidence and never reports a guessed count',async()=>{
 const result=await submission({lost:true,unresolved:true});assert.ok(result.error);assert.match(result.error.message,/evidence has been kept/);assert.equal(result.result,undefined);
});
