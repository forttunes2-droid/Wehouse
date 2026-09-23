"""Real property workspace components, synthetic scoped APIs; no live records.
SQL authorization is exercised separately by property_workspace_routing_contract.sql.
"""
import asyncio, json, os, re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from playwright.async_api import async_playwright, expect
BASE = 'http://127.0.0.1:4173'
OUT = Path('test-results/experience')
CAPS = ['stay.read','stay.message','stay.assign_unit','stay.check_in','stay.check_out','room.mark_ready','hotel.inventory.manage','hotel.rate.manage','hotel.policy.manage','hotel.team.manage']
HOTEL = {'hotel_id': 7,'name':'Test Lodge','status':'active','city':'Lafia','state':'Nasarawa','address':'Test road','images':[], 'amenities':[], 'room_type_count':2,'total_room_count':3,'starting_rate':30000,'access_role':'owner','capabilities':CAPS,'timezone':'Africa/Lagos'}
ROOMS = [{'room_id':8,'hotel_id':7,'room_type':'VIP','total_rooms':2,'price_per_night':30000,'max_guests':2,'amenities':['WiFi'],'images':[], 'rate_plans':[]}, {'room_id':9,'hotel_id':7,'room_type':'Deluxe','total_rooms':1,'price_per_night':20000,'max_guests':2,'amenities':[], 'images':[], 'rate_plans':[]}]
UNITS = [{'unit_id': 101 + index, 'hotel_id': 7, 'room_id': room_id, 'unit_label': f'Room {101 + index}', 'floor_label': None, 'status': 'ready', 'current_booking_id': None} for index, room_id in enumerate([8, 8, 9])]
DATE = datetime.now(timezone.utc)
BOOKINGS = [{'booking_id':42,'hotel_id':7,'room_id':8,'guest_name':'Guest Forty Two','guest_count':2,'status':'confirmed','payment_status':'paid','total_price':60000,'rate_plan_name':'Room only','check_in':(DATE+timedelta(days=2)).date().isoformat(),'check_out':(DATE+timedelta(days=4)).date().isoformat(),'hotel_rooms':{'room_type':'VIP'}}, {'booking_id':43,'hotel_id':7,'room_id':9,'guest_name':'Cancelled Guest','guest_count':1,'status':'cancelled','payment_status':'unpaid','total_price':20000,'rate_plan_name':'Room only','check_in':DATE.date().isoformat(),'check_out':(DATE+timedelta(days=1)).date().isoformat(),'hotel_rooms':{'room_type':'Deluxe'}}]
REQUEST = {'id':'inspection-seven','owner_id':'qa-owner','property_display_name':'Test Lodge','request_code':'WHIR-TEST-ONLY','property_type':'hotel','property_address':'Test road','property_state':'Nasarawa','property_city':'Lafia','status':'approved','lifecycle_stage':'live','draft_hotel_id':7,'published_at':DATE.isoformat(),'created_at':DATE.isoformat(),'photo_urls':[],'hotel_program':{'name':'Test Lodge'},'hotel':HOTEL}
EVENT = {'id':'event-stay-42','type':'hotel.confirmed','title':'New paid hotel stay','message':'Guest Forty Two booked Test Lodge.','source_type':'hotel_booking','source_id':'42','destination_route':'hotel_booking','destination_params':{'hotel_id':7,'booking_id':42,'conversation_id':'separate-chat-99'},'read':False,'created_at':DATE.isoformat(),'action_required':False}
SUPPORT = {'conversation_id':'inspection-chat','context_type':'property_inspection','context_id':'inspection-seven','subject':'Property inspection WHIR-TEST-ONLY','category':'property_operations','operator':'property_operations','status':'open','created_at':DATE.isoformat(),'last_message':'Inspection update','context_snapshot':{'requester_workspace':'property_partner','property_display_name':'Test Lodge','property_address':'Test road'},'unread_count':0}

