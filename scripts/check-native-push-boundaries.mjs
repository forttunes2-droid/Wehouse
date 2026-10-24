import assert from 'node:assert/strict';
const endpoint='https://qoobnkedfyosnizrlttt.supabase.co/functions/v1/native-push';
const cases=[
 {label:'status requires authentication',body:{action:'status'},status:401},
 {label:'dispatch requires worker secret',body:{action:'dispatch'},status:401},
 {label:'arbitrary actions rejected',body:{action:'send_to_everyone'},status:400},
 {label:'streamed request size is bounded',raw:JSON.stringify({action:'status',padding:'x'.repeat(1100)}),status:413},
];
for(const item of cases){const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:item.raw||JSON.stringify(item.body),signal:AbortSignal.timeout(20000)});assert.equal(response.status,item.status,item.label);console.log('PASS '+item.label);}
const get=await fetch(endpoint,{signal:AbortSignal.timeout(20000)});assert.equal(get.status,405);console.log('PASS method guard');
