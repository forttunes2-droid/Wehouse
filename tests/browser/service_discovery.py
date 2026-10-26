"""Actual discovery rendering; synthetic public projections, no hosted reads or tracking."""
import asyncio,json,os
from pathlib import Path
from playwright.async_api import async_playwright,expect
BASE=os.environ.get('QA_BASE_URL','http://127.0.0.1:4173')
PROVIDERS=[{'user_id':'serves-keffi','full_name':'Keffi coverage provider','state':'Nasarawa','city':'Lafia','local_government':'Lafia','worker_occupation':'Cleaner','worker_skills':['Cleaning'],'worker_price':15000,'rating':4.8,'review_count':2,'coverage':[{'state':'Nasarawa','lga':'Keffi','areas':['University area']}]},{'user_id':'base-only','full_name':'Base-only provider','state':'Nasarawa','city':'Keffi','local_government':'Keffi','worker_occupation':'Cleaner','worker_skills':['Cleaning'],'worker_price':15000,'coverage':[{'state':'Nasarawa','lga':'Lafia','areas':[]}]}]
async def main():
 out=Path('test-results/experience');out.mkdir(parents=True,exist_ok=True);results=[]
 async with async_playwright() as p:
  browser=await p.chromium.launch(args=['--no-sandbox'])
  try:
   for theme,width in [('light',390),('dark',1280)]:
    context=await browser.new_context(viewport={'width':width,'height':900},service_workers='block');page=await context.new_page();calls=[];errors=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    async def route(handler):
     request=handler.request
     if request.url.startswith(BASE):return await handler.continue_()
     if not request.url.startswith('http://127.0.0.1:54321/'):return await handler.abort()
     headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'}
     if request.method=='OPTIONS':return await handler.fulfill(status=204,headers=headers)
     name=request.url.split('?')[0].split('/')[-1];calls.append(name)
     if name=='get_public_workers':data=PROVIDERS
     elif name=='get_public_discovery_settings':data=[{'key':'worker_marketplace_launch_enabled','value':'true'}]
     elif name in ['get_my_workspace_inbox','service_categories','service_subcategories']:data=[]
     else:raise AssertionError('Unexpected API '+name)
     return await handler.fulfill(status=200,headers=headers,content_type='application/json',body=json.dumps(data))
    await page.route('**/*',route)
    try:
     await page.goto(BASE+'/tests/browser/service-discovery.html?theme='+theme)
     await expect(page.get_by_role('heading',name='Keffi coverage provider',exact=True)).to_be_visible()
     await expect(page.get_by_role('heading',name='Base-only provider',exact=True)).to_have_count(0)
     await expect(page.get_by_text('Base: Lafia, Nasarawa',exact=True)).to_be_visible()
     await expect(page.get_by_text('Serves Keffi, Nasarawa',exact=True)).to_be_visible()
     assert 'worker_showcase_posts' not in calls,'Discovery still reads retired stories'
     assert not errors,errors
     assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
     await page.screenshot(path=str(out/f'service-coverage-{theme}.png'))
     results.append({'theme':theme,'width':width,'passed':True,'checks':['declared service area rather than base LGA','base and service area explained','retired story read removed']})
    finally:await context.close()
  finally:await browser.close()
 (out/'service-coverage-results.json').write_text(json.dumps(results,indent=2));print(json.dumps(results))
if __name__=='__main__':asyncio.run(main())
