import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import ts from 'typescript';
function module(path,imports={},globals={}){const api={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:api,require:name=>imports[name]||{},URL,AbortSignal,crypto:globalThis.crypto,TextEncoder,Number,Promise,...globals});return api;}
const route=module('supabase/functions/_shared/later-rent.ts');
const terms=module('src/lib/longLetRentTerms.ts');
const history=module('src/lib/laterRent.ts',{'./longLetRentTerms':terms});
const receipts=module('src/lib/paymentReceiptContract.ts');
const purposes=module('src/lib/paymentPurposes.ts');
const debitImports={'./later-rent.ts':route};
const debit=module('supabase/functions/_shared/later-rent-debit.ts',debitImports);

test('automatic rent requires a provider-verified reusable card from the exact tenant payment',()=>{
 const source={source_reference:'rent-paid',transaction_id:'123',amount_minor:15000000,currency:'NGN'};
 const receipt={reference:'rent-paid',id:123,amount:15000000,currency:'NGN',domain:'test',status:'success',customer:{email:'payer@example.invalid'},authorization:{authorization_code:'AUTH_Synthetic',last4:'0123',exp_month:'12',exp_year:'2050',reusable:true,channel:'card',card_type:'Visa'}};
 assert.equal(debit.reusableRentCard(receipt,source,'test').p_last4,'0123');
 for(const change of [{reference:'another-payment'},{id:321},{amount:1},{domain:'live'},{status:'pending'},{authorization:{...receipt.authorization,reusable:false}},{authorization:{...receipt.authorization,exp_year:'2020'}},{authorization:{...receipt.authorization,channel:'bank'}}])assert.throws(()=>debit.reusableRentCard({...receipt,...change},source,'test'));
});

