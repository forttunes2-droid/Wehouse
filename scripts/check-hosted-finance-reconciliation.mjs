import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';

// Disposable fixtures only, pinned to Test. Never creates or retries a refund.
const origin='https://qoobnkedfyosnizrlttt.supabase.co';
const key=readFileSync('.github/workflows/capacity-hosted-test.yml','utf8').match(/sb_publishable_[A-Za-z0-9_-]+/)?.[0];
assert.ok(key,'Test publishable key required');
const path='test-results/hosted-finance-fixture-private.json';
const fixture=JSON.parse(readFileSync(path,'utf8'));
assert.ok(String(fixture.accounts.owner.person).startsWith('hosted-finance-'));
const mode=process.argv[2];
async function request(path,body,token){
 const response=await fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{apikey:key,'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(20000)});
 return{status:response.status,ok:response.ok,data:await response.json().catch(()=>null)};
}
if(mode==='login'){
 const sessions={};
 for(const[kind,account]of Object.entries(fixture.accounts)){
  const result=await request('/auth/v1/token?grant_type=password',{email:account.email,password:account.password});
  assert.equal(result.status,200,`${kind} Auth login failed (${result.status}): ${result.data?.error_code||''} ${result.data?.error_description||result.data?.msg||''}`);
  account.token=result.data.access_token;delete account.password;
  const claims=JSON.parse(Buffer.from(account.token.split('.')[1],'base64url').toString());
  assert.equal(claims.sub,account.auth);assert.ok(claims.session_id);
  sessions[kind]={auth:account.auth,person:account.person,session:claims.session_id};
 }
 writeFileSync(path,JSON.stringify(fixture));
 writeFileSync('test-results/hosted-finance-sessions.json',JSON.stringify(sessions));
 console.log('Six disposable Test Auth accounts signed in; session identifiers recorded without tokens.');
}else if(mode==='check'){
 const results=[];
 for(const[kind,account]of Object.entries(fixture.accounts)){
  const identity=await request('/auth/v1/user',undefined,account.token);
  assert.equal(identity.status,200,`${kind} token must be recognized by hosted Auth`);
  const snapshot=await request('/rest/v1/rpc/get_my_financial_action_reconciliation',{p_financial_action_id:fixture.action},account.token);
  const allowed=['creator','finance'].includes(kind);
  if(allowed){assert.equal(snapshot.status,200,`${kind} snapshot authority`);assert.equal(snapshot.data.financial_action_id,fixture.action);}
  else{assert.ok([400,403].includes(snapshot.status),`${kind} denial must come from the RPC authority`);}
  const edge=await request('/functions/v1/financial-action-reconcile',{financial_action_id:fixture.action,provider_refund_id:'42'},account.token);
  if(edge.status!==503)assert.equal(edge.status,allowed?502:403,`${kind} hosted endpoint boundary (${edge.status})`);
  results.push({role:kind,auth:identity.status,snapshot:snapshot.status,edge:edge.status,providerConfigured:allowed?edge.status!==503:null});
 }
 writeFileSync('test-results/hosted-finance-reconciliation.json',JSON.stringify(results,null,2));
 console.log(JSON.stringify(results));
}else if(mode==='check-revoked'){
 const account=fixture.accounts.finance;
 const identity=await request('/auth/v1/user',undefined,account.token);assert.equal(identity.status,200);
 const snapshot=await request('/rest/v1/rpc/get_my_financial_action_reconciliation',{p_financial_action_id:fixture.action},account.token);
 assert.ok([400,403].includes(snapshot.status));assert.match(snapshot.data?.message||'',/Active trusted session required/);
 const edge=await request('/functions/v1/financial-action-reconcile',{financial_action_id:fixture.action,provider_refund_id:'42'},account.token);
 assert.ok([403,503].includes(edge.status));
 writeFileSync('test-results/hosted-finance-revoked.json',JSON.stringify({auth:identity.status,snapshot:snapshot.status,edge:edge.status},null,2));
 console.log('Revoked Test device cannot read or reconcile its former Finance action.');
}else throw new Error('Choose login, check or check-revoked');
