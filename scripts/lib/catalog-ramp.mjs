export function catalogRamp(value = '200') {
  if (!['200','500','1000'].includes(String(value))) throw Error('Catalog ceiling must be 200, 500 or 1000 requests/second');
  const maximum = Number(value);
  return [1,5,10,25,50,100,200,500,1000].filter(rate=>rate<=maximum).map(rate=>[rate,30]);
}
