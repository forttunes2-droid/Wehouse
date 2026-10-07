import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
const psql = query => execFileSync('docker',['exec','supabase_db_wehouse','psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-Atc',query],{encoding:'utf8'});
const definition=psql("select pg_get_functiondef(oid) from pg_proc where oid='public.search_discoverable_hotels(text,text,text,text[],numeric,numeric,double precision,double precision,numeric,boolean,timestamptz,integer,integer)'::regprocedure");
const bodyMatch=definition.match(/\$[A-Za-z_0-9]*\$(.*)\$[A-Za-z_0-9]*\$/s);
const query=bodyMatch?.[1];
if (!query) throw new Error('Parameterized hotel query body unavailable');
const nulls=['NULL::text','NULL::text','NULL::text','NULL::text[]','NULL::numeric','NULL::numeric','NULL::double precision','NULL::double precision','NULL::numeric','NULL::boolean','NULL::timestamptz','NULL::integer','24::integer'];
mkdirSync('test-results',{recursive:true});
for(const scenario of ['feed','city','price']){
  const values=[...nulls];
  if(scenario==='city') values[2]="'Lafia'::text";
  if(scenario==='price'){values[4]='22000::numeric';values[5]='24000::numeric';}
  const rendered=query.replace(/\$(\d+)/g,(_,index)=>values[Number(index)-1]);
  const plan=psql('EXPLAIN (ANALYZE,BUFFERS,TIMING OFF) '+rendered);
  writeFileSync('test-results/requested-hotel-'+scenario+'-plan.txt',plan);
  console.log('Hotel '+scenario+' plan\n'+plan);
}
