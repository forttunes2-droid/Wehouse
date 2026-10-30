"""Count actual component reads while the browser clock controls typing pauses."""
async def install_read_counter(page):
 await page.clock.install()
 page._qa_discovery_clock=True
 await page.add_init_script("""window.__discoveryReads={};const transport=window.fetch.bind(window);window.fetch=(input,options)=>{const url=typeof input==='string'?input:input.url||String(input);let name=url.split('?')[0].split('/').pop();if(url.includes('/api/public-catalog?'))name='public_'+new URL(url,location.origin).searchParams.get('kind');if(url.includes('/rpc/')||url.includes('/api/public-catalog?'))window.__discoveryReads[name]=(window.__discoveryReads[name]||0)+1;return transport(input,options);};""")

async def settled_search(page, field, values, count):
 if not getattr(page,'_qa_discovery_clock',False):
  await page.clock.install()
  page._qa_discovery_clock=True
 await page.clock.pause_at(await page.evaluate('new Date(Date.now()+1000).toISOString()'))
 before=await page.evaluate(count)
 try:
  for value in values:
   await field.fill(value,force=True)
   await page.clock.run_for(60)
   actual=await page.evaluate(count)
   assert actual==before,f'Typing {value} started a read before settling; before={before}, after={actual}, counter={count}'
  await page.clock.run_for(350)
  # Poll the actual request receipt; no production transport is replaced here.
  for _ in range(30):
   if await page.evaluate(count)==before+1:break
   await page.clock.run_for(20)
  actual=await page.evaluate(count)
  assert actual==before+1,f'A settled search should issue one read; before={before}, after={actual}'
  await field.fill(values[-1]+' ',force=True)
  await page.clock.run_for(350)
  assert await page.evaluate(count)==before+1,'Whitespace-only editing repeated the same search'
 finally:
  await page.clock.resume()