async def main():
 OUT.mkdir(parents=True,exist_ok=True)
 results=[]
 async with async_playwright() as p:
  kwargs={'args':['--no-sandbox']}
  if os.environ.get('PLAYWRIGHT_CHROMIUM_EXECUTABLE'): kwargs['executable_path']=os.environ['PLAYWRIGHT_CHROMIUM_EXECUTABLE']
  browser=await p.chromium.launch(**kwargs)
  try:
   for width,height in [(390,844),(768,1024),(1440,900)]:
    context=await browser.new_context(viewport={'width':width,'height':height}, service_workers='block')
    page=await context.new_page(); errors=[]; calls=[]; mode='partner'; denied=False; unit_mode='ready'
    page.on('pageerror',lambda error:errors.append(str(error)))
    async def route(handler):
     nonlocal mode
     req=handler.request
     if req.url.startswith(BASE): return await handler.continue_()
     if not req.url.startswith('http://127.0.0.1:54321/'): return await handler.abort()
     if req.method=='OPTIONS': return await handler.fulfill(status=204,headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'})
     name=req.url.split('/')[-1].split('?')[0]; args=req.post_data_json if req.post_data else {}; calls.append((name,args)); data=[]
     caps=['stay.read'] if mode=='team' else CAPS
     hotel={**HOTEL,'access_role':'front_desk' if mode=='team' else 'owner','capabilities':caps}
     if name=='get_my_legal_status': data={}
     elif name=='get_my_hotel_operations': data=[hotel]
     elif name in ['get_my_hotel_operation_snapshot','get_my_hotel_operation_snapshot_v2']:
      if denied: return await handler.fulfill(status=403,content_type='application/json',body=json.dumps({'message':'Access denied','code':'42501'}),headers={'access-control-allow-origin':'*'})
      data={'hotel':hotel,'capabilities':caps,'rooms':ROOMS,'bookings':BOOKINGS,'inventory':[],'room_units':([] if unit_mode=='missing' else [{**unit,'status':'maintenance' if unit_mode=='maintenance' and index==0 else 'ready'} for index,unit in enumerate(UNITS)]),'venues':[]}
     elif name=='get_my_hotel_booking_target': data={'booking_id':42,'hotel_id':7}
     elif name=='inspection_requests': data=[REQUEST]
     elif name=='get_my_workspace_inbox': data=[SUPPORT] if args.get('p_kind')=='wehouse' and mode=='partner' else []
     elif name=='get_my_canonical_activity_v2': data=[EVENT]
     elif name=='get_my_canonical_activity_summary': data={'unread':1,'needs_action':0}
     elif name=='get_internal_profile_record': data={'account':{},'workspaces':[{'role':'property_partner','status':'active'}],'hotels_owned':[HOTEL], 'apartments':[], 'hotel_team':[], 'wehouse_team':[]}
     elif name=='get_my_property_pipeline_v2': data=[REQUEST]
     elif name=='get_my_property_hotel_record': data={**HOTEL,'hotel_rooms':ROOMS}
     await handler.fulfill(status=200,content_type='application/json',body=json.dumps(data),headers={'access-control-allow-origin':'*'})
    await page.route('**/*',route)
    async def fits():
     assert await page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), await page.evaluate('[document.documentElement.scrollWidth, innerWidth]')
    async def nav(label):
     # Counts are part of the accessible name before the label on mobile and after it on desktop.
     name=re.compile(r'^(?:\d+\+?\s*)?'+re.escape(label)+r'(?:\s*\d+\+?)?$')
     await page.get_by_role('button',name=name).filter(visible=True).click()
    async def select(label,option):
     await page.get_by_role('button',name=label,exact=True).click()
     await page.get_by_role('dialog').get_by_role('button',name=option,exact=True).click()
    try:
     await page.goto(BASE+'/tests/browser/property-routing.html')
     await expect(page.get_by_role('button',name='Account',exact=True).filter(visible=True)).to_be_visible()
     await expect(page.locator('header img')).to_have_count(0)
     await expect(page.get_by_role('button',name='Workspaces',exact=True)).to_have_count(0)
     await nav('Account'); await expect(page.get_by_role('heading',name='Account',exact=True)).to_be_visible()
     assert await page.evaluate('window.__navigation')=='profile'
     await page.get_by_role('button',name=re.compile('^WeHouse')).click()
     await page.get_by_role('button',name=re.compile('^Personal')).click()
     assert await page.evaluate('window.__workspaceSwitch')=='personal'
     await page.goto(BASE+'/tests/browser/property-routing.html')
     await select('Filter by property type','Hotels')
     await page.get_by_role('button',name=re.compile('Test Lodge')).click()
     await expect(page.get_by_role('navigation',name='Hotel sections')).to_be_visible()
     await expect(page.get_by_role('heading',name='Today at the hotel',exact=True)).to_be_visible()
     await expect(page.get_by_role('heading',name='Hotel team',exact=True)).to_have_count(0)
     await page.get_by_role('button',name='Back',exact=True).click()
     await expect(page.get_by_role('button',name='Filter properties by status')).to_contain_text('All')
     await select('Filter properties by status','Live')
     await expect(page.get_by_text(re.compile('2 room types.*3 rooms'))).to_be_visible()
     await page.get_by_role('button',name=re.compile('Test Lodge')).click()
     sections=page.get_by_role('navigation',name='Hotel sections')
     await expect(sections.get_by_role('button')).to_have_count(6)
     # A navigation-only screenshot can pass while the actual hotel surface is blank.
     # Wait for the authorized snapshot and assert its inventory before capturing evidence.
     await expect(page.get_by_role('heading',name='Today at the hotel',exact=True)).to_be_visible()
     await expect(page.get_by_role('status',name='Loading hotel operation',exact=True)).to_have_count(0)
     await expect(page.get_by_text('Rooms available',exact=True).locator('..').get_by_text('3',exact=True)).to_be_visible()
     await expect(page.locator('[data-room-availability="8"]').get_by_text('2 sellable',exact=True)).to_be_visible()
     await expect(page.locator('[data-room-availability="9"]').get_by_text('1 sellable',exact=True)).to_be_visible()
     await fits(); await page.screenshot(path=str(OUT/f'property-hotel-overview-{width}.png'),full_page=True)
     # Physical restrictions must change the headline and the room rows together.
     unit_mode='maintenance'; await page.evaluate('window.dispatchEvent(new Event("focus"))')
     await expect(page.get_by_text('Rooms available',exact=True).locator('..').get_by_text('2',exact=True)).to_be_visible()
     await expect(page.locator('[data-room-availability="8"]').get_by_text('1 sellable',exact=True)).to_be_visible()
     await expect(page.get_by_text('Maintenance reduces capacity',exact=True)).to_be_visible()
     unit_mode='missing'; await page.evaluate('window.dispatchEvent(new Event("focus"))')
     await expect(page.get_by_text('Rooms available',exact=True).locator('..').get_by_text('0',exact=True)).to_be_visible()
     await expect(page.get_by_text('0 sellable',exact=True)).to_have_count(2)
     await expect(page.get_by_text('Room setup incomplete',exact=True)).to_have_count(2)
     await expect(page.get_by_text('Maintenance reduces capacity',exact=True)).to_have_count(0)
     unit_mode='ready'; await page.evaluate('window.dispatchEvent(new Event("focus"))')
     await expect(page.get_by_text('Rooms available',exact=True).locator('..').get_by_text('3',exact=True)).to_be_visible()
     await sections.get_by_role('button',name='Reservations',exact=True).click()
     await expect(page.get_by_text('Guest Forty Two',exact=True)).to_be_visible()
     await expect(page.get_by_text('No active payment',exact=True)).to_be_visible()
     await expect(page.get_by_text('Awaiting payment',exact=True)).to_have_count(0)
     await expect(page.get_by_role('heading',name='Hotel team',exact=True)).to_have_count(0)
     await page.get_by_role('button',name='Back',exact=True).click()
     await nav('Inbox')
     await expect(page.get_by_text('Test Lodge',exact=True)).to_be_visible()
     await expect(page.get_by_text('Property inspection WHIR-TEST-ONLY',exact=True)).to_have_count(0)
     await page.get_by_role('button',name=re.compile('Activity')).filter(visible=True).click()
     await page.get_by_role('button',name=re.compile('New paid hotel stay')).click()
     await expect(page.get_by_text('Linked reservation',exact=True)).to_be_visible()
     await expect(page.get_by_text('Guest Forty Two',exact=True)).to_be_visible()
     await expect(page.get_by_text('Cancelled Guest',exact=True)).to_have_count(0)
     assert ('get_my_hotel_booking_target',{'p_booking_id':42}) in calls
     assert ('get_my_hotel_operation_snapshot_v2',{'p_hotel_id':7,'p_booking_id':42}) in calls
     await fits(); await page.screenshot(path=str(OUT/f'property-activity-exact-stay-{width}.png'))
     await page.get_by_role('button',name='Back',exact=True).click()
     await expect(page.get_by_role('button',name='Back to Inbox',exact=True)).to_be_visible()
     await page.get_by_role('button',name=re.compile('New paid hotel stay')).click()
     await expect(page.get_by_text('Linked reservation',exact=True)).to_be_visible()
     await page.go_back()
     await expect(page.get_by_role('button',name='Back to Inbox',exact=True)).to_be_visible()
     await page.go_back()
     await expect(page.get_by_placeholder('Search messages')).to_be_visible()
     assert await page.evaluate('history.state.workspace')=='property_partner'
     # Re-fetch denial must remove previously read private guest data.
     await page.get_by_role('button',name=re.compile('Activity')).filter(visible=True).click()
     await page.get_by_role('button',name=re.compile('New paid hotel stay')).click()
     await expect(page.get_by_text('Guest Forty Two',exact=True)).to_be_visible()
     denied=True; await page.evaluate('window.dispatchEvent(new Event("focus"))')
     await expect(page.get_by_text('Guest Forty Two',exact=True)).to_have_count(0)
     await expect(page.get_by_text(re.compile('your access has changed'))).to_be_visible(); denied=False
     mode='team'
     await page.goto(BASE+'/tests/browser/property-routing.html?mode=team')
     await nav('Inbox'); await page.get_by_role('button',name=re.compile('Activity')).filter(visible=True).click()
     await page.get_by_role('button',name=re.compile('New paid hotel stay')).click()
     await expect(page.get_by_text('Linked reservation',exact=True)).to_be_visible()
     await expect(page.get_by_role('button',name='Guest messages',exact=True)).to_have_count(0)
     assert any(name=='get_my_canonical_activity_v2' and args.get('p_workspace')=='hotel' for name,args in calls)
     assert not any(args.get('p_workspace')=='hotel_staff' for name,args in calls)
     await page.go_back(); await expect(page.get_by_role('button',name='Back to Inbox',exact=True)).to_be_visible()
     mode='creator'
     await page.goto(BASE+'/tests/browser/property-routing.html?mode=creator')
     await page.get_by_role('button',name='View partner',exact=True).click()
     await page.get_by_role('button',name=re.compile('^Hotels')).first.click()
     await page.get_by_role('button',name=re.compile('Test Lodge')).click()
     await page.get_by_role('button',name='Open in Property Operations',exact=True).click()
     await expect(page.get_by_role('button',name='Close property',exact=True)).to_be_visible()
     await expect(page.get_by_text('Test Lodge',exact=True).first).to_be_visible()
     assert any(name=='get_my_property_hotel_record' and args.get('p_hotel_id')==7 for name,args in calls)
     assert not any(name=='get_public_hotel_detail' for name,args in calls)
     await fits(); await page.screenshot(path=str(OUT/f'creator-profile-hotel-record-{width}.png'))
     await page.go_back()
     await expect(page.get_by_role('button',name='Open in Property Operations',exact=True)).to_be_visible()
     assert await page.evaluate('history.state.workspace')=='creator'
     assert not errors,errors
     results.append({'viewport':[width,height],'passed':True,'checks':['Account reachable/no duplicate avatar or switcher','All and Live same hotel manager','rendered overview and actual available-room total before screenshot','headline and room rows agree after maintenance or incomplete setup','inventory from server projection','hotel sections permission-scoped','cancelled unpaid copy','property title not inspection code','exact stay target not chat','button and browser Back retain Activity and workspace','access re-fetch clears private guest data','hotel read-only team Activity','Creator scoped hotel and Back to partner profile'],'page_errors':errors})
     print('PASS property workspace browser',width,flush=True)
    except Exception as error:
     results.append({'viewport':[width,height],'passed':False,'error':str(error),'page_errors':errors,'calls':calls})
     await page.screenshot(path=str(OUT/f'property-routing-failure-{width}.png'),full_page=True)
     raise
    finally:
     (OUT/'property-routing-results.json').write_text(json.dumps(results,indent=2)); await context.close()
  finally: await browser.close()
asyncio.run(main())
