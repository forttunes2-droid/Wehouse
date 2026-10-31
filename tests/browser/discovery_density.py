"""Real Explore screens at small and full-page result counts; no hosted traffic."""
import asyncio,json,re
from pathlib import Path
from urllib.parse import urlparse,parse_qs
from playwright.async_api import async_playwright,expect
from shared_discovery import SCRIPT,HOME,HOTEL,B,OUT

async def main():
 results=[];OUT.mkdir(parents=True,exist_ok=True)
 async with async_playwright() as p:
  browser=await p.chromium.launch(args=['--no-sandbox'])
  for theme in ('light','dark'):
   for width in (320,390,768,1440):
    for family,selector in [('homes','[data-home-card]'),('hotels','[data-hotel-card]'),('providers','[data-service-card]'),('roommates','[data-activity-context]')]:
     for count in (0,1,3,24):
      context=await browser.new_context(viewport={'width':width,'height':900},service_workers='block');page=await context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
      async def route(handler):
       url=handler.request.url
       if url=='https://wehouse-preview.vercel.app/':return await handler.fulfill(status=200,content_type='text/html',body=f'<html class="{"dark" if theme=="dark" else ""}" data-wh-theme="{theme}"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>')
       if url.startswith('https://wehouse-preview.vercel.app/api/public-catalog?'):
        assert handler.request.method=='GET' and not handler.request.headers.get('authorization')
        params={k:v[0] for k,v in parse_qs(urlparse(url).query).items()};assert params['kind']=='homes'
        await page.evaluate('q=>window.__browse.gatewayRequests.push(q)',params)
        homes=[{**HOME,'id':'density-home-'+str(i),'title':'Courtyard apartment '+str(i),'sub_type':'short_let' if i%2 else 'long_stay','images':HOME['images'] if i%2 else []} for i in range(count)]
        return await handler.fulfill(status=200,content_type='application/json',body=json.dumps({'items':homes,'has_more':False,'next_cursor_created_at':None,'next_cursor_id':None}))
       if url.startswith('https://wehouse-preview.vercel.app/brand/v4/'):
        return await handler.fulfill(status=200,content_type='image/svg+xml',body=Path('public/brand/v4',urlparse(url).path.rsplit('/',1)[-1]).read_bytes())
       if url=='https://assets.wehouse.test/interior.jpg':return await handler.fulfill(status=200,content_type='image/jpeg',body=Path('public/hero-interior.jpg').read_bytes())
       return await handler.abort()
      await page.route('**/*',route)
      try:
       await page.goto('https://wehouse-preview.vercel.app/')
       await page.evaluate(SCRIPT,{'mode':family,'calls':[],'unexpected':[],'home':HOME,'hotel':HOTEL,'homeCount':count,'hotelCount':count,'layoutCount':count})
       await page.add_style_tag(path=str(B/'fixture.css'));await page.add_script_tag(path=str(B/'fixture.js'))
       await page.wait_for_function('window.__browse.calls.length>0||window.__browse.gatewayRequests.length>0')
       await expect(page.get_by_role('status',name=re.compile('^Loading'))).to_have_count(0)
       await expect(page.locator(selector)).to_have_count(count)
       assert not await page.evaluate('document.documentElement.scrollWidth>innerWidth+1')
       if count:
        widths=await page.locator(selector).evaluate_all('(nodes)=>nodes.map(n=>n.getBoundingClientRect().width)')
        assert min(widths)>=210 and max(widths)<=width,{'family':family,'width':width,'cardWidths':widths}
        # Every loaded item appears once, in the supplied order. Rows do not fetch.
        reads=await page.evaluate('window.__browse.calls.length+window.__browse.gatewayRequests.length')
        groups=page.locator('[data-discovery-rows] [role="group"]')
        if count==24:
         await expect(groups).to_have_count(3)
         await groups.first.focus();await page.keyboard.press('ArrowRight')
         assert await page.evaluate('window.__browse.calls.length+window.__browse.gatewayRequests.length')==reads
        media=page.locator('[data-home-media],[data-hotel-media],[data-service-card] > button')
        for box in await media.evaluate_all('(nodes)=>nodes.map(n=>{const r=n.getBoundingClientRect();return{w:r.width,h:r.height}})'):
         assert abs(box['w']/box['h']-4/3)<.02,'Photo geometry changed for missing media'
       if family=='providers':assert all(n<=24 for n in await page.evaluate('window.__browse.photoBatches||[]'))
       if family=='roommates':assert await page.evaluate('window.__browse.channels')==1,'Cards must not create one subscription per profile'
       assert not errors,errors
       assert not await page.evaluate('window.__browse.unexpected'),await page.evaluate('window.__browse.unexpected')
       if count==24 and width in (390,1440):await page.screenshot(path=str(OUT/f'discovery-{family}-{count}-{width}-{theme}.png'),full_page=True)
       results.append({'family':family,'theme':theme,'width':width,'count':count,'passed':True})
      except Exception:
       await page.screenshot(path=str(OUT/f'discovery-density-FAIL-{family}-{count}-{width}-{theme}.png'),full_page=True)
       raise
      finally:await context.close()
  await browser.close()
 (OUT/'discovery-density-results.json').write_text(json.dumps(results,indent=2));print('Explore density cases passed:',len(results))
if __name__=='__main__':asyncio.run(main())
