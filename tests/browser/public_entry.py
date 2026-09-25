"""Actual Login and public-discovery components via the existing isolated App.
Synthetic APIs and test media only. This is not live OAuth/payment acceptance.
"""
import asyncio,json,re
from pathlib import Path
from playwright.async_api import async_playwright,expect
from experience import Scenario,BASE,OUT
HOME={'id':'public-home','title':'Courtyard apartment','sub_type':'long_stay','city':'Lafia','state':'Nasarawa','status':'available','price':400000,'images':[],'amenities':[],'description':'A sample published home.'}
HOTEL={'hotel_id':7,'name':'Garden Lodge','city':'Keffi','state':'Nasarawa','status':'active','images':[],'amenities':[],'hotel_rooms':[{'room_id':9,'room_type':'Standard','price_per_night':30000,'images':[],'max_guests':2,'bed_type':'1 double bed','rate_plans':[{'rate_plan_id':91,'name':'Room only','price_per_night':30000,'meal_plan':'room_only','payment_timing':'pay_now','refundable':False,'active':True,'included_features':[]},{'rate_plan_id':92,'name':'Breakfast included','price_per_night':35000,'meal_plan':'breakfast','payment_timing':'pay_now','refundable':True,'cancellation_hours':24,'active':True,'included_features':['Breakfast']}]}],'description':'A sample published hotel.'}
class PublicScenario(Scenario):
 def __init__(self):super().__init__();self.fail=False
 async def route(self,route):
  name=route.request.url.split('/')[-1].split('?')[0]
  data=None
  if name in ['get_discoverable_listings','get_discoverable_hotels','get_public_listing_detail','get_public_hotel_detail']:
   self.calls.append((name,route.request.post_data_json))
   if self.fail:return await route.fulfill(status=503,content_type='application/json',body=json.dumps({'message':'Fixture read unavailable'}))
   data={'get_discoverable_listings':[HOME],'get_discoverable_hotels':[HOTEL],'get_public_listing_detail':HOME,'get_public_hotel_detail':HOTEL}[name]
   return await route.fulfill(status=200,content_type='application/json',body=json.dumps(data),headers={'access-control-allow-origin':'*'})
  return await super().route(route)
