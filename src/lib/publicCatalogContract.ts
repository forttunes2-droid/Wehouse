export type PublicCatalogKind = 'homes' | 'hotels';
export const PUBLIC_CATALOG_MAX_PRICE = 2_000_000_000;
const shared = ['p_state','p_city','p_min_price','p_max_price','p_limit'];
const keys = {
  homes: [...shared,'p_stay_type','p_min_bedrooms','p_min_bathrooms','p_home_style'],
  hotels: [...shared,'p_amenities'],
};
/** Only anonymous, non-personalized feed filters may cross the shared cache. */
export function publicCatalogQuery(kind: PublicCatalogKind, input: Record<string, unknown>): URLSearchParams {
  if (!Object.hasOwn(keys,kind)) throw Error('Unsupported catalog');
  const query = new URLSearchParams({kind});
  for (const [key,value] of Object.entries(input)) {
    if (value == null || value === '') continue;
    if (!keys[kind].includes(key)) throw Error('This search requires an uncached read');
    if (key === 'p_amenities') {
      if (!Array.isArray(value) || value.length > 20 || value.some(item=>typeof item!=='string'||!item.trim()||item.length>60)) throw Error('Invalid amenities');
      query.set(key,JSON.stringify([...new Set(value)].sort()));
    } else if (['p_min_price','p_max_price','p_min_bedrooms','p_min_bathrooms','p_limit'].includes(key)) {
      if (typeof value!=='number'||!Number.isFinite(value)||value<0||value>PUBLIC_CATALOG_MAX_PRICE) throw Error('Invalid catalog number');
      if ((key==='p_limit'&&value!==24)||(['p_min_bedrooms','p_min_bathrooms'].includes(key)&&(!Number.isInteger(value)||value>100))) throw Error('Invalid catalog bounds');
      query.set(key,String(value));
    } else {
      if (typeof value!=='string'||!value.trim()||value.length>100) throw Error('Invalid catalog filter');
      if (key==='p_stay_type'&&!['short_let','long_stay'].includes(value)) throw Error('Invalid stay type');
      query.set(key,value.trim());
    }
  }
  query.set('p_limit','24');
  const min=Number(query.get('p_min_price')||0),max=query.get('p_max_price');
  if(max!==null&&Number(max)<min)throw Error('Invalid price range');
  query.sort();return query;
}
export function parsePublicCatalogQuery(query: URLSearchParams) {
  const kind=query.get('kind') as PublicCatalogKind;
  const input:Record<string,unknown>={};
  for(const [key,value] of query){
    if(query.getAll(key).length!==1)throw Error('Duplicate catalog parameter');
    if(key==='kind')continue;
    input[key]=key==='p_amenities'?JSON.parse(value):['p_min_price','p_max_price','p_min_bedrooms','p_min_bathrooms','p_limit'].includes(key)?Number(value):value;
  }
  const canonical=publicCatalogQuery(kind,input);
  return {kind,body:{...input,p_limit:24},canonical};
}
