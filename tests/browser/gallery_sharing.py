"""Actual shared bubbles/carousel; local synthetic images/API, no hosted writes."""
import asyncio,json,os
from pathlib import Path
from playwright.async_api import async_playwright,expect
BASE=os.getenv('QA_BASE_URL','http://127.0.0.1:4173');OUT=Path('test-results/gallery-sharing')
async def main():
 OUT.mkdir(parents=True,exist_ok=True);results=[]
 async with async_playwright() as p:
  browser=await p.chromium.launch(args=['--no-sandbox'])
  try:
   for theme,width in [('light',390),('dark',1280)]:
    context=await browser.new_context(viewport={'width':width,'height':1000},has_touch=True,service_workers='block');page=await context.new_page();errors=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    async def route(handler):
     url=handler.request.url
     if '/gallery-photo-' in url:return await handler.fulfill(content_type='image/svg+xml',body='<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><rect width="800" height="500" fill="#67538f"/></svg>')
     if url.startswith(BASE):return await handler.continue_()
     if url.startswith('http://127.0.0.1:54321/'):
      headers={'access-control-allow-origin':'*','access-control-allow-headers':'*'}
      if handler.request.method=='OPTIONS':return await handler.fulfill(status=204,headers=headers)
      name=url.split('?')[0].split('/')[-1]
      if name=='get_public_listing_detail':data={'id':'shared-home','listing_id':'public-home-reference','title':'Shared home','sub_type':'short_let','city':'Lafia','state':'Nasarawa','images':[]}
      elif name=='get_public_hotel_detail':data={'hotel_id':42,'name':'Shared Hotel','city':'Lafia','state':'Nasarawa','images':[]}
      else:raise AssertionError('Unexpected API '+name)
      return await handler.fulfill(content_type='application/json',body=json.dumps(data),headers=headers)
     await handler.abort()
    await page.route('**/*',route)
    try:
     await page.goto(BASE+'/tests/browser/gallery-sharing.html?theme='+theme)
     hero=page.get_by_role('region',name='Gallery property media',exact=True)
     await hero.get_by_role('button',name='Next photo',exact=True).focus()
     await hero.get_by_role('button',name='Next photo',exact=True).press('Enter')
     await expect(hero.get_by_text('2 / 3',exact=True)).to_be_visible()
     await hero.get_by_role('button',name='View image 2 of 3 full screen',exact=True).click()
     dialog=page.get_by_role('dialog',name='Gallery property media viewer',exact=True)
     await expect(dialog.get_by_text('2 of 3 · image',exact=True)).to_be_visible()
     await dialog.get_by_role('button',name='Open image 3',exact=True).click()
     await expect(dialog.get_by_text('3 of 3 · image',exact=True)).to_be_visible()
     await dialog.get_by_role('button',name='Back from media viewer',exact=True).click()
     await expect(dialog).to_have_count(0)
     rail=hero.locator('div.snap-x').first
     assert await rail.evaluate('(r)=>Math.abs(r.scrollLeft/r.clientWidth-2)<.03'),'Closing viewer restored the wrong image'
     await page.set_viewport_size({'width':768 if width<768 else 960,'height':1000})
     await page.wait_for_timeout(150)
     assert await rail.evaluate('(r)=>Math.abs(r.scrollLeft/r.clientWidth-2)<.03'),'Resize lost image position'
     await hero.get_by_role('button',name='View image 3 of 3 full screen',exact=True).click()
     await page.go_back();await expect(dialog).to_have_count(0)
     await page.get_by_role('button',name='Change property',exact=True).click()
     await expect(page.get_by_role('region',name='Another property media',exact=True).get_by_text('1 / 2',exact=True)).to_be_visible()
     for side in ['sent','received']:
      for kind in ['listing','hotel']:
       card=page.get_by_test_id(side+'-'+kind).get_by_role('button',name='View ',exact=False)
       await card.tap()
       await expect(page.get_by_label('Opened shared item',exact=True)).to_have_text(json.dumps({'kind':kind,'page':'hotel_detail' if kind=='hotel' else 'detail','id':42 if kind=='hotel' else 'shared-home' if side=='sent' else 'public-home-reference'},separators=(',',':')))
     assert not errors,errors
     await page.screenshot(path=str(OUT/f'gallery-sharing-{theme}.png'))
     results.append({'theme':theme,'passed':True,'checks':['fullscreen close sync','resize preserves position','browser Back sync','new property resets index','sent and received Home/Hotel touch navigation']})
    finally:await context.close()
  finally:await browser.close()
 (OUT/'results.json').write_text(json.dumps(results,indent=2));print(json.dumps(results))
if __name__=='__main__':asyncio.run(main())
