"""Real location hook with controlled device/API replies; verifies stale GPS/address races."""
import asyncio,json,os
from pathlib import Path
from playwright.async_api import async_playwright,expect
BASE=os.getenv('QA_BASE_URL','http://127.0.0.1:4173')
async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(args=['--no-sandbox'])
  context=await browser.new_context(service_workers='block');page=await context.new_page();release=asyncio.Event();started=asyncio.Event();calls=[]
  await page.add_init_script("window.__gps=[];Object.defineProperty(navigator,'geolocation',{value:{getCurrentPosition:(ok,fail)=>window.__gps.push({ok,fail})}})")
  async def route(handler):
   if handler.request.url.startswith(BASE):return await handler.continue_()
   if '/functions/v1/reverse-geocode' not in handler.request.url:return await handler.abort()
   headers={'access-control-allow-origin':'*','access-control-allow-headers':'*'}
   if handler.request.method=='OPTIONS':return await handler.fulfill(status=204,headers=headers)
   calls.append(handler.request.post_data_json);started.set();await release.wait()
   await handler.fulfill(status=200,headers=headers,content_type='application/json',body=json.dumps({'address':'Keffi, Nasarawa','city':'Keffi','state':'Nasarawa'}))
  await page.route('**/*',route)
  try:
   await page.goto(BASE+'/tests/browser/discovery-location.html')
   await page.get_by_role('button',name='Use my location',exact=True).click()
   await page.get_by_role('button',name='Clear location',exact=True).click()
   await page.evaluate("()=>{window.__gps[0].ok({coords:{latitude:8.8,longitude:7.8,accuracy:10}})}")
   await expect(page.get_by_label('Location',exact=True)).to_have_text('none');assert not calls
   await page.get_by_role('button',name='Use my location',exact=True).click()
   await page.evaluate("()=>{window.__gps[1].ok({coords:{latitude:8.8,longitude:7.8,accuracy:10}})}")
   await asyncio.wait_for(started.wait(),5)
   await page.get_by_role('button',name='Clear location',exact=True).click();release.set()
   await page.wait_for_timeout(150)
   await expect(page.get_by_label('Location',exact=True)).to_have_text('none')
   assert await page.evaluate("sessionStorage.getItem('wh_discovery_location_v2')") is None
   await expect(page.get_by_label('Locating',exact=True)).to_have_text('false')
   await page.get_by_role('button',name='Use my location',exact=True).click()
   await page.evaluate("()=>{window.__gps[2].ok({coords:{latitude:8.8,longitude:7.8,accuracy:10}})}")
   await expect(page.get_by_label('Location',exact=True)).to_contain_text('Keffi, Nasarawa')
   await page.get_by_role('button',name='Use my location',exact=True).click()
   await page.evaluate("()=>{window.__gps[3].fail({code:1,PERMISSION_DENIED:1})}")
   await expect(page.get_by_text('Allow location access to use your current location.',exact=True)).to_be_visible()
   print('PASS: pending GPS, pending reverse lookup, storage erasure, successful address and denied permission')
  finally:await context.close();await browser.close()
if __name__=='__main__':asyncio.run(main())
