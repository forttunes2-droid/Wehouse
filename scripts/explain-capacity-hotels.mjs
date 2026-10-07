import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const psql = query => execFileSync(
  'docker',
  ['exec','supabase_db_wehouse','psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-Atc',query],
  {encoding:'utf8'}
);

const definition=psql(
  "select pg_get_functiondef(oid) from pg_proc where oid='public.search_discoverable_hotels(text,text,text,text[],numeric,numeric,double precision,double precision,numeric,boolean,timestamptz,integer,integer)'::regprocedure"
);
const bodyMatch=definition.match(/\$[A-Za-z_0-9]*\$(.*)\$[A-Za-z_0-9]*\$/s);
const query=bodyMatch?.[1];
if (!query) throw new Error('Parameterized hotel query body unavailable');

const values={
  p_query:'NULL::text',
  p_state:'NULL::text',
  p_city:'NULL::text',
  p_amenities:'NULL::text[]',
  p_min_price:'NULL::numeric',
  p_max_price:'NULL::numeric',
  p_lat:'NULL::double precision',
  p_lng:'NULL::double precision',
  p_radius_km:'NULL::numeric',
  p_cursor_featured:'NULL::boolean',
  p_cursor_created_at:'NULL::timestamptz',
  p_cursor_id:'NULL::integer',
  p_limit:'24::integer'
};

const render = overrides => {
  const params={...values,...overrides};
  return query.replace(
    /\b(p_query|p_state|p_city|p_amenities|p_min_price|p_max_price|p_lat|p_lng|p_radius_km|p_cursor_featured|p_cursor_created_at|p_cursor_id|p_limit)\b/g,
    (_,name)=>params[name]
  );
};

mkdirSync('test-results',{recursive:true});
for(const scenario of ['feed','city','price']){
  const overrides={};
  if(scenario==='city') overrides.p_city="'Lafia'::text";
  if(scenario==='price'){
    overrides.p_min_price='22000::numeric';
    overrides.p_max_price='24000::numeric';
  }
  const plan=psql('EXPLAIN (ANALYZE,BUFFERS,TIMING OFF) '+render(overrides));
  writeFileSync('test-results/requested-hotel-'+scenario+'-plan.txt',plan);
  console.log('Hotel '+scenario+' plan\n'+plan);
}
