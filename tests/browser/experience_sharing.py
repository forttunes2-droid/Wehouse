"""Actual Services/detail/share dialog and sent/received cards; isolated API only."""
import asyncio,json
from pathlib import Path
from playwright.async_api import async_playwright,expect
from experience_commerce import Scenario,A,BASE
OUT=Path('test-results/experience-sharing');OUT.mkdir(parents=True,exist_ok=True)
FRIEND='91000000-0000-4000-8000-000000000006'
PEER='91000000-0000-4000-8000-000000000007'
async def main():
 results=[]
 async with async_playwright() as pw:
  browser=await pw.chromium.launch(args=['--no-sandbox'])
  for theme,width in [('light',390),('dark',1280)]:
   ctx=await browser.new_context(viewport={'width':width,'height':1000},service_workers='block')
   page=await ctx.new_page();s=Scenario('discovery');errors=[];unavailable=False
   page.on('pageerror',lambda error:errors.append(str(error)))
   await page.add_init_script("document.addEventListener('DOMContentLoaded',()=>{document.documentElement.dataset.whTheme="+json.dumps(theme)+";document.documentElement.classList.toggle('dark',"+json.dumps(theme=='dark')+");});")
   await page.add_init_script("Object.defineProperty(navigator,'share',{configurable:true,value:async data=>{window.__sharedActivity=data;}})")
   async def route(handler):
    request=handler.request;name=request.url.split('?')[0].split('/')[-1]
    if '127.0.0.1:54321' in request.url and name in ('list_my_friends','get_my_roommate_peer_details') and request.method=='POST':
     data=[{'friend_id':FRIEND,'user_id':'friend','full_name':'Accepted Friend','username':'friend','status':'accepted','requested_by_me':False},{'friend_id':PEER,'user_id':'pending','full_name':'Pending invitation','username':'pending','status':'pending','requested_by_me':True}] if name=='list_my_friends' else [{'conversation_id':PEER,'user_id':'roommate','full_name':'Accepted Roommate','username':'roommate','is_blocked':False},{'conversation_id':FRIEND,'user_id':'blocked','full_name':'Blocked Roommate','username':'blocked','is_blocked':True}]
     return await handler.fulfill(content_type='application/json',body=json.dumps(data),headers={'access-control-allow-origin':'*'})
    if unavailable and name=='get_published_experience':
     return await handler.fulfill(content_type='application/json',body='null',headers={'access-control-allow-origin':'*'})
    await s.route(handler)
   await page.route('**/*',route)
   await page.goto(BASE+'/tests/browser/experience-sharing.html#worker_discovery?experienceId='+A)
   await expect(page.get_by_role('heading',name='Choose a date',exact=True)).to_be_visible()
   await expect(page.get_by_role('button',name='Book an activity',exact=True).first).to_have_attribute('aria-pressed','true')
   await page.get_by_role('button',name='Share activity link',exact=True).click()
   await page.wait_for_function('window.__sharedActivity?.url')
   assert (await page.evaluate('window.__sharedActivity')).get('url')=='https://wehouse.com.ng/#worker_discovery?experienceId='+A
   await page.get_by_role('button',name='Send in chat',exact=True).click()
   dialog=page.get_by_role('dialog',name='Share activity',exact=True)
   await expect(dialog.get_by_text('Sharing does not book a place',exact=False)).to_be_visible()
   await expect(dialog.get_by_role('button',name='Blocked Roommate',exact=False)).to_have_count(0)
   await dialog.get_by_role('button',name='Accepted Roommate',exact=False).click()
   await expect(dialog).to_have_count(0)
   await expect(page.get_by_label('Prepared activity reference',exact=True)).to_have_text('https://wehouse.com.ng/#worker_discovery?experienceId='+A)
   assert json.loads(await page.get_by_label('Shared destination',exact=True).inner_text())=={'page':'conversation','id':PEER}
   await page.get_by_role('button',name='Send in chat',exact=True).click()
   await dialog.get_by_role('button',name='Friends',exact=True).click()
   await expect(dialog.get_by_role('button',name='Pending invitation',exact=False)).to_have_count(0)
   await dialog.get_by_role('button',name='Accepted Friend',exact=False).click()
   await expect(dialog).to_have_count(0)
   assert json.loads(await page.get_by_label('Shared destination',exact=True).inner_text())=={'page':'activity','id':FRIEND}
   assert not any(c['name'].startswith(('send_','hold_','create_experience_checkout')) for c in s.calls),'Selecting a recipient sent a message or booked an activity'
   for side in ('Sent activity','Received activity'):
    await page.get_by_role('region',name=side,exact=True).get_by_role('button',name='Open shared activity',exact=True).click()
    assert json.loads(await page.get_by_label('Shared destination',exact=True).inner_text())=={'page':'experience','id':A}
   # The same shared destination still uses the normal current quote/hold path.
   await page.get_by_role('button',name='per participant',exact=False).click()
   await page.get_by_label('Participants',exact=True).fill('2')
   await page.get_by_role('button',name='Book an activity',exact=True).last.click()
   await expect(page.get_by_role('heading',name='Review your booking',exact=True)).to_be_visible()
   await page.get_by_role('button',name='Agree and continue to payment',exact=True).click()
   await expect(page.get_by_label('Shared destination',exact=True)).to_contain_text('"page":"my_reservations"')
   assert json.loads(await page.get_by_label('Shared destination',exact=True).inner_text())['page']=='my_reservations'
   await page.get_by_role('button',name='Back',exact=True).click()
   await expect(page.get_by_role('heading',name='Experiences',exact=True)).to_be_visible()
   await page.get_by_role('region',name='Received activity',exact=True).get_by_role('button',name='Open shared activity',exact=True).click()
   await expect(page.get_by_role('heading',name='Choose a date',exact=True)).to_be_visible()
   unavailable=True
   await page.get_by_role('button',name='Refresh activity',exact=True).click()
   await expect(page.get_by_text('Activity unavailable',exact=True)).to_be_visible()
   await expect(page.get_by_role('button',name='Send in chat',exact=True)).to_have_count(0)
   assert not await page.evaluate('document.documentElement.scrollWidth>innerWidth')
   assert not errors,errors
   await page.screenshot(path=str(OUT/f'activity-sharing-{theme}.png'),full_page=True)
   results.append({'theme':theme,'checks':['Services deep link','accepted recipients only','draft without send/booking','sent and received navigation','normal quote and hold','withdrawn publication','no horizontal overflow']})
   await ctx.close()
  await browser.close()
 (OUT/'results.json').write_text(json.dumps(results,indent=2));print(json.dumps(results))
if __name__=='__main__':asyncio.run(main())
