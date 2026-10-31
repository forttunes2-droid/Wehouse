"""Actual Hotel booking UI; all API and payment destinations are local fixtures."""
import asyncio,copy,json,re
from datetime import datetime,timedelta,timezone
from pathlib import Path
from playwright.async_api import async_playwright,expect
BASE='http://127.0.0.1:4173';OUT=Path('test-results/hotel-checkout');OUT.mkdir(parents=True,exist_ok=True)
def iso(value):return value.isoformat().replace('+00:00','Z')
def make_shared(saved,checkin,checkout):
 gid='79700000-0000-4000-8000-000000000001';saved['shared_payment_group_id']=gid
 return {'id':gid,'canonical_group_id':gid,'created_by':'hold-guest','listing_id':None,'hotel_id':7,'hotel_booking_id':77,'status':'inviting','product_type':'hotel','payment_phase':'short_stay','expires_at':saved['payment_expires_at'],'checkout_attempt':1,'total_amount':40000,'guest_count':2,'stay_check_in':checkin,'stay_check_out':checkout,'booking_status':'pending','cancellation_snapshot':saved['cancellation_snapshot'],'hotel_arrival':None,'listing':{'id':'7','title':'Garden Hotel · Standard room'},'members':[{'user_id':'hold-guest','name':'Sample Guest','invitation_status':'accepted','share_amount':20000,'payment_status':'not_started'},{'user_id':'joining-friend','name':'Joining Friend','invitation_status':'invited','share_amount':20000,'payment_status':'not_started'}]}

