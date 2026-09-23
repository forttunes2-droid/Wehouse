"""Actual public property, Saved and sharing components, with synthetic scoped APIs.
Payment transport is never enabled. The real E2EE two-party crypto is tested in Node;
this browser suite verifies the handoff still reaches the existing PIN gate.
"""
import asyncio, json, os, re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from playwright.async_api import async_playwright, expect
BASE='http://127.0.0.1:4173'; OUT=Path('test-results/experience')
IMAGE=BASE+'/qa-public-property.svg'
IMAGE_BODY='<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><rect width="800" height="500" fill="#2d2244"/><path d="M220 340V220l180-130 180 130v120H220" fill="#644991"/></svg>'
SHORT={'id':'short-home','listing_id':'short-home','title':'Garden Short Let','sub_type':'short_let','type':'apartment','price':120000,'security_deposit_amount':50000,'max_guests':2,'bedrooms':1,'bathrooms':1,'address':'Test road','city':'Lafia','state':'Nasarawa','images':[IMAGE],'videos':[],'status':'available','is_verified':True,'amenities':['WiFi']}
LONG={**SHORT,'id':'long-home','listing_id':'long-home','title':'Courtyard Long Let','sub_type':'long_stay','price':100000,'security_deposit_amount':0}
HOTEL={'hotel_id':7,'name':'Garden Lodge','city':'Lafia','state':'Nasarawa','area':'Town','address':'Test road','status':'active','images':[IMAGE],'amenities':[],'hotel_rooms':[],'venues':[]}
CONNECTIONS=[{'id':'chat-ada','participant_a':'qa-personal','participant_b':'qa-ada','conversation_type':'roommate','status':'active'}, {'id':'chat-blocked','participant_a':'qa-personal','participant_b':'qa-blocked','conversation_type':'roommate','status':'active'}, {'id':'chat-pending','participant_a':'qa-personal','participant_b':'qa-pending','conversation_type':'roommate','status':'pending'}, {'id':'not-my-chat','participant_a':'elsewhere','participant_b':'qa-outside','conversation_type':'roommate','status':'active'}]
PEERS=[{'user_id':'qa-ada','full_name':'Ada Example','username':'ada-example','avatar_url':None,'is_blocked':False}, {'user_id':'qa-blocked','full_name':'Blocked Example','username':'blocked','is_blocked':True}, {'user_id':'qa-pending','full_name':'Pending Example','username':'pending','is_blocked':False}]
NOW=datetime.now(timezone.utc); TOMORROW=(NOW+timedelta(days=2)).date().isoformat(); CHECKOUT=(NOW+timedelta(days=4)).date().isoformat()
class Scenario:
 def __init__(self): self.calls=[]; self.errors=[]; self.fail_saved=False; self.delay_listing=0; self.delay_account=0; self.hotel_sent=False; self.hotel_reads=0; self.guest_mode=False
 async def route(self, handler):
  request=handler.request
  if request.url==IMAGE: return await handler.fulfill(status=200,content_type='image/svg+xml',body=IMAGE_BODY)
  if request.url.startswith(BASE):
   if request.resource_type=='document': self.guest_mode='mode=guest' in request.url
   return await handler.continue_()
  if not request.url.startswith('http://127.0.0.1:54321/'): return await handler.abort()
  if request.method=='OPTIONS': return await handler.fulfill(status=204,headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'})
  name=request.url.split('/')[-1].split('?')[0]; args=request.post_data_json if request.post_data else {}; self.calls.append((name,args)); data=[]; status=200
  if name=='saved_hotels':
   if self.fail_saved: data={'message':'Saved unavailable','code':'QA_ERROR'}; status=503
   else: data=[{'hotel_id':7}]
  elif name=='get_public_listing_detail':
   if self.delay_listing: await asyncio.sleep(self.delay_listing)
   data={'short-home':SHORT,'long-home':LONG}.get(args.get('p_listing_id'))
  elif name=='get_public_hotel_detail': data=HOTEL
  elif name=='get_my_reservation_for_listing':
   if self.delay_account: await asyncio.sleep(self.delay_account)
   data=None
  elif name in ['get_inspection_for_reservation','get_my_pending_device_login_alert']: data=None
  elif name=='get_discoverable_listings': data=[SHORT,LONG]
  elif name=='get_discoverable_hotels': data=[HOTEL]
  elif name=='get_hotel_booking_messages':
   self.hotel_reads+=1
   if self.hotel_sent: await asyncio.sleep(2)
   data=[{'id':'hotel-first','sender_id':'hotel-team','sender_name':'Garden Lodge','sender_role':'hotel','content':'Welcome to Garden Lodge','attachments':[],'attachment_types':[],'reactions':{},'is_read':True,'created_at':NOW.isoformat()}]
   if self.hotel_sent: data.append({'id':'hotel-ack','sender_id':'qa-personal','sender_name':'QA','sender_role':'guest','content':'I arrive at six','attachments':[],'attachment_types':[],'reactions':{},'is_read':False,'created_at':(NOW+timedelta(seconds=1)).isoformat()})
  elif name=='send_hotel_booking_message':
   await asyncio.sleep(.6); self.hotel_sent=True; data='hotel-ack'
  elif name=='mark_hotel_booking_messages_read':
   await asyncio.sleep(1); data=True
  elif name=='create_short_stay_reservation': data={'id':'short-reservation-1','status':'payment_pending','stay_check_in':TOMORROW,'stay_check_out':CHECKOUT,'stay_guests':1,'stay_total_amount':290000}
  elif name=='get_my_roommate_peer_details': data=PEERS
  elif name=='get_user_conversations': data=CONNECTIONS
  elif name in ['get_my_e2ee_identity','e2ee_identity','e2ee_identities','user_encryption_identities']: data=None
  elif name=='get_my_canonical_activity_v2': data=[{'id':f'event-{scope}','workspace':scope,'type':'hotel.confirmed' if scope=='property_partner' else 'search_match','title':'Partner guest update' if scope=='property_partner' else 'Personal saved search must stay Personal','message':'Synthetic update','source_type':'hotel_booking','source_id':'42','destination_route':'hotel_booking','destination_params':{'hotel_id':7,'booking_id':42},'read':False,'created_at':NOW.isoformat(),'action_required':False} for scope in ['personal','property_partner']]
  elif name=='get_my_canonical_activity_summary': data={'unread':1,'needs_action':0}
  elif name=='get_my_legal_status': data={}
  if self.guest_mode and name in ['get_discoverable_listings','get_discoverable_hotels','get_public_hotel_detail','get_public_listing_detail'] and data:
   def mixed_media(record): return {**record,'images':[*record.get('images',[]),'partner/private-unpublished.jpg','https://test.supabase.co/storage/v1/object/sign/listing-candidates/private.jpg?token=not-a-real-token']}
   data=[mixed_media(record) for record in data] if isinstance(data,list) else mixed_media(data)
  await handler.fulfill(status=status,content_type='application/json',body=json.dumps(data),headers={'access-control-allow-origin':'*'})
 async def open(self,browser,mode,width):
  context=await browser.new_context(viewport={'width':width,'height':900},service_workers='block')
  page=await context.new_page(); page.on('pageerror',lambda error:self.errors.append(str(error))); await page.route('**/*',self.route)
  await page.goto(BASE+'/tests/browser/property-experience.html?mode='+mode)
  return context,page
async def fits(page): assert await page.evaluate('document.documentElement.scrollWidth <= innerWidth+1')
async def main():
 OUT.mkdir(parents=True,exist_ok=True); results=[]
 async with async_playwright() as p:
  browser=await p.chromium.launch(args=['--no-sandbox'])
  try:
   for width in [320,390,768,1440]:
    scenario=Scenario(); context,page=await scenario.open(browser,'saved',width)
    try:
     await expect(page.get_by_role('button',name='View Garden Lodge',exact=True)).to_be_visible()
     await expect(page.get_by_role('button',name='View Garden Short Let',exact=True)).to_be_visible()
     await expect(page.get_by_role('heading',name='Saved apartments',exact=True)).to_have_count(0)
     await expect(page.get_by_role('heading',name='Saved hotels',exact=True)).to_have_count(0)
     await expect(page.get_by_role('button',name='View Saved home unavailable',exact=True)).to_be_disabled()
     await fits(page); await page.screenshot(path=str(OUT/f'saved-unified-{width}.png'),full_page=True)
     await page.get_by_label('Property type').select_option('hotel')
     await expect(page.get_by_role('button',name='View Garden Short Let',exact=True)).to_have_count(0)
     await page.get_by_role('button',name='View Garden Lodge',exact=True).click()
     assert await page.evaluate('window.__destination.kind')=='hotel'
     await expect(page.get_by_role('heading',name='Garden Lodge',exact=True)).to_be_visible()
     assert any(name=='get_public_hotel_detail' and args.get('p_hotel_id')==7 for name,args in scenario.calls)
     assert not any(name=='get_public_listing_detail' and args.get('p_listing_id')=='7' for name,args in scenario.calls)
     await page.goto(BASE+'/tests/browser/property-experience.html?mode=short')
     reserve=page.get_by_role('button',name='Reserve date',exact=True)
     await expect(reserve).to_be_visible(); await expect(reserve).to_be_disabled()
     await expect(page.get_by_role('button',name=re.compile('Pay for stay'))).to_have_count(0)
     await expect(page.get_by_text('Estimated total',exact=True)).to_have_count(0)
     await page.get_by_label('Check-in',exact=True).fill(TOMORROW)
     await page.get_by_label('Check-out',exact=True).fill(CHECKOUT)
     await expect(reserve).to_be_enabled()
     await expect(page.get_by_text('₦290,000',exact=True)).to_have_count(0)
     await expect(page.get_by_text('Estimated total',exact=True)).to_have_count(0)
     await expect(page.get_by_text('Stay rent',exact=True)).to_have_count(0)
     await fits(page); await reserve.scroll_into_view_if_needed(); await page.screenshot(path=str(OUT/f'short-let-reserve-date-{width}.png'))
     await reserve.click()
     await expect(page.get_by_role('heading',name='Existing booking destination',exact=True)).to_be_visible()
     assert await page.evaluate('window.__booking')=='short-reservation-1'
     assert sum(name=='create_short_stay_reservation' for name,_ in scenario.calls)==1
     assert not any(name in ['payment-init','initialize_short_stay_payment','create_shared_housing_group'] for name,_ in scenario.calls)
     # Public guest reads must not invoke personal, reservation or messaging APIs.
     before_guest=len(scenario.calls)
     await page.goto(BASE+'/tests/browser/property-experience.html?mode=guest')
     await page.get_by_role('button',name='Explore places first',exact=True).click()
     await expect(page.get_by_role('button',name='View Garden Lodge',exact=True)).to_be_visible()
     await page.get_by_role('button',name='View Garden Lodge',exact=True).click()
     await expect(page.get_by_role('heading',name='Garden Lodge',exact=True)).to_be_visible()
     await fits(page)
     await expect(page.locator('img').first).to_be_visible()
     await page.wait_for_function('document.querySelector("img")?.naturalWidth > 0')
     assert await page.locator('img').count()==1,'Private or signed media leaked into public gallery'
     await page.screenshot(path=str(OUT/f'guest-hotel-{width}.png'))
     allowed={'get_discoverable_listings','get_discoverable_hotels','get_public_hotel_detail','get_public_listing_detail'}
     assert all(name in allowed for name,_ in scenario.calls[before_guest:]),scenario.calls[before_guest:]
     await page.get_by_role('button',name='Sign in to continue',exact=True).click()
     assert await page.evaluate('window.__guestSignIn') is True
     assert await page.evaluate('JSON.parse(sessionStorage.getItem("wh_public_property_intent_v1")).property')=={'kind':'hotel','id':'7'}
     assert all(name in allowed for name,_ in scenario.calls[before_guest:]),scenario.calls[before_guest:]
     # Received property is a public typed card, never a financial invitation.
     await page.goto(BASE+'/tests/browser/property-experience.html?mode=received')
     await page.get_by_role('button',name='View Garden Lodge',exact=True).click()
     await expect(page.get_by_role('heading',name='Garden Lodge',exact=True)).to_be_visible()
     # Named recipients and unchanged encrypted Inbox gate on the actual sending path.
     await page.goto(BASE+'/tests/browser/property-experience.html?mode=short')
     await page.get_by_role('button',name=re.compile('^Send property')).click()
     dialog=page.get_by_role('dialog',name='Send property',exact=True)
     await expect(dialog).to_be_visible(); await expect(dialog.get_by_role('button',name=re.compile('Ada Example'))).to_be_visible()
     await expect(dialog.get_by_text('Blocked Example',exact=True)).to_have_count(0)
     await expect(dialog.get_by_text('Pending Example',exact=True)).to_have_count(0)
     await fits(page); await page.screenshot(path=str(OUT/f'send-property-connections-{width}.png'))
     await dialog.get_by_role('button',name=re.compile('Ada Example')).click()
     assert await page.evaluate('window.__conversation')=='chat-ada'
     assert await page.evaluate('window.__draftAtOpen')=={'kind':'listing','id':'short-home'}
     await expect(page.get_by_role('heading',name='Private messages are locked',exact=True)).to_be_visible()
     assert not any(name in ['send_message','send_roommate_message','create_shared_housing_group'] for name,_ in scenario.calls)
     # Backend-returned Personal records must not appear in Partner Activity.
     await page.goto(BASE+'/tests/browser/property-experience.html?mode=activity')
     await expect(page.get_by_text('Partner guest update',exact=True)).to_be_visible()
     await expect(page.get_by_text('Personal saved search must stay Personal',exact=True)).to_have_count(0)
     await page.get_by_role('button',name=re.compile('Partner guest update')).click()
     assert await page.evaluate('window.__activityDestination.page')=='hotel_booking'
     assert not scenario.errors,scenario.errors
     results.append({'width':width,'passed':True,'checks':['Unified Saved and unavailable item','Hotel identity preserved','Short Let no price without dates','Reserve date opens existing booking without payment','Received property typed public card','Named accepted connections only','PIN gate preserved and no automatic sending','Workspace-scoped Activity'],'page_errors':scenario.errors})
     print('PASS public property experience',width,flush=True)
    except Exception as error:
     results.append({'width':width,'passed':False,'error':str(error),'calls':scenario.calls,'page_errors':scenario.errors}); await page.screenshot(path=str(OUT/f'public-property-failure-{width}.png'),full_page=True); raise
    finally:
     (OUT/'public-property-results.json').write_text(json.dumps(results,indent=2)); await context.close()
   scenario=Scenario(); context,page=await scenario.open(browser,'hotel-chat',390)
   try:
    await expect(page.get_by_text('Welcome to Garden Lodge',exact=True)).to_be_visible()
    initial_reads=scenario.hotel_reads
    await page.evaluate('window.__rerenderHotel()')
    await page.wait_for_timeout(200)
    assert scenario.hotel_reads==initial_reads,'Parent redraw reloaded hotel history'
    # The dialog's accessible name is the real hotel, not the old generic label.
    # Keep the visual isolation assertion: every corner must hit this dialog,
    # whose solid background covers the entire viewport.
    hotel_dialog=page.get_by_role('dialog',name='Garden Lodge',exact=True)
    await expect(hotel_dialog).to_be_visible()
    assert await hotel_dialog.evaluate("""el => {
      const r=el.getBoundingClientRect(), css=getComputedStyle(el);
      const points=[[1,1],[innerWidth-2,1],[1,innerHeight-2],[innerWidth-2,innerHeight-2]];
      return el.parentElement===document.body && r.left<=0 && r.top<=0 &&
        r.right>=innerWidth && r.bottom>=innerHeight &&
        css.backgroundColor==='rgb(9, 11, 16)' && css.opacity==='1' &&
        points.every(([x,y]) => el.contains(document.elementFromPoint(x,y)));
    }"""), 'Hotel conversation must opaquely cover the viewport'
    await page.locator('textarea[placeholder="Message"]').fill('I arrive at six')
    await page.get_by_role('button',name='Send message',exact=True).click()
    await expect(page.get_by_text('I arrive at six',exact=True)).to_be_visible(timeout=400)
    await page.locator('textarea[placeholder="Message"]').fill('Keep my next message')
    await expect(page.get_by_role('button',name='Send message',exact=True)).to_be_enabled(timeout=1600)
    await expect(page.get_by_text('I arrive at six',exact=True)).to_have_count(1)
    await expect(page.locator('textarea[placeholder="Message"]')).to_have_value('Keep my next message')
    await page.screenshot(path=str(OUT/'hotel-ack-without-history-wait.png'))
    await page.wait_for_timeout(2300)
    await expect(page.get_by_text('I arrive at six',exact=True)).to_have_count(1)
    await expect(page.locator('textarea[placeholder="Message"]')).to_have_value('Keep my next message')
    assert not scenario.errors,scenario.errors
    results.append({'case':'Hotel stable history and acknowledged send','passed':True})
   finally:
    (OUT/'public-property-results.json').write_text(json.dumps(results,indent=2)); await context.close()
   scenario=Scenario(); scenario.delay_account=2; context,page=await scenario.open(browser,'short',390)
   try:
    await expect(page.get_by_role('heading',name='Garden Short Let',exact=True)).to_be_visible(timeout=1500)
    await expect(page.get_by_role('status',name='Checking your booking status',exact=True)).to_be_visible()
    await expect(page.get_by_role('button',name='Reserve date',exact=True)).to_have_count(0)
    await page.screenshot(path=str(OUT/'property-visible-during-account-check.png'),full_page=True)
    await expect(page.get_by_role('button',name='Reserve date',exact=True)).to_be_visible(timeout=5000)
    assert not any(name=='create_short_stay_reservation' for name,_ in scenario.calls)
    assert not scenario.errors,scenario.errors
    results.append({'case':'Public property before account check','passed':True})
   finally:
    (OUT/'public-property-results.json').write_text(json.dumps(results,indent=2)); await context.close()
   scenario=Scenario(); scenario.fail_saved=True; context,page=await scenario.open(browser,'saved',390)
   try:
    # PostgREST retries an idempotent GET on 503. The UI's 15-second request
    # deadline, not Playwright's default five seconds, is the acceptance limit.
    await expect(page.get_by_role('alert')).to_contain_text('have not been removed',timeout=20000)
    await expect(page.get_by_text('No saved places yet',exact=True)).to_have_count(0)
    assert any(name=='saved_hotels' for name,_ in scenario.calls)
    await page.screenshot(path=str(OUT/'saved-unavailable-not-empty.png'))
    scenario.fail_saved=False; await page.get_by_role('button',name='Try again',exact=True).click()
    await expect(page.get_by_role('button',name='View Garden Lodge',exact=True)).to_be_visible()
    assert not scenario.errors,scenario.errors
    results.append({'case':'Saved 503 and recovery','passed':True,'checks':['bounded retry state, not false empty','explicit retry restores saved hotel'],'page_errors':scenario.errors})
   except Exception as error:
    results.append({'case':'Saved 503 and recovery','passed':False,'error':str(error),'calls':scenario.calls,'page_errors':scenario.errors})
    await page.screenshot(path=str(OUT/'saved-retry-failure.png'),full_page=True); raise
   finally:
    (OUT/'public-property-results.json').write_text(json.dumps(results,indent=2)); await context.close()
  finally: await browser.close()
asyncio.run(main())
