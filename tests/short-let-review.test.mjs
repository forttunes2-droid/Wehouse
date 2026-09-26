import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
function load(path){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Date,Intl});return exports;}
const {shortLetPayment}=load('src/lib/shortLetPayment.ts');
const {validateShortLetDates}=load('src/lib/shortLetQuote.ts');
const selection={checkIn:'2026-09-24',checkOut:'2026-09-26',today:'2026-09-23',lastDate:'2027-09-23',minNights:1,maxNights:90,guests:2,maxGuests:2};
test('date step validates without a rent/deposit calculation',()=>{const value=validateShortLetDates(selection);assert.equal(value.valid,true);assert.equal(value.nights,2);assert.equal('total' in value,false);assert.equal('rent' in value,false)});
for(const change of [{checkOut:''},{checkOut:'2026-09-24'},{guests:3},{checkIn:'2026-02-30'},{checkIn:'2026-09-22'}])test(`invalid selection cannot reserve: ${JSON.stringify(change)}`,()=>assert.equal(validateShortLetDates({...selection,...change}).valid,false));
test('review uses stored amounts in kobo and keeps deposit separately',()=>{const bill=shortLetPayment({stay_type:'short_let',stay_rent_total:'240000.10',security_deposit_snapshot:'50000.20'});assert.equal(bill.rent,240000.10);assert.equal(bill.deposit,50000.20);assert.equal(bill.total,290000.30)});
for(const amount of [undefined,null,'',NaN,-1,'bad'])test(`missing or invalid snapshot never invents a payment: ${String(amount)}`,()=>assert.equal(shortLetPayment({stay_type:'short_let',stay_rent_total:amount,security_deposit_snapshot:0}),null));
test('Long Let cannot acquire a Short Let deposit',()=>assert.equal(shortLetPayment({stay_type:'long_stay',stay_rent_total:20000,security_deposit_snapshot:5000}),null));
test('date selector no longer renders a bill before its Reserve action',()=>{const source=fs.readFileSync('src/pages/ListingDetailCore.tsx','utf8');const block=source.slice(source.indexOf('Reserve your dates'),source.indexOf('Reserve this apartment'));assert.doesNotMatch(block,/Estimated total|Stay rent|quote\.total|Pay for stay/);assert.match(block,/Reserve date/);assert.match(fs.readFileSync('src/pages/MyReservations.tsx','utf8'),/ShortLetPaymentReview row=\{row\}/)});
