"""Actual Hotel booking UI; all API and payment destinations are local fixtures."""
import asyncio,copy,json
from datetime import datetime,timedelta,timezone
from pathlib import Path
from playwright.async_api import async_playwright,expect
BASE='http://127.0.0.1:4173';OUT=Path('test-results/hotel-checkout');OUT.mkdir(parents=True,exist_ok=True)
def iso(value):return value.isoformat().replace('+00:00','Z')
async def main():
 results=[]
 async with async_playwright() as pw:
  browser=await pw.chromium.launch(args=['--no-sandbox'])
  for theme,width in [('light',390),('dark',1280)]:
   for mode in ('success','lost-hold','wrong-receipt','lost-release','paid-race','recorded-charge','expired','bad-url','wrong-reference'):
    ctx=await browser.new_context(viewport={'width':width,'height':1000},timezone_id='Asia/Tokyo',service_workers='block');page=await ctx.new_page();calls=[];errors=[];saved=None;lost=True
    today=datetime.now(timezone.utc).date();checkin=str(today+timedelta(days=3));checkout=str(today+timedelta(days=5));deadline=str(today+timedelta(days=2))+'T13:00:00Z'
    def hold(key):return {'booking_id':77,'hotel_id':7,'room_id':12,'rate_plan_id':13,'rate_plan_name':'Room only','user_id':'hold-guest','request_key':key,'check_in':checkin,'check_out':checkout,'guest_count':1,'total_nights':2,'total_price':40000,'guest_name':'Sample Guest','guest_phone':'08000000000','special_requests':None,'status':'pending','payment_status':'unpaid','payment_expires_at':iso(datetime.now(timezone.utc)+timedelta(minutes=30)),'cancellation_snapshot':{'refundable':True,'deadline':deadline,'timezone':'Africa/Lagos','refund_amount_ngn':40000}}
    async def route(handler):
     nonlocal saved,lost
     req=handler.request
     if req.url.startswith('https://checkout.paystack.com/'):
      return await handler.fulfill(status=200,content_type='text/html',body='<h1>Controlled checkout destination</h1>')
     if req.url.startswith(BASE):return await handler.continue_()
     if '127.0.0.1:54321' not in req.url:return await handler.abort()
     headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'}
     if req.method=='OPTIONS':return await handler.fulfill(status=204,headers=headers)
     name=req.url.split('?')[0].split('/')[-1];args=req.post_data_json or {};calls.append({'name':name,'args':args});status=200
     if name=='get_public_hotel_detail':data={'hotel_id':7,'name':'Garden Hotel','state':'Nasarawa','city':'Lafia','timezone':'Africa/Lagos','check_in_time':'14:00','check_out_time':'12:00','hotel_rooms':[{'room_id':12,'hotel_id':7,'room_type':'Standard room','price_per_night':20000,'max_guests':3,'total_rooms':2,'images':['/hero-city.jpg'],'rate_plans':[{'rate_plan_id':13,'hotel_id':7,'room_id':12,'name':'Room only','meal_plan':'room_only','price_per_night':20000,'refundable':True,'cancellation_hours':24,'active':True,'included_features':[]}]}]}
     elif name=='get_my_hotel_booking_hold':data=copy.deepcopy(saved) if saved and saved['request_key']==args['p_request_key'] else None
     elif name=='quote_hotel_room_rate':data={'available':True,'nights':2,'total_price':40000,'rate_plan_name':'Room only','cancellation_deadline':deadline,'cancellation_timezone':'Africa/Lagos','refund_amount_ngn':40000}
     elif name=='create_my_hotel_booking_with_rate':
      saved=saved if saved and saved['request_key']==args['p_request_key'] else hold(args['p_request_key']);data=copy.deepcopy(saved)
      if mode=='lost-hold' and lost:lost=False;status=503;data={'message':'The room hold result is unknown'}
      elif mode=='wrong-receipt' and lost:lost=False;data['user_id']='another-person'
      elif mode=='expired':saved['payment_expires_at']=iso(datetime.now(timezone.utc)-timedelta(seconds=1));data=copy.deepcopy(saved)
      elif mode=='recorded-charge':saved['payment_recorded']=True;data=copy.deepcopy(saved)
     elif name=='release_my_hotel_booking_hold':
      if mode=='paid-race':saved.update(status='confirmed',payment_status='paid');status=400;data={'message':'Payment is already recorded. Open your booking to review its cancellation options'}
      else:
       saved.update(status='cancelled',payment_status='expired');data=True
       if mode=='lost-release' and lost:lost=False;status=503;data={'message':'The release result is unknown'}
     elif name=='create_hotel_booking_payment':data={'success':True,'reference':'WHH_fixture_77','already_paid':False}
     elif name=='payment-init':data={'success':True,'reference':'wrong-reference' if mode=='wrong-reference' else 'WHH_fixture_77','authorization_url':'https://untrusted.example.invalid/pay' if mode=='bad-url' else 'https://checkout.paystack.com/fixture'}
     else:raise AssertionError('Unexpected Hotel API '+name)
     await handler.fulfill(status=status,headers=headers,content_type='application/json',body=json.dumps(data))
    page.on('pageerror',lambda error:errors.append(str(error)));await page.route('**/*',route)
    await page.goto(BASE+'/tests/browser/hotel-checkout.html?theme='+theme)
    await expect(page.get_by_role('button',name='Review booking',exact=False)).to_be_enabled()
    await expect(page.get_by_label('Full name',exact=True)).to_have_value('Sample Guest')
    await page.get_by_role('button',name='Review booking',exact=False).evaluate('(button)=>{button.click();button.click();}')
    creates=lambda:[c for c in calls if c['name']=='create_my_hotel_booking_with_rate']
    if mode in ('lost-hold','wrong-receipt'):
     await expect(page.get_by_role('alert')).to_be_visible();assert len(creates())==1
     await page.get_by_role('button',name='Refresh room hold and availability',exact=True).click()
    if mode in ('expired','recorded-charge'):
     await expect(page.get_by_role('heading',name='Room hold expired' if mode=='expired' else 'Check your booking status',exact=True)).to_be_visible();await expect(page.get_by_role('button',name='Accept terms and continue',exact=True)).to_have_count(0)
     assert not any(c['name']=='create_hotel_booking_payment' for c in calls)
     await page.get_by_role('button',name='Open my bookings',exact=True).click();await expect(page.get_by_role('heading',name='Booking 77 destination',exact=True)).to_be_visible()
    else:
     await expect(page.get_by_role('heading',name='Review your stay',exact=True)).to_be_visible();assert len(creates())==1
     key=creates()[0]['args']['p_request_key'];await page.reload()
     await expect(page.get_by_role('heading',name='Review your stay',exact=True)).to_be_visible();assert len(creates())==1
     assert [c for c in calls if c['name']=='get_my_hotel_booking_hold'][-1]['args']['p_request_key']==key
     if mode in ('lost-release','paid-race'):
      await page.get_by_role('button',name='Edit booking',exact=True).click();await expect(page.get_by_role('alert')).to_be_visible()
      await page.get_by_role('button',name='Refresh room hold',exact=True).click()
      await expect(page.get_by_role('heading',name='Booking already confirmed' if mode=='paid-race' else 'Unpaid room hold released',exact=True)).to_be_visible()
      assert not any(c['name']=='cancel_my_hotel_booking' for c in calls),'Unpaid editing invoked paid cancellation'
      await page.get_by_role('button',name='Open my bookings',exact=True).click();await expect(page.get_by_role('heading',name='Booking 77 destination',exact=True)).to_be_visible()
     else:
      if mode in ('bad-url','wrong-reference'):
       await page.get_by_role('button',name='Accept terms and continue',exact=True).click();await expect(page.get_by_role('alert')).to_be_visible();assert page.url.startswith(BASE)
      else:
       await page.screenshot(path=str(OUT/f'review-{mode}-{theme}.png'),full_page=True)
       await page.get_by_role('button',name='Accept terms and continue',exact=True).evaluate('(button)=>{button.click();button.click();}')
       await expect(page.get_by_role('heading',name='Controlled checkout destination',exact=True)).to_be_visible()
       assert len([c for c in calls if c['name']=='create_hotel_booking_payment'])==1 and len([c for c in calls if c['name']=='payment-init'])==1
    assert not errors,errors;assert not await page.evaluate('document.documentElement.scrollWidth>innerWidth')
    results.append({'mode':mode,'theme':theme,'width':width,'passed':True});await ctx.close()
  await browser.close()
 (OUT/'results.json').write_text(json.dumps(results,indent=2));print('Hotel checkout recovery journeys passed:',len(results))
if __name__=='__main__':asyncio.run(main())
