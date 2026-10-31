"""Approved-date control and shared Provider overview, isolated HTTP fixtures."""
import asyncio,copy,json
from datetime import datetime,timedelta,timezone
from pathlib import Path
from playwright.async_api import async_playwright,expect
from experience_commerce import Scenario,A,S,B,BASE,iso
OUT=Path('test-results/approved-dates');OUT.mkdir(parents=True,exist_ok=True)
async def main():
 results=[]
 async with async_playwright() as pw:
  browser=await pw.chromium.launch(args=['--no-sandbox'])
  for theme,width in [('light',390),('dark',390),('light',1280),('dark',1280)]:
   for mode in ('approved-dates','provider-overview'):
    s=Scenario('host-ready' if mode=='provider-overview' else 'customer-paid');ctx=await browser.new_context(viewport={'width':width,'height':1000},service_workers='block');page=await ctx.new_page();errors=[];lost=True;overview_failed=False
    rows=[{'id':S,'activity_id':A,'revision':1,'activity_revision':1,'starts_at':s.q['starts_at'],'ends_at':s.q['ends_at'],'timezone':'Africa/Lagos','capacity':8,'price_minor':250000,'currency':'NGN','status':'draft','booking_open':True,'availability_revision':0,'edit_locked':True}]
    page.on('pageerror',lambda error:errors.append(str(error)))
    await page.add_init_script("document.addEventListener('DOMContentLoaded',()=>{document.documentElement.dataset.whTheme="+json.dumps(theme)+";document.documentElement.classList.toggle('dark',"+json.dumps(theme=='dark')+");});")
    async def route(handler):
     nonlocal lost,overview_failed
     request=handler.request;name=request.url.split('?')[0].split('/')[-1]
     handled=('platform_countries','get_my_experience_sessions','save_my_experience_session','set_my_experience_session_availability','get_my_provider_workspace_capabilities','get_my_worker_activation','get_my_experience_bookings')
     if '127.0.0.1:54321' not in request.url or name not in handled:return await s.route(handler)
     args=request.post_data_json if request.post_data else {};s.calls.append({'name':name,'args':args});status=200
     if name=='platform_countries':data={'currency_code':'NGN'}
     elif name=='get_my_experience_sessions':data=copy.deepcopy(rows)
     elif name=='save_my_experience_session':
      start=datetime.fromisoformat(args['p_starts_at'].replace('Z','+00:00'))
      data={'id':args['p_session_id'],'activity_id':A,'revision':args['p_expected_revision']+1,'activity_revision':1,'starts_at':iso(start),'ends_at':iso(start+timedelta(hours=1)),'timezone':'Africa/Lagos','capacity':args['p_capacity'],'price_minor':args['p_price_minor'],'currency':'NGN','status':'draft','booking_open':True,'availability_revision':0,'edit_locked':False};rows.append(copy.deepcopy(data))
     elif name=='set_my_experience_session_availability':
      data=next(r for r in rows if r['id']==args['p_session_id']);assert args['p_expected_revision']==data['availability_revision']
      data.update(booking_open=args['p_open'],availability_revision=data['availability_revision']+1)
      if lost:lost=False;status=503;data={'message':'Synthetic availability response lost'}
     elif name=='get_my_provider_workspace_capabilities':
      data={'person_id':'host','service_reviewed':False,'has_existing_jobs':False,'can_manage_jobs':False,'can_manage_showcase':False,'can_apply_experiences':True,'can_access_inbox':True,'can_access_earnings':True,'has_activity_bookings':True,'experience_next':[{'booking_id':B,'title':s.q['title'],'starts_at':s.q['starts_at'],'ends_at':s.q['ends_at'],'timezone':s.q['timezone'],'participants':2,'host_finished':bool(s.booking.get('host_finished_at'))}]}
      if not overview_failed:overview_failed=True;status=503;data={'message':'Synthetic overview unavailable'}
     elif name=='get_my_experience_bookings':data=[s.booking]
     else:data={'worker_status':'pending','live':False,'reviewed':False,'profile_complete':False,'identity_passed':True,'evidence_saved':False,'submitted':False,'marketplace_enabled':True,'identity_required':True,'identity_gate_satisfied':True,'identity_captured':True,'identity_current':True,'identity_recurring_required':False,'rejection_reason':None}
     return await handler.fulfill(status=status,content_type='application/json',body=json.dumps(data),headers={'access-control-allow-origin':'*'})
    await page.route('**/*',route);await page.goto(BASE+'/tests/browser/experience-commerce.html?mode='+mode)
    if mode=='approved-dates':
     await expect(page.get_by_role('button',name='Edit session',exact=True)).to_have_count(0)
     await expect(page.get_by_role('button',name='Archive prepared session',exact=True)).to_have_count(0)
     await page.get_by_role('button',name='Stop new bookings',exact=True).click();await expect(page.get_by_role('alert')).to_contain_text('Synthetic availability response lost')
     await page.get_by_role('button',name='Refresh sessions',exact=True).click();await expect(page.get_by_role('button',name='Reopen date',exact=True)).to_be_visible()
     await page.get_by_role('button',name='Reopen date',exact=True).evaluate('(node)=>{node.click();node.click();}')
     await expect(page.get_by_role('button',name='Stop new bookings',exact=True)).to_be_visible()
     changes=[c['args'] for c in s.calls if c['name']=='set_my_experience_session_availability'];assert len(changes)==2 and changes[0]['p_expected_revision']==0 and changes[1]['p_expected_revision']==1
     assert rows[0]['revision']==1 and rows[0]['price_minor']==250000
     await page.get_by_label('Start date and time',exact=True).fill((datetime.now()+timedelta(days=8)).strftime('%Y-%m-%dT12:00'))
     await page.get_by_label('Session capacity',exact=True).fill('4');await page.get_by_label('Price per participant (NGN)',exact=True).fill('3500')
     await page.get_by_role('button',name='Save date and availability',exact=True).click();await expect(page.get_by_text('Date saved. Availability follows your activity publication setting.',exact=True)).to_be_visible()
     saved=next(c['args'] for c in s.calls if c['name']=='save_my_experience_session');assert saved['p_activity_revision']==3 and saved['p_price_minor']==350000 and saved['p_capacity']==4
     assert not any(c['name']=='transition_my_experience_activity' for c in s.calls)
    else:
     await expect(page.get_by_role('alert')).to_contain_text('Synthetic overview unavailable');await page.get_by_role('button',name='Refresh workspace',exact=True).click()
     summary=page.get_by_role('region',name='Next activity bookings',exact=True)
     await expect(summary.get_by_role('heading',name='Activity bookings',exact=True)).to_be_visible()
     await expect(page.get_by_text('Set up your Service Worker profile',exact=True)).to_have_count(0)
     await page.screenshot(path=str(OUT/f'provider-home-{theme}-{width}.png'),full_page=True)
     await summary.get_by_role('button',name=s.q['title'],exact=False).click();await expect(page.get_by_role('heading',name=s.q['title'],exact=True)).to_be_visible()
     await page.get_by_role('button',name='Mark session finished',exact=True).click();await expect(page.get_by_role('button',name='Mark session finished',exact=True)).to_have_count(0)
     await page.get_by_role('button',name='Back',exact=True).click();await expect(page.get_by_text('Waiting for participant completion',exact=True)).to_be_visible()
     await page.get_by_role('button',name='View all activity bookings',exact=True).click();await expect(page.get_by_role('heading',name='Activity bookings',exact=True)).to_be_visible()
     assert not any(c['name'].startswith('activate_my_') for c in s.calls)
    assert not errors,errors;assert not await page.evaluate('document.documentElement.scrollWidth>innerWidth')
    await page.screenshot(path=str(OUT/f'{mode}-{theme}-{width}.png'),full_page=True);results.append({'mode':mode,'theme':theme,'width':width});await ctx.close()
  await browser.close()
 (OUT/'results.json').write_text(json.dumps(results,indent=2));print('Approved date and shared Provider journeys passed:',len(results))
if __name__=='__main__':asyncio.run(main())
