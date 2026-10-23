import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { webcrypto } from 'node:crypto';
function moduleAt(path){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,crypto:webcrypto,TextEncoder,URLSearchParams,Date});return exports;}
const {propertySubmissionFactsError: facts}=moduleAt('src/lib/propertySubmissionFacts.ts');
const {verifyNigerianIdentity: verify,NIN_REQUIRED_FOR_SIGNUP}=moduleAt('supabase/functions/_shared/nigerianIdentity.ts');
test('retired creation route cannot be restored and active clients expose no direct listing writer',()=>{
  const routes=moduleAt('src/lib/navigationRoute.ts');
  assert.equal(routes.isRestorableNavigationPage('new_listing'),false);
  assert.equal(routes.identityEntryRoute('#new_listing','creator').page,'creator');
  assert.equal(routes.identityEntryRoute('#new_listing','admin').page,'admin');
  assert.equal(fs.existsSync('src/pages/CreateListing.tsx'),false);
  assert.equal(fs.existsSync('src/pages/HotelDetailCore.tsx'),false);
  for(const path of ['src/App.tsx','src/lib/supabase/listings.ts','src/lib/supabase/index.ts'])assert.doesNotMatch(fs.readFileSync(path,'utf8'),/create_internal_listing|\bcreateListing\b|\bCreateListing\b/);
});
test('property counts preserve a studio and reject blank, fractional and unsupported counts',()=>{
  assert.equal(facts({propertyType:'apartment',bedrooms:'0',bathrooms:'1',hotelRooms:[]}),null);
  for(const value of ['', '-1','1.5','2147483648'])assert.ok(facts({propertyType:'apartment',bedrooms:value,bathrooms:'1',hotelRooms:[]}));
  for(const value of ['', '0','1.5'])assert.ok(facts({propertyType:'hotel',bedrooms:'',bathrooms:'',hotelRooms:[{maxGuests:value,inventory:'1'}]}));
  assert.ok(facts({propertyType:'hotel',bedrooms:'',bathrooms:'',hotelRooms:[{maxGuests:'2',inventory:'0'}]}));
});
function setup(){
  const calls=[];const saved=new Map();let birthDate='1990-01-01';
  const dependencies={policy:{enabled:true,approved:true,purposes:['property_partner'],validitySeconds:3600},provider:{id:'synthetic-test-provider',async verify(input){calls.push(input);return{accountId:input.accountId,reference:'synthetic-reference',documentCountry:'NG',documentType:'nin',outcome:'verified',nameMatches:true,birthDateMatches:true};}},fingerprintSecret:'synthetic-test-secret-at-least-32-characters',
    authenticate:async()=>({accountId:'test-account',active:true,liveSession:true,fullName:'Test Person',birthDate}),allowedAttempt:async()=>true,
    receipts:{find:async(_id,_purpose,key)=>saved.get(key)||null,save:async(key,receipt)=>{saved.set(key,receipt)}},now:()=>new Date('2026-10-19T12:00:00Z')};
  return{dependencies,calls,saved,setBirthDate(value){birthDate=value}};
}
const request={purpose:'property_partner',nin:'01234567890',consent:true};
test('NIN is never required for signup and no missing/unapproved provider is invoked',async()=>{
  const state=setup();assert.equal(NIN_REQUIRED_FOR_SIGNUP,false);
  assert.equal((await verify({...request,purpose:'account_creation'},state.dependencies)).status,'not_required');
  for(const patch of [{provider:null},{policy:{...state.dependencies.policy,enabled:false}},{policy:{...state.dependencies.policy,approved:false}}])assert.equal((await verify(request,{...state.dependencies,...patch})).status,'unavailable');
  assert.equal(state.calls.length,0);
  assert.equal((await verify({...request,purpose:'booking'},state.dependencies)).code,'INVALID_VERIFICATION_PURPOSE');
  assert.equal(state.calls.length,0);
  for(const path of ['src/pages/Login.tsx','src/lib/supabase/auth.ts'])assert.doesNotMatch(fs.readFileSync(path,'utf8'),/\bnin\b|gov_id_number/i);
});
test('NIN requires a live active account, consent and format but cannot verify from format alone',async()=>{
  const state=setup();
  assert.equal((await verify({...request,consent:false},state.dependencies)).code,'CONSENT_REQUIRED');
  assert.equal((await verify({...request,nin:'123'},state.dependencies)).code,'NIN_FORMAT_INVALID');
  assert.equal((await verify(request,{...state.dependencies,authenticate:async()=>null})).code,'ACTIVE_SESSION_REQUIRED');
  assert.equal(state.calls.length,0);
  state.dependencies.provider.verify=async()=>({accountId:'another-account',reference:'ref',documentCountry:'NG',documentType:'nin',outcome:'verified',nameMatches:true,birthDateMatches:true});
  assert.equal((await verify(request,state.dependencies)).status,'unconfirmed');assert.equal(state.saved.size,0);
});
test('NIN mismatches require review; provider/storage failure never grants a verified receipt',async()=>{
  const state=setup();state.dependencies.provider.verify=async()=>({accountId:'test-account',reference:'ref',documentCountry:'NG',documentType:'nin',outcome:'verified',nameMatches:false,birthDateMatches:true});
  assert.equal((await verify(request,state.dependencies)).receipt.outcome,'review_required');
  const failure=setup();failure.dependencies.provider.verify=async()=>{throw Error('provider unavailable')};
  assert.equal((await verify(request,failure.dependencies)).status,'unconfirmed');
  const storage=setup();storage.dependencies.receipts.save=async()=>{throw Error('store unavailable')};
  assert.equal((await verify(request,storage.dependencies)).status,'unconfirmed');
});
test('NIN receipts omit raw identity input, replay safely and invalidate after identity-detail changes',async()=>{
  const state=setup();const result=await verify(request,state.dependencies);
  assert.equal(result.receipt.outcome,'verified');assert.equal(state.calls[0].nin,'01234567890');
  assert.equal((await verify(request,state.dependencies)).replayed,true);assert.equal(state.calls.length,1);
  assert.doesNotMatch(JSON.stringify([...state.saved]),/01234567890|Test Person|1990-01-01/);
  state.setBirthDate('1991-01-01');assert.equal((await verify(request,state.dependencies)).replayed,false);assert.equal(state.calls.length,2);
});
