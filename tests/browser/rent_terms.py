"""Real rental-term control with isolated HTTP receipts. No provider traffic."""
import asyncio,json,os
from pathlib import Path
from playwright.async_api import async_playwright,expect
BASE=os.environ.get('QA_BASE_URL','http://127.0.0.1:4173')
OUT=Path('test-results/rent-terms')
async def main():
 OUT.mkdir(parents=True,exist_ok=True);results=[]
 async with async_playwright() as p:
  browser=await p.chromium.launch(args=['--no-sandbox'])
  try:
   for theme,width in [('light',390),('dark',1280)]:
    context=await browser.new_context(viewport={'width':width,'height':950},service_workers='block');page=await context.new_page()
    saved={'listing_id':'b7990000-2000-4000-8000-000000000001','revision':1,'accepted_terms_months':[12],'monthly_accepted':False}
    failures={'write':True};calls=[];errors=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    async def route(handler):
     request=handler.request
     if request.url.startswith(BASE): return await handler.continue_()
     if not request.url.startswith('http://127.0.0.1:54321/'): return await handler.abort()
     headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'}
     if request.method=='OPTIONS': return await handler.fulfill(status=204,headers=headers)
     name=request.url.split('/')[-1];args=request.post_data_json or {};calls.append((name,args))
     data=saved.copy()
     if name=='set_my_long_let_rent_terms':
      if failures['write']: data={**saved,'monthly_accepted':False}
      else: saved.update(revision=2,accepted_terms_months=args['p_terms_months'],monthly_accepted=args['p_monthly_accepted']);data=saved.copy()
     await handler.fulfill(status=200,content_type='application/json',body=json.dumps(data),headers=headers)
    await page.route('**/*',route)
    try:
     await page.goto(BASE+'/tests/browser/rent-terms.html?theme='+theme)
     await expect(page.get_by_role('checkbox',name='1 year',exact=True)).to_be_checked()
     await page.get_by_role('checkbox',name='3 months',exact=True).check()
     await page.get_by_role('checkbox',name='Accept monthly rent',exact=True).check()
     await page.get_by_role('button',name='Save rental terms',exact=True).click()
     await expect(page.get_by_role('alert')).to_contain_text('did not match your choices')
     await expect(page.get_by_text('Rental terms saved. Existing agreements are unchanged.',exact=True)).to_have_count(0)
     await expect(page.get_by_role('checkbox',name='Accept monthly rent',exact=True)).to_be_checked()
     failures['write']=False
     await page.get_by_role('button',name='Refresh saved terms',exact=True).click()
     await expect(page.get_by_role('checkbox',name='Accept monthly rent',exact=True)).not_to_be_checked()
     await page.get_by_role('checkbox',name='3 months',exact=True).check()
     await page.get_by_role('checkbox',name='Accept monthly rent',exact=True).check()
     await page.get_by_role('button',name='Save rental terms',exact=True).click()
     await expect(page.get_by_text('Rental terms saved. Existing agreements are unchanged.',exact=True)).to_be_visible()
     await expect(page.get_by_role('button',name='Save rental terms',exact=True)).to_be_disabled()
     assert saved['accepted_terms_months']==[3,12] and saved['monthly_accepted'] is True
     assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
     assert not errors,errors
     await page.screenshot(path=str(OUT/f'partner-terms-{theme}.png'),full_page=True)
     results.append({'theme':theme,'width':width,'passed':True,'checks':['saved offer','malformed write cannot report success','draft preserved after unknown result','refresh and recovery']})
    finally: await context.close()
  finally:
   await browser.close();(OUT/'results.json').write_text(json.dumps(results,indent=2))
asyncio.run(main())