async def main():
 results=[]
 async with async_playwright() as pw:
  browser=await pw.chromium.launch(args=['--no-sandbox'])
  for theme,width in [('light',390),('dark',1280)]:
   for mode in ('success','lost-hold','wrong-receipt','lost-release','paid-race','recorded-charge','expired','bad-url','wrong-reference','shared','shared-arrival','shared-arrival-recovery','same-day-open','same-day-closes','same-day-hold-expiry','same-day-shared-expiry','same-day-disabled'):
    ctx=await browser.new_context(viewport={'width':width,'height':1000},timezone_id='Asia/Tokyo',service_workers='block');page=await ctx.new_page();calls=[];errors=[];saved=None;shared=None;protection=None;lost=True
    same_day=mode.startswith('same-day-');is_shared=mode in ('shared','same-day-shared-expiry')
    now=datetime(2030,3,8,19,58,tzinfo=timezone.utc) if same_day else datetime.now(timezone.utc)
    if same_day:await page.clock.install(time=now)
    today=now.date();checkin=str(today+timedelta(days=0 if same_day else 3));checkout=str(today+timedelta(days=2 if same_day else 5));deadline=str(today-timedelta(days=1) if same_day else today+timedelta(days=2))+'T13:00:00Z'
    cutoff=str(today)+'T20:00:00Z'
    def hold(key):return {'booking_id':77,'hotel_id':7,'room_id':12,'rate_plan_id':13,'rate_plan_name':'Room only','user_id':'hold-guest','request_key':key,'check_in':checkin,'check_out':checkout,'guest_count':1,'total_nights':2,'total_price':40000,'guest_name':'Sample Guest','guest_phone':'08000000000','special_requests':None,'status':'pending','payment_status':'unpaid','payment_expires_at':cutoff if same_day else iso(now+timedelta(minutes=30)),'cancellation_snapshot':{'refundable':True,'deadline':deadline,'timezone':'Africa/Lagos','refund_amount_ngn':40000}}
    if mode.startswith('shared-arrival'):
     saved=hold('arrival-fixture');saved['guest_count']=2;shared=make_shared(saved,checkin,checkout)
     shared.update(status='paid',booking_status='checked_in',hotel_arrival={'booking_id':77,'booking_code':'ROOM-77','address':'Reception, fixture address','check_in_time':'14:00','check_out_time':'12:00','timezone':'Africa/Lagos'})
     for member in shared['members']:member.update(invitation_status='accepted',payment_status='paid',payment_reference='own-fixture-'+member['user_id'])
     protection={'subject_type':'hotel','subject_id':'77','protection_state':'protected','amount_total':20000,'checked_in_at':iso(datetime.now(timezone.utc)),
      'arrival_issue_deadline_at':iso(datetime.now(timezone.utc)+timedelta(hours=2)),'can_report_arrival_issue':True,'arrival_issue_case_id':None}
    async def route(handler):
     nonlocal saved,shared,protection,lost
     req=handler.request
     if req.url.startswith('https://checkout.paystack.com/'):
      return await handler.fulfill(status=200,content_type='text/html',body='<h1>Controlled checkout destination</h1>')
     if req.url.startswith(BASE):return await handler.continue_()
     if '127.0.0.1:54321' not in req.url:return await handler.abort()
     headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'}
     if req.method=='OPTIONS':return await handler.fulfill(status=204,headers=headers)
     name=req.url.split('?')[0].split('/')[-1];args=req.post_data_json or {};calls.append({'name':name,'args':args});status=200
     if name=='get_public_hotel_detail':data={'hotel_id':7,'name':'Garden Hotel','state':'Nasarawa','city':'Lafia','timezone':'Africa/Lagos','same_day_booking_cutoff':'21:00:00' if same_day and mode!='same-day-disabled' else None,'check_in_time':'14:00','check_out_time':'12:00','hotel_rooms':[{'room_id':12,'hotel_id':7,'room_type':'Standard room','price_per_night':20000,'max_guests':3,'total_rooms':2,'images':['/hero-city.jpg'],'rate_plans':[{'rate_plan_id':13,'hotel_id':7,'room_id':12,'name':'Room only','meal_plan':'room_only','price_per_night':20000,'refundable':True,'cancellation_hours':24,'active':True,'included_features':[]}]}]}
     elif name=='get_my_hotel_booking_hold':data=copy.deepcopy(saved) if saved and saved['request_key']==args['p_request_key'] else None
     elif name=='quote_hotel_room_rate':data={'available':True,'nights':2,'total_price':40000,'rate_plan_name':'Room only','same_day_booking_cutoff_at':cutoff if same_day else None,'cancellation_deadline':deadline,'cancellation_timezone':'Africa/Lagos','refund_amount_ngn':40000}
     elif name=='create_my_hotel_booking_with_rate':
      saved=saved if saved and saved['request_key']==args['p_request_key'] else hold(args['p_request_key']);saved['guest_count']=args['p_guest_count'];data=copy.deepcopy(saved)
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
     elif name=='list_my_friends':data=[{'friend_id':'79700000-0000-4000-8000-000000000009','user_id':'joining-friend','full_name':'Joining Friend','username':'joiningfriend','status':'accepted','requested_by_me':False}]
     elif name=='create_my_shared_hotel':
      assert args=={'p_booking_id':77,'p_user_ids':['joining-friend']}
      gid='79700000-0000-4000-8000-000000000001';saved['shared_payment_group_id']=gid
      shared=make_shared(saved,checkin,checkout);data=copy.deepcopy(shared)
     elif name=='get_my_stay_arrival_instructions':data='Present your booking at reception.'
     elif name=='get_my_accommodation_protection':
      assert args=={'p_subject_type':'hotel','p_subject_id':'77'};data=copy.deepcopy(protection)
     elif name=='report_my_accommodation_arrival_issue':
      assert args['p_subject_type']=='hotel' and args['p_subject_id']=='77' and len(args['p_reason'])>=10
      protection.update(protection_state='disputed',can_report_arrival_issue=False,arrival_issue_case_id='79700000-0000-4000-8000-000000000007')
      data=protection['arrival_issue_case_id']
      if mode=='shared-arrival-recovery' and lost:lost=False;status=503;data={'message':'Response lost after saved report'}
     elif name=='get_my_shared_housing_group':data=copy.deepcopy(shared)
     elif name=='create_my_shared_housing_payment':
      assert shared['status']=='payment_pending' and all(m['invitation_status']=='accepted' for m in shared['members'])
      data={'success':True,'reference':'WHH_shared_fixture_77','amount':20000}
     elif name=='payment-init':data={'success':True,'purpose':'shared_housing_share' if is_shared else 'hotel_booking','reference':'WHH_shared_fixture_77' if is_shared else 'wrong-reference' if mode=='wrong-reference' else 'WHH_fixture_77','authorization_url':'https://untrusted.example.invalid/pay' if mode=='bad-url' else 'https://checkout.paystack.com/fixture'}
     else:raise AssertionError('Unexpected Hotel API '+name)
     await handler.fulfill(status=status,headers=headers,content_type='application/json',body=json.dumps(data))
    page.on('pageerror',lambda error:errors.append(str(error)));await page.route('**/*',route)
    if mode.startswith('shared-arrival'):
     await page.goto(BASE+'/tests/browser/hotel-checkout.html?view=shared-guest&theme='+theme)
     await expect(page.get_by_role('dialog',name='Shared Hotel booking',exact=True)).to_be_visible()
     await expect(page.get_by_role('button',name='Report arrival issue',exact=True)).to_be_enabled()
     assert not any(c['name']=='create_my_hotel_booking_with_rate' for c in calls)
     await page.get_by_role('button',name='Report arrival issue',exact=True).click()
     await page.get_by_label('What is wrong?',exact=True).fill('The room is unsafe and does not match the accepted listing.')
     await page.get_by_role('button',name='Freeze payment & report',exact=True).evaluate('(button)=>{button.click();button.click();}')
     if mode=='shared-arrival-recovery':
      await expect(page.get_by_role('alert')).to_contain_text('Your description is retained')
      await page.get_by_role('button',name='Refresh Payment Protection',exact=True).click()
     await expect(page.get_by_text('Arrival issue open. The accommodation payment is frozen for WeHouse review.',exact=True)).to_be_visible()
     await expect(page.get_by_role('button',name='Report arrival issue',exact=True)).to_have_count(0)
     assert len([c for c in calls if c['name']=='report_my_accommodation_arrival_issue'])==1
     await page.screenshot(path=str(OUT/f'{mode}-{theme}.png'),full_page=True)
     assert not errors,errors;assert not await page.evaluate('document.documentElement.scrollWidth>innerWidth')
     results.append({'mode':mode,'theme':theme,'width':width,'passed':True});await ctx.close();continue
    await page.goto(BASE+'/tests/browser/hotel-checkout.html?theme='+theme+('&sameDay=true' if same_day else ''))
    if same_day:
     await expect(page.get_by_label('Full name',exact=True)).to_have_value('Sample Guest')
     await page.get_by_role('button',name='Check-in',exact=True).click()
     day=page.get_by_role('dialog',name='Choose Check-in').get_by_role('button',name=re.compile(rf'{today.strftime("%B")} {today.day}(?:st|nd|rd|th)?, {today.year}'))
     if mode=='same-day-disabled':
      await expect(day).to_be_disabled();await page.get_by_role('button',name='Close calendar',exact=True).click()
      await expect(page.get_by_role('button',name='Choose available dates',exact=True)).to_be_disabled()
      assert not any(c['name'] in ('quote_hotel_room_rate','create_my_hotel_booking_with_rate') for c in calls)
      results.append({'mode':mode,'theme':theme,'width':width,'passed':True});await ctx.close();continue
     await expect(day).to_be_enabled();await page.get_by_role('button',name='Close calendar',exact=True).click()
    await expect(page.get_by_role('button',name='Review booking',exact=False)).to_be_enabled()
    await expect(page.get_by_label('Full name',exact=True)).to_have_value('Sample Guest')
    if same_day:
     shown_deadline=page.get_by_text(re.compile("^Today's payment deadline:"))
     await expect(shown_deadline).to_contain_text('8 Mar 2030')
     await expect(shown_deadline).to_contain_text(re.compile(r'9:00\s*pm',re.I))
     await expect(page.get_by_role('region',name='Cancellation and arrival terms')).to_contain_text('free-cancellation deadline has passed')
     await page.screenshot(path=str(OUT/f'{mode}-dates-{theme}.png'),full_page=True)
    if mode=='same-day-closes':
     reads=len([c for c in calls if c['name']=='quote_hotel_room_rate']);await page.clock.fast_forward(121000)
     await expect(page.get_by_role('button',name='Choose available dates',exact=True)).to_be_disabled()
     await page.get_by_role('button',name='Check-in',exact=True).click();await expect(day).to_be_disabled()
     await page.get_by_role('button',name='Close calendar',exact=True).click()
     assert not any(c['name']=='create_my_hotel_booking_with_rate' for c in calls)
     assert len([c for c in calls if c['name']=='quote_hotel_room_rate'])==reads,'Closing the cutoff must not poll the database'
     results.append({'mode':mode,'theme':theme,'width':width,'passed':True});await ctx.close();continue
    if is_shared:await page.get_by_role('button',name='Add guest',exact=True).click()
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
     if mode=='same-day-hold-expiry':
      await expect(page.get_by_text(re.compile('free-cancellation deadline has passed'))).to_be_visible()
      reads=len(calls);await page.clock.fast_forward(121000)
      await expect(page.get_by_role('heading',name='Room hold expired',exact=True)).to_be_visible()
      await expect(page.get_by_role('button',name='Accept terms and continue',exact=True)).to_have_count(0)
      assert len(calls)==reads,'Saved hold expiry must not poll the database'
      await page.screenshot(path=str(OUT/f'{mode}-{theme}.png'),full_page=True)
     elif is_shared:
      await page.get_by_role('button',name='Share this stay',exact=False).click()
      await page.get_by_role('checkbox',name='Invite Joining Friend',exact=True).check()
      await expect(page.get_by_text('₦20,000',exact=True)).to_have_count(2)
      await page.get_by_role('button',name='Invite people',exact=True).click()
      await expect(page.get_by_role('dialog',name='Shared Hotel booking',exact=True)).to_be_visible()
      await expect(page.get_by_role('button',name='Complete my payment',exact=False)).to_have_count(0)
      await page.screenshot(path=str(OUT/f'shared-inviting-{theme}.png'),full_page=True)
      shared['members'][1]['invitation_status']='accepted';shared['status']='payment_pending'
      await page.get_by_role('button',name='Refresh',exact=True).click()
      await expect(page.get_by_role('button',name='Complete my payment',exact=False)).to_be_enabled()
      if mode=='same-day-shared-expiry':
       reads=len(calls);await page.clock.fast_forward(121000)
       await expect(page.get_by_role('button',name='Complete my payment',exact=False)).to_have_count(0)
       await expect(page.get_by_text('The room hold has expired. Refresh to check any recorded payment or refund.',exact=True)).to_be_visible()
       # The containing shared-booking screen already has a visible 15s
       # refresh. Fast-forward coalesces that timer; the new deadline clock
       # must add no reads or payment writes of its own.
       later=calls[reads:];assert len(later)<=1 and all(c['name']=='get_my_shared_housing_group' for c in later),'Shared expiry added a request beyond the existing visible refresh'
       await page.screenshot(path=str(OUT/f'{mode}-{theme}.png'),full_page=True)
      else:
       await page.get_by_role('button',name='Complete my payment',exact=False).click()
       await expect(page.get_by_role('heading',name='Controlled checkout destination',exact=True)).to_be_visible()
       assert not any(c['name']=='create_hotel_booking_payment' for c in calls)
       assert len([c for c in calls if c['name']=='create_my_shared_housing_payment'])==1
     elif mode in ('lost-release','paid-race'):
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
