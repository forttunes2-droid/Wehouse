import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source=ts.transpileModule(fs.readFileSync('src/lib/supabase/profile.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function adapter(receipt){
 const calls=[],exports={};
 const supabase={rpc:async(name,params)=>{calls.push({name,params});return receipt;},from:table=>({select:columns=>({eq:(field,value)=>({order:order=>({limit:async limit=>{calls.push({table,columns,field,value,order,limit});return receipt;}})})})})};
 vm.runInNewContext(source,{exports,require:name=>{
  if(name==='./client')return{supabase};
  if(name==='./utils')return{compressImageFile:()=>{throw Error('Unexpected media operation');}};
  if(name==='@/lib/withTimeout')return{withTimeout:operation=>operation};
  throw Error('Unexpected dependency '+name);
 }});
 return{api:exports,calls};
}
const plain=value=>JSON.parse(JSON.stringify(value));
test('profile and private location use one owner-derived command, including deliberate address removal',async()=>{
 const {api,calls}=adapter({data:{user_id:'current-person'},error:null});
 const result=await api.updateProfile('browser-supplied-identity',{full_name:'Example',city:'Lafia',precise_latitude:null,precise_longitude:null,precise_address:null});
 assert.equal(result.profile.user_id,'current-person');
 assert.deepEqual(plain(calls),[{name:'update_my_profile_with_location',params:{p_updates:{full_name:'Example',city:'Lafia',local_government:'Lafia'},p_latitude:null,p_longitude:null,p_address:null,p_accuracy_m:null}}]);
});
test('a rejected atomic profile command never falls back to sequential partial writes',async()=>{
 const {api,calls}=adapter({data:null,error:{message:'Invalid coordinates'}});
 const result=await api.updateProfile('current-person',{full_name:'Changed',precise_latitude:1000,precise_longitude:7});
 assert.equal(result.profile,null);assert.equal(result.error.message,'Invalid coordinates');
 assert.equal(calls.length,1);assert.equal(calls[0].name,'update_my_profile_with_location');
});
test('ordinary identity edits preserve the existing command and professional edits save services and profile together',async()=>{
 const {api,calls}=adapter({data:{user_id:'current-person'},error:null});
 await api.updateProfile('current-person',{phone:'08000000000'});
 await api.saveMyWorkerProfile([{name:'Repairs',category:'Maintenance',price:0,price_type:'negotiable'}],{worker_occupation:'Repair professional'});
 assert.deepEqual(calls.map(call=>call.name),['update_my_profile','save_my_worker_profile']);
 assert.equal(calls[1].params.p_services[0].name,'Repairs');
 assert.equal(calls[1].params.p_updates.worker_occupation,'Repair professional');
});
test('professional location receipts reject malformed country or region data',async()=>{
 for(const data of [[],{country_code:'NGN',country:'Nigeria',state:'Nasarawa',city:'Lafia',area:''},{country_code:'NG',state:null,city:'Lafia',area:''}]){
  const {api}=adapter({data,error:null});assert.equal((await api.getMyWorkerServiceCoverage()).coverage,null);
 }
 const {api}=adapter({data:{country_code:'NG',country:'Nigeria',state:'Nasarawa',city:'Lafia',area:''},error:null});
 assert.equal((await api.getMyWorkerServiceCoverage()).coverage.state,'Nasarawa');
});

test('profile country choices read only the bounded enabled public catalog and reject ambiguous receipts',async()=>{
 const {api,calls}=adapter({data:[{country_code:'NG',name:'Nigeria'},{country_code:'GH',name:'Ghana'}],error:null});
 assert.equal((await api.getProfileCountryOptions()).countries[1].country_code,'GH');
 assert.deepEqual(plain(calls),[{table:'platform_countries',columns:'country_code,name',field:'enabled',value:true,order:'name',limit:250}]);
 for(const data of [null,[{country_code:'NGN',name:'Nigeria'}],[{country_code:'NG',name:'Nigeria'},{country_code:'NG',name:'Different name'}]]){
  const {api}=adapter({data,error:null});assert.equal((await api.getProfileCountryOptions()).countries.length,0);
 }
});