async def main():
 OUT.mkdir(parents=True,exist_ok=True);results=[]
 async with async_playwright() as p:
  browser=await p.chromium.launch()
  try:
   for width,height in [(320,740),(390,844),(768,900),(1440,900)]:
    scenario=PublicScenario();context=await browser.new_context(viewport={'width':width,'height':height},service_workers='block');page=await context.new_page();page.set_default_timeout(8000)
    page.on('pageerror',lambda error:scenario.errors.append(str(error)));await page.route('**/*',scenario.route)
    row={'width':width,'passed':False}
    try:
     await page.goto(BASE+'/tests/browser/experience.html?fixture=login&presentation_environment=live')
     await expect(page.get_by_role('heading',name='Find what you need',exact=True)).to_be_visible()
     await expect(page.get_by_placeholder('City, area or apartment')).to_be_visible()
     await expect(page.get_by_role('button',name='Explore places first',exact=True)).to_have_count(0)
     await expect(page.get_by_role('dialog')).to_have_count(0)
     nav=page.get_by_role('navigation',name='Main navigation')
     await expect(nav).to_be_visible()
     for label in ['Explore','Bookings','Inbox','Account']:
      await expect(nav.get_by_role('button',name=label,exact=True)).to_be_visible()
     await nav.get_by_role('button',name='Bookings',exact=True).click()
     await expect(page.get_by_role('heading',name='Your bookings',exact=True)).to_be_visible()
     await expect(page.get_by_text('Sign in to view and manage your bookings.',exact=True)).to_be_visible()
     await nav.get_by_role('button',name='Inbox',exact=True).click()
     await expect(page.get_by_role('heading',name='Your inbox',exact=True)).to_be_visible()
     await expect(page.get_by_text('Sign in to see your messages, requests and updates.',exact=True)).to_be_visible()
     await nav.get_by_role('button',name='Account',exact=True).click()
     await expect(page.get_by_role('heading',name='Your account',exact=True)).to_be_visible()
     await expect(page.get_by_text('Sign in to manage your profile, saved places and settings.',exact=True)).to_be_visible()
     await expect(page.get_by_role('button',name='Terms of Service',exact=True)).to_be_visible()
     await expect(page.get_by_role('button',name='Privacy Policy',exact=True)).to_be_visible()
     await page.screenshot(path=str(OUT/f'public-account-gate-{width}.png'),full_page=True)
     await nav.get_by_role('button',name='Explore',exact=True).click()
     await expect(page.get_by_role('button',name='Terms of Service',exact=True)).to_have_count(0)
     await expect(page.get_by_role('button',name='Privacy Policy',exact=True)).to_have_count(0)
     await page.get_by_role('button',name='Hotels',exact=True).click()
     await expect(page.get_by_role('button',name='View Garden Lodge',exact=True)).to_be_visible()
     assert not any(name.startswith(('create_','initialize_','send_','get_my_')) for name,_ in scenario.calls if name not in ('get_my_legal_status','get_my_pending_device_login_alert'))
     await page.screenshot(path=str(OUT/f'public-landing-{width}.png'))
     await page.get_by_placeholder('Search hotel name').fill('Garden')
     await page.get_by_role('button',name='View Garden Lodge',exact=True).click()
     await expect(page.get_by_role('heading',name='Garden Lodge',exact=True)).to_be_visible()
     await page.get_by_role('button',name='Save hotel',exact=True).click()
     await expect(page.get_by_role('heading',name='Welcome',exact=True)).to_be_visible()
     await expect(page.locator('.wh-public-entry')).to_have_count(0)
     await expect(page.get_by_role('button',name='Continue with email',exact=True)).to_be_visible()
     await expect(page.get_by_role('button',name='Continue with Google',exact=True)).to_be_visible()
     assert await page.evaluate('JSON.parse(sessionStorage.getItem("wh_public_property_intent_v1")).property')=={'kind':'hotel','id':'7'}
     await page.screenshot(path=str(OUT/f'landing-signin-options-{width}.png'),full_page=True)
     await page.get_by_role('button',name='Continue with email',exact=True).click()
     await expect(page.get_by_label('Username or email',exact=True)).to_be_visible()
     await page.get_by_label('Username or email',exact=True).fill('sample@example.invalid')
     await page.locator('input[autocomplete=current-password]').fill('Only-a-fixture-password')
     await page.screenshot(path=str(OUT/f'landing-email-signin-{width}.png'),full_page=True)
     # Native Back closes the auth entry, restores that property, and does not
     # leave either the invisible auth page or an interaction lock behind.
     await page.go_back()
     await expect(page.get_by_role('heading',name='Garden Lodge',exact=True)).to_be_visible()
     await expect(page.locator('.wh-auth-form')).to_have_count(0)
     await page.get_by_role('button',name='Back to hotels',exact=True).click()
     await expect(page.get_by_placeholder('Search hotel name')).to_have_value('Garden')
     await expect(page.get_by_role('button',name='View Garden Lodge',exact=True)).to_be_visible()
     assert not await page.evaluate('document.getElementById("root").inert')
     assert await page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
     assert not scenario.errors,scenario.errors
     row['passed']=True
    except Exception as error:
     row['error']=str(error);row['page_errors']=scenario.errors;await page.screenshot(path=str(OUT/f'public-entry-FAIL-{width}.png'),full_page=True)
    finally:results.append(row);await context.close()
  finally:await browser.close()
 (OUT/'public-entry-results.json').write_text(json.dumps(results,indent=2));print(json.dumps(results,indent=2));assert all(row['passed'] for row in results)
asyncio.run(main())
# The same real Login must also remain non-interactive during a pending request
# and while its authenticated account/device checks finish.
import auth_pending  # Runs the independent offline response-state regressions.

