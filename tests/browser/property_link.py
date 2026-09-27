"""Public share-link intent across authentication and explicit workspace switching."""
import asyncio, json, re
from pathlib import Path
from playwright.async_api import async_playwright, expect
from experience import Scenario, BASE, ACCESS
OUT=Path('test-results/experience')
HOTEL={'hotel_id':7,'name':'Shared Garden Lodge','city':'Lafia','state':'Nasarawa','status':'active','images':[],'amenities':[],'hotel_rooms':[],'venues':[]}
class LinkScenario(Scenario):
 async def route(self, handler):
  if '/rpc/get_public_hotel_detail' in handler.request.url:
   self.calls.append(('get_public_hotel_detail',handler.request.post_data_json)); return await handler.fulfill(status=200,content_type='application/json',body=json.dumps(HOTEL),headers={'access-control-allow-origin':'*'})
  return await super().route(handler)
async def main():
 OUT.mkdir(parents=True,exist_ok=True); results=[]
 async with async_playwright() as p:
  browser=await p.chromium.launch(args=['--no-sandbox'])
  try:
   for workspace in ['personal','creator']:
    s=LinkScenario(); context=await browser.new_context(viewport={'width':390,'height':844},service_workers='block'); page=await context.new_page()
    await context.add_init_script("""localStorage.setItem('wh_workspace_experience-creator', %s);
      if (!sessionStorage.getItem('qa-seeded-property')) {
        sessionStorage.setItem('wh_public_property_intent_v1', JSON.stringify({property:{kind:'hotel',id:'7'},expires:Date.now()+1800000}));
        sessionStorage.setItem('qa-seeded-property','true');
      }""" % json.dumps(workspace))
    page.on('pageerror',lambda error:s.errors.append(str(error))); await page.route('**/*',s.route)
    try:
     # Public reference survives a login render without disclosing privileged data.
     await page.goto(BASE+'/tests/browser/experience.html?fixture=login')
     await page.get_by_role('button',name='Sign in',exact=True).click()
     await expect(page.get_by_role('heading',name='Welcome',exact=True)).to_be_visible()
     assert await page.evaluate("JSON.parse(sessionStorage.getItem('wh_public_property_intent_v1')).property.id")=='7'
     assert not any(name=='get_public_hotel_detail' for name,_ in s.calls)
     # This simulates returning from a successful provider callback; only auth fixture changes.
     await page.goto(BASE+'/tests/browser/experience.html?fixture=creator')
     if workspace=='creator':
      await expect(page.get_by_role('dialog',name='View shared property')).to_be_visible()
      assert not any(name=='get_public_hotel_detail' for name,_ in s.calls)
      await page.get_by_role('button',name='Open in Personal',exact=True).click()
     await expect(page.get_by_role('heading',name='Shared Garden Lodge',exact=True)).to_be_visible()
     assert await page.evaluate("localStorage.getItem('wh_workspace_experience-creator')")=='personal'
     assert await page.evaluate("sessionStorage.getItem('wh_public_property_intent_v1')") is None
     assert not any(name=='get_public_listing_detail' and args.get('p_listing_id')=='7' for name,args in s.calls)
     assert await page.evaluate('document.documentElement.scrollWidth <= innerWidth+1')
     assert not s.errors,s.errors
     await page.screenshot(path=str(OUT/f'public-link-from-{workspace}.png'))
     results.append({'from_workspace':workspace,'passed':True,'checks':['intent survives login without fetch','Creator requires explicit Personal switch','typed hotel target retained','intent consumed','no page error']})
    except Exception as error:
     results.append({'from_workspace':workspace,'passed':False,'error':str(error),'calls':s.calls,'page_errors':s.errors}); await page.screenshot(path=str(OUT/f'public-link-failure-{workspace}.png')); raise
    finally:
     (OUT/'public-link-results.json').write_text(json.dumps(results,indent=2)); await context.close()
  finally: await browser.close()
asyncio.run(main())
