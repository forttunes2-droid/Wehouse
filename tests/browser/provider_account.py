"""Shared Provider Account navigation, with every remote API intercepted."""
import asyncio,json
from pathlib import Path
from playwright.async_api import async_playwright,expect
from experience_commerce import Scenario,A,BASE,DETAILS
OUT=Path('test-results/provider-account');OUT.mkdir(parents=True,exist_ok=True)
async def main():
 results=[]
 async with async_playwright() as pw:
  browser=await pw.chromium.launch(args=['--no-sandbox'])
  for theme,width in [('light',390),('dark',1280)]:
   ctx=await browser.new_context(viewport={'width':width,'height':1000},service_workers='block');page=await ctx.new_page();scenario=Scenario('provider-account');errors=[];calls=[];offer_received=asyncio.Event()
   page.on('pageerror',lambda error:errors.append(str(error)))
   await page.add_init_script("document.addEventListener('DOMContentLoaded',()=>{document.documentElement.dataset.whTheme="+json.dumps(theme)+";document.documentElement.classList.toggle('dark',"+json.dumps(theme=='dark')+");});")
   async def route(handler):
    request=handler.request;name=request.url.split('?')[0].split('/')[-1]
    if '127.0.0.1:54321' not in request.url:return await scenario.route(handler)
    if request.method=='OPTIONS':return await handler.fulfill(status=204,headers={'access-control-allow-origin':'*','access-control-allow-headers':'*'})
    calls.append(name);data=[]
    if name=='get_my_provider_workspace_capabilities':data={'person_id':'host','service_reviewed':False,'has_existing_jobs':False,'can_manage_jobs':False,'can_manage_showcase':False,'can_apply_experiences':True,'can_access_inbox':True,'can_access_earnings':True,'experience_next':[],'has_activity_bookings':False}
    elif name=='get_my_worker_activation':data={'worker_status':'not_started','live':False,'profile_complete':False,'identity_passed':False,'evidence_saved':False,'submitted':False,'rejection_reason':None}
    elif name=='get_current_legal_documents':data={'privacy':None,'terms':None}
    elif name=='get_my_legal_status':data={}
    elif name=='get_my_sponsored_resources':data=[{'resource_type':'experience','resource_id':A,'label':DETAILS['title']}]
    elif name=='get_my_sponsored_offer':data={'available':False,'market':'Nasarawa'};offer_received.set()
    elif name not in ('get_my_workspace_inbox','get_my_canonical_activity_v2','get_my_announcement_inbox','get_my_sponsored_campaigns'):return await scenario.route(handler)
    return await handler.fulfill(status=200,content_type='application/json',body=json.dumps(data),headers={'access-control-allow-origin':'*'})
   await page.route('**/*',route);await page.goto(BASE+'/tests/browser/experience-commerce.html?mode=provider-account')
   await expect(page.get_by_role('heading',name='What would you like to offer?',exact=True)).to_be_visible()
   await page.get_by_label('Account',exact=True).click()
   await expect(page.get_by_role('button',name='Sponsored',exact=False)).to_be_visible()
   await expect(page.get_by_role('button',name='WeHouse Pro · Work tools',exact=False)).to_have_count(0)
   await page.get_by_role('button',name='Sponsored',exact=False).click()
   await expect(page.get_by_role('heading',name='Sponsored',exact=True)).to_be_visible()
   await expect(page.get_by_text('WEHOUSE · SERVICE WORKER',exact=True)).to_be_visible()
   await expect(page.get_by_text(DETAILS['title'],exact=False)).to_be_visible()
   await asyncio.wait_for(offer_received.wait(),5)
   assert 'get_my_sponsored_resources' in calls and 'get_my_sponsored_offer' in calls
   assert not any(name.startswith('activate_my_') or name.startswith('create_worker_pro') for name in calls)
   assert not errors,errors;assert not await page.evaluate('document.documentElement.scrollWidth>innerWidth')
   await page.screenshot(path=str(OUT/f'activity-sponsored-{theme}.png'),full_page=True);results.append({'theme':theme,'width':width,'passed':True});await ctx.close()
  await browser.close()
 (OUT/'results.json').write_text(json.dumps(results));print('Shared Provider Account journeys passed:',len(results))
if __name__=='__main__':asyncio.run(main())
