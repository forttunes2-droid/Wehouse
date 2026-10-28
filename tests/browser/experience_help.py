"""Actual Help -> existing composer, with synthetic API responses only."""
import asyncio,json,re
from pathlib import Path
from playwright.async_api import async_playwright,expect
BASE='http://127.0.0.1:4173'
OUT=Path('test-results/experience-help');OUT.mkdir(parents=True,exist_ok=True)
B='91000000-0000-4000-8000-000000000003'
async def main():
 results=[]
 async with async_playwright() as pw:
  browser=await pw.chromium.launch(headless=True,args=['--no-sandbox'])
  for theme in ('light','dark'):
   for topic,reason in [('Services and activities','experience_booking_help'),('Payments and refunds','payment_issue'),('Report a safety concern','safety_threat')]:
    ctx=await browser.new_context(viewport={'width':390,'height':844},service_workers='block');p=await ctx.new_page();errors=[];calls=[]
    p.on('pageerror',lambda e:errors.append(str(e)))
    await p.add_init_script("document.addEventListener('DOMContentLoaded',()=>{document.documentElement.dataset.whTheme="+json.dumps(theme)+";document.documentElement.classList.toggle('dark',"+json.dumps(theme=='dark')+");});")
    async def route(r):
     if r.request.url.startswith(BASE):return await r.continue_()
     if not r.request.url.startswith('http://127.0.0.1:54321/'):return await r.abort()
     name=r.request.url.split('/')[-1].split('?')[0];args=r.request.post_data_json if r.request.post_data else {};calls.append((name,args));data=[]
     if name=='get_my_workspace_help_targets':
      activity={'subject_type':'experience_booking','context_type':'experience_booking','subject_id':B,'label':'Campus cooking class','status':'confirmed'}
      data={'account':{'subject_type':'account','subject_id':'qa-self','label':'My account'},'experience_bookings':[activity],'payment_targets':[activity]}
     await r.fulfill(status=200,content_type='application/json',body=json.dumps(data),headers={'access-control-allow-origin':'*'})
    await p.route('**/*',route)
    try:
     await p.goto(BASE+'/tests/browser/profile-help.html?mode=help')
     await p.get_by_role('button',name=re.compile(topic)).click()
     await p.get_by_role('button',name=re.compile('Campus cooking class')).click()
     await expect(p.locator('[data-chat-composer]')).to_be_visible()
     detail=await p.evaluate('window.__lastSupportContext')
     assert detail['contextId']==B and detail['contextSnapshot']['reason_code']==reason
     assert detail['contextSnapshot']['subject_type']=='experience_booking'
     assert detail['contextSnapshot']['requester_workspace']=='personal'
     assert not [name for name,_ in calls if name.startswith(('create_','send_'))],'Opening Help must not send'
     assert await p.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--wh-bg').trim()") == ('#F7F8FB' if theme=='light' else '#090B10')
     assert not await p.evaluate('document.documentElement.scrollWidth>innerWidth')
     assert not errors,errors
     await p.screenshot(path=str(OUT/f'{reason}-{theme}.png'),full_page=True)
     results.append({'theme':theme,'reason':reason,'passed':True})
    finally:await ctx.close()
  await browser.close()
 (OUT/'results.json').write_text(json.dumps(results,indent=2));print('Experience account Help browser checks passed:',len(results))
if __name__=='__main__':asyncio.run(main())