test('automatic debit verifies a lost charge response without creating another charge or changing rent',async()=>{
 const p={consent_id:'consent',status:'active',payment_id:'payment',reference:'WHNEXT-TEST',authorization_code:'AUTH_Synthetic',email:'payer@example.invalid',environment:'test',amount_minor:15000000,currency:'NGN',split_started:false,split_code:null,split_lookup_page:1,attempted:false,route:{version:1,environment:'test',amount_minor:15000000,partner_amount_minor:13500000,platform_amount_minor:1500000,subaccount_code:'ACCT_Partner'}};
 const calls=[],requests=[];let verified=false;
 const db={rpc:async(name,args)=>{calls.push({name,args});let data=true;if(name==='claim_due_later_rent_debit')data={...p};if(name==='start_later_rent_debit_split'){data=!p.split_started;p.split_started=true;}if(name==='save_later_rent_debit_split')p.split_code=args.p_split_code;if(name==='authorize_later_rent_debit_dispatch'){data=!p.attempted;p.attempted=true;}if(name==='process_verified_paystack_charge')data={success:true};return{data,error:null};}};
 const split={name:'WeHouse rent WHNEXT-TEST',type:'flat',currency:'NGN',active:true,bearer_type:'account',split_code:'SPL_Synthetic',subaccounts:[{subaccount:{subaccount_code:'ACCT_Partner'},share:13500000}]};
 const fetch=async(url,options)=>{requests.push({url,options});if(url.includes('/charge_authorization'))throw Error('Provider accepted but connection was lost');if(url.includes('/transaction/verify/')){if(!verified)throw Error('Still unavailable');return{ok:true,json:async()=>({status:true,data:{id:123,reference:p.reference,amount:15000000,currency:'NGN',domain:'test',status:'success',split:{shares:{subaccounts:[{id:45,subaccount_code:'ACCT_Partner',amount:13500000}]}}}})};}return{ok:true,json:async()=>({status:true,data:split})};};
 const service=module('supabase/functions/_shared/later-rent-debit.ts',debitImports,{fetch});
 assert.equal((await service.runLaterRentDebit(db,'sk_test_fixture')).status,'pending');verified=true;
 assert.equal((await service.runLaterRentDebit(db,'sk_test_fixture')).status,'confirmed');
 assert.equal(requests.filter(r=>r.url.endsWith('/charge_authorization')).length,1);assert.equal(requests.filter(r=>r.url.endsWith('/split')&&r.options.method==='POST').length,1);
 const charge=JSON.parse(requests.find(r=>r.url.endsWith('/charge_authorization')).options.body);assert.equal(charge.amount,'15000000');assert.equal(charge.reference,'WHNEXT-TEST');assert.equal(charge.split_code,'SPL_Synthetic');
 assert.equal(calls.filter(c=>c.name==='process_verified_paystack_charge').length,1);assert.equal(calls.find(c=>c.name==='process_verified_paystack_charge').args.p_provider_reference,p.reference);
 assert.ok(requests.every(r=>!r.url.includes('/transfer')));
});
test('direct checkout freezes one flat Partner share and preserves the platform amount',()=>{
 const saved={version:1,environment:'test',amount_minor:15000000,partner_amount_minor:13500000,platform_amount_minor:1500000,subaccount_code:'ACCT_Test'};
 const split=route.rentCheckoutSplit(saved,15000000,'test');assert.equal(split.type,'flat');assert.equal(split.bearer_type,'account');assert.equal(split.subaccounts.length,1);assert.equal(split.subaccounts[0].share,13500000);
 for(const changed of [{environment:'live'},{amount_minor:1},{partner_amount_minor:15000000},{platform_amount_minor:-1},{subaccount_code:'bad'},{version:2},{partner_amount_minor:null},{platform_amount_minor:null},{amount_minor:'15000000'}])assert.throws(()=>route.rentCheckoutSplit({...saved,...changed},15000000,'test'));
});
test('provider proof uses actual split shares and rejects metadata-only or multiple recipients',()=>{
 const payment={id:123,amount:15000000,currency:'NGN',domain:'test',metadata:{partner_amount_minor:13500000},split:{shares:{subaccounts:[{id:45,subaccount_code:'ACCT_Partner',amount:13500000}]}}};
 assert.equal(route.rentChargeRouteProof(payment).p_partner_minor,13500000);
 assert.equal(route.rentChargeRouteProof({...payment,split:{}}).p_partner_minor,null);
 assert.equal(route.rentChargeRouteProof({...payment,split:{shares:{subaccounts:[{},{}]}}}).p_partner_minor,null);
});
function record(){return{reservation_id:'rent',plan_id:'11111111-1111-4111-8111-111111111111',viewer:'customer',currency:'NGN',agreement_digest:'a'.repeat(32),plan_status:'active',collection_available:true,settlement_consent:null,
 years:[{target_year:2,annual_rent:1200000,gross_rent_paid:150000,completed_months:1,partial_month_credit:50000,next_month_balance:50000,remaining_year_rent:1050000}],
 items:[{contribution_id:'22222222-2222-4222-8222-222222222222',agreement_sequence:2,target_year:2,due_date:'2026-10-27',amount:150000,paystack_reference:'WHNEXT-'+ 'A'.repeat(32),payment_status:'paid',settlement_status:'pending',amount_commission:15000,net_amount:135000,paid_at:'2026-10-27T12:00:00Z',can_pay:false}],has_more:false,next_sequence:null};}
