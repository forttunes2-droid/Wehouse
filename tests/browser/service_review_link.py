import asyncio,json
from pathlib import Path
from playwright.async_api import async_playwright,expect
BASE='http://127.0.0.1:4173';B='bb290000-0000-4000-8000-000000000002'
async def main():
 rows=[]
 async with async_playwright() as p:
  browser=await p.chromium.launch(args=['--no-sandbox'])
  for theme,width in [('light',390),('dark',1280)]:
   context=await browser.new_context(viewport={'width':width,'height':900},service_workers='block');page=await context.new_page();page.set_default_timeout(20000);errors=[];page.on('pageerror',lambda e:errors.append(str(e)));calls=[];state={'fail':True}
   async def route(handler):
    req=handler.request
    if req.url.startswith(BASE):return await handler.continue_()
    if not req.url.startswith('http://127.0.0.1:54321/'):return await handler.abort()
    headers={'access-control-allow-origin':'*','access-control-allow-headers':'*'}
    if req.method=='OPTIONS':return await handler.fulfill(status=204,headers=headers)
    name=req.url.split('/')[-1].split('?')[0];args=req.post_data_json if req.post_data else {};calls.append({'name':name,'args':args});data=[];status=200
    if name=='get_my_worker_booking_details':
     if state['fail']:status=503;data={'message':'Synthetic unavailable booking'}
     else:data={'id':B,'status':'approved_released','service_type':'Historical completed service','worker_id':'provider','worker_name':'Example Provider','agreed_amount':1000,'currency':'NGN','money_state':'released','canonical_job_state':'completed','payment_status':'paid','job_support_open':False}
    elif name=='get_my_worker_booking_review':data={'id':'bb290000-0000-4000-8000-000000000001','hidden_at':'2026-10-28T08:00:00Z','moderation_reason':'A privacy review is required.'}
    elif name=='get_my_experience_bookings':data={'items':[],'has_more':False}
    return await handler.fulfill(status=status,content_type='application/json',body=json.dumps(data),headers=headers)
   await context.add_init_script(f"document.addEventListener('DOMContentLoaded',()=>document.documentElement.setAttribute('data-wh-theme','{theme}'))")
   await page.route('**/*',route);await page.goto(BASE+'/tests/browser/experience.html?fixture=service-review-link')
   await expect(page.get_by_role('alert')).to_contain_text('could not be loaded');await expect(page.get_by_role('button',name='Open conversation',exact=True)).to_have_count(0)
   state['fail']=False;await page.get_by_role('button',name='Retry Service booking',exact=True).click()
   await expect(page.get_by_role('heading',name='Historical completed service',exact=True)).to_be_visible();await expect(page.get_by_role('heading',name='Your review is hidden',exact=True)).to_be_visible();await expect(page.get_by_text('A privacy review is required.',exact=True)).to_be_visible();await expect(page.get_by_role('button',name='Open conversation',exact=True)).to_have_count(0)
   assert all(c['args']['p_booking_id']==B for c in calls if c['name']=='get_my_worker_booking_details');assert not errors,errors;assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
   out=Path('test-results/provider-reviews');out.mkdir(parents=True,exist_ok=True);await page.screenshot(path=str(out/f'service-review-link-{theme}.png'),full_page=True);rows.append({'theme':theme,'passed':True});print(json.dumps(rows[-1]),flush=True);await context.close()
  await browser.close()
asyncio.run(main())
