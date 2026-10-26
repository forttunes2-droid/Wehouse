export function catalogRamp(value = '200') {
  if (!['1','5','10','200','500','1000'].includes(String(value))) throw Error('Invalid catalog ceiling');
  const maximum = Number(value);
  return [1,5,10,25,50,100,200,500,1000].filter(rate=>rate<=maximum).map(rate=>[rate,30]);
}

/** Shared hosted Free project: small, explicitly dispatched checks only. */
export function freePlanCatalogRamp(value='1',shard='single') {
  if(shard!=='single'||!['1','5','10'].includes(String(value)))throw Error('Hosted Free checks allow one generator and a ceiling of 1, 5 or 10 requests/second');
  return catalogRamp(value);
}