test('history checks gross rent coverage independently of net settlement and pagination',()=>{
 const r=record();assert.equal(history.rentHistoryReceipt(r,'rent').years[0].completed_months,1);
 assert.throws(()=>history.rentHistoryReceipt({...r,reservation_id:'someone-else'},'rent'));
 for(const key of ['completed_months','partial_month_credit','next_month_balance','remaining_year_rent']){const bad=record();bad.years[0][key]+=1;assert.throws(()=>history.rentHistoryReceipt(bad,'rent'));}
 const netCredit=record();netCredit.years[0].gross_rent_paid=135000;assert.throws(()=>history.rentHistoryReceipt(netCredit,'rent'));
 const wrongFee=record();wrongFee.items[0].amount_commission=120000;assert.throws(()=>history.rentHistoryReceipt(wrongFee,'rent'));
 const stale=record();stale.has_more=true;stale.next_sequence=1;assert.throws(()=>history.rentHistoryReceipt(stale,'rent'));
});
test('settlement reconciliation pages a large batch and never submits a transfer',async()=>{
 const calls=[],requests=[];const payment={payment_id:'payment',reference:'rent-reference',transaction_id:'123',currency:'NGN',paid_at:'2026-10-27T12:00:00Z',net_amount:135000,route:{environment:'test',subaccount_provider_id:'45',partner_amount_minor:13500000},page:1,transaction_page:1};
 const db={rpc:async(name,args)=>{calls.push({name,args});return{data:name==='claim_due_rent_settlement_checks'?[payment]:{success:true},error:null};}};
 const fetch=async(url)=>{requests.push(url);assert.match(url,/^https:\/\/api\.paystack\.co\/settlement/);let data;if(url.includes('/transactions?'))data=payment.transaction_page===1?Array.from({length:25},(_,i)=>({reference:'other-'+i})): [{reference:'rent-reference',id:123,status:'success',currency:'NGN',domain:'test',split:{shares:{subaccounts:[{id:45,subaccount_code:'ACCT_Test',amount:13500000}]}}}];else data=[{id:55,status:'success',currency:'NGN',domain:'test'}];return{ok:true,json:async()=>({status:true,data})};};
 const service=module('supabase/functions/_shared/later-rent-settlement.ts',{'./later-rent.ts':route},{fetch});
 await service.reconcileLaterRentSettlements(db,'sk_test_fixture');
 const cursor=calls.find(c=>c.name==='finish_rent_settlement_check');assert.equal(cursor.args.p_transaction_page,2);assert.equal(cursor.args.p_next_page,1);assert.equal(calls.filter(c=>c.name==='record_verified_rent_settlement').length,0);
 payment.transaction_page=2;await service.reconcileLaterRentSettlements(db,'sk_test_fixture');
 const receipts=calls.filter(c=>c.name==='record_verified_rent_settlement');assert.equal(receipts.length,1);assert.equal(receipts[0].args.p_net_minor,13500000);assert.equal(receipts[0].args.p_subaccount_id,'45');assert.equal(receipts[0].args.p_settlement_id,'55');assert.equal(requests.length,4);
});
test('unknown or inconsistent provider settlements keep rent unresolved',async()=>{
 const calls=[];const p={payment_id:'payment',reference:'rent-reference',transaction_id:'123',currency:'NGN',paid_at:'2026-10-27T12:00:00Z',route:{environment:'test',subaccount_provider_id:'45',partner_amount_minor:13500000},page:1,transaction_page:1};
 const db={rpc:async(name,args)=>{calls.push({name,args});return{data:name==='claim_due_rent_settlement_checks'?[p]:{},error:null};}};
 const service=module('supabase/functions/_shared/later-rent-settlement.ts',{'./later-rent.ts':route},{fetch:async()=>{throw Error('network outcome unknown');}});
 await service.reconcileLaterRentSettlements(db,'sk_test_fixture');assert.equal(calls.filter(c=>c.name==='record_verified_rent_settlement').length,0);assert.equal(calls.find(c=>c.name==='finish_rent_settlement_check').args.p_next_page,1);
});
test('rent receipts and confirmation copy distinguish direct rent from protected initial rent',()=>{
 const receipt={id:'payment',reference:'WHNEXT-TEST',purpose:'rent_plan_contribution',amount:150000,currency:'NGN',paid_at:'2026-10-27T12:00:00Z',status:'paid',environment:'test',payer_name:'Ada',merchant_name:'Home',description:'Later-year rent',rent_target_year:2,rent_settlement_status:'pending',rent_payment_protection_hold:false};
 receipts.assertPaymentReceipt(receipt);
 for(const change of [{rent_target_year:1},{rent_settlement_status:'paid_out'},{purpose:'hotel_booking'},{rent_payment_protection_hold:true},{rent_target_year:null}])assert.throws(()=>receipts.assertPaymentReceipt({...receipt,...change}));
 assert.match(purposes.paymentSuccessMessage('rent_plan_contribution'),/no new protection hold/);
 assert.doesNotMatch(purposes.paymentSuccessMessage('rent_plan_contribution'),/holds it/);
 assert.match(purposes.paymentSuccessMessage('apartment_rent'),/Payment Protection/);
});
