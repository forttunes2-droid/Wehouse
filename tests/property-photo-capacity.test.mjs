import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const {outputFiles}=await build({entryPoints:['src/lib/propertySubmissionFacts.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const {propertySubmissionFactsError}=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'));
test('property and room photos are bounded without excluding zero-bedroom studios',()=>{
 const home={propertyType:'apartment',bedrooms:'0',bathrooms:'1',files:Array(12),hotelRooms:[]};
 assert.equal(propertySubmissionFactsError(home),null);assert.match(propertySubmissionFactsError({...home,files:Array(13)}),/12 property photos/);
 const hotel={...home,propertyType:'hotel',hotelRooms:[{maxGuests:'2',inventory:'3',files:Array(13)}]};
 assert.match(propertySubmissionFactsError(hotel),/Room type 1.*12 photos/);
 assert.equal(propertySubmissionFactsError({...hotel,hotelRooms:[{...hotel.hotelRooms[0],files:Array(12)}]}),null);
});
