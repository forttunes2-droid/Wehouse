"""Same production components for guests and signed-in customers, isolated APIs.
No live account, database, provider, payment or published data is changed.
"""
import asyncio,json,os,subprocess
from urllib.parse import urlparse,parse_qs
from pathlib import Path
from playwright.async_api import async_playwright,expect
OUT=Path('test-results/experience');B=Path('test-results/shared-discovery-offline')
HOME={'id':'public-home','title':'Courtyard apartment','sub_type':'long_stay','property_type':'apartment','availability_status':'available','city':'Lafia','state':'Nasarawa','address':'Test road','status':'available','price':400000,'images':['https://assets.wehouse.test/interior.jpg'],'amenities':[],'description':'Sample home','bedrooms':2,'bathrooms':1}
RATES=[{'rate_plan_id':10,'room_id':9,'active':True,'name':'Room only','meal_plan':'room_only','payment_timing':'pay_now','refundable':False,'cancellation_hours':None,'price_per_night':30000,'included_features':[]},{'rate_plan_id':11,'room_id':9,'active':True,'name':'Breakfast stay','meal_plan':'breakfast','payment_timing':'pay_now','refundable':True,'cancellation_hours':48,'price_per_night':35000,'included_features':['Lounge access']}]
HOTEL={'hotel_id':7,'name':'Garden Lodge','city':'Keffi','state':'Nasarawa','address':'Hotel test road','status':'active','images':[],'amenities':[],'hotel_rooms':[{'room_id':9,'room_type':'Standard','price_per_night':30000,'images':[],'max_guests':2,'bed_type':'Double bed','rate_plans':RATES}],'description':'Sample hotel.'}
SCRIPT="""s=>{
 window.__browse=s;
 window.__browse.gatewayRequests=[];
 window.addEventListener('openSupportChat',event=>{window.__browse.dataRequest=event.detail;});
 for(const name of ['sessionStorage','localStorage']){const data=new Map();Object.defineProperty(window,name,{value:{getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,String(value)),removeItem:key=>data.delete(key),clear:()=>data.clear()}})}
 window.__browseAPI=async(name,args)=>{
  const s=window.__browse;s.calls.push({name,args});
  if(name==='getHotels')return{hotels:[s.hotel],error:null};
  if(name==='getHotelById')return{hotel:s.hotel,error:null};
  if(name==='getListing')return{listing:s.home,error:null};
  if(name==='getHotelReviews')return{reviews:[],eligible:false,error:null};
  if(name==='getReservationForListing')return{reservation:null,error:null};
  if(name==='rpc:search_discoverable_homes')return{data:{items:[s.home],has_more:false,next_cursor_created_at:null,next_cursor_id:null},error:null};
  if(name==='rpc:get_sponsored_discovery')return{data:[],error:null};
  if(name==='rpc:get_public_discovery_settings')return{data:[],error:null};
  if(name==='rpc:get_my_page_distances')return{data:[{subject_type:'hotel',subject_id:'7',distance_km:2}],error:null};
  if(name==='rpc:get_my_workspace_access')return{data:{identity:{user_id:'qa-viewer'},personal_workspace:true,privileged_workspaces:[]},error:null};
  if(['rpc:get_all_settings_v2','rpc:get_my_saved_searches','rpc:get_my_saved_hotels','rpc:get_my_saved_hotel_ids','rpc:get_my_shared_housing_groups','table:saved_searches','table:saved_hotels'].includes(name))return{data:[],error:null};
  s.unexpected.push({name,args});throw new Error('Unexpected browse API '+name);
 };
}"""
async def main():
 subprocess.run(['node','tests/browser/build-shared-discovery.mjs'],check=True);OUT.mkdir(parents=True,exist_ok=True);results=[]
 async with async_playwright() as p:
  options={'headless':True,'args':['--no-sandbox']}
  if os.getenv('CHROMIUM_PATH'):options['executable_path']=os.environ['CHROMIUM_PATH']
  browser=await p.chromium.launch(**options)
  for width,theme in [(w,t) for w in [320,390,768,1440] for t in ['dark','light']]:
   context=await browser.new_context(viewport={'width':width,'height':844},service_workers='block');page=await context.new_page();page.set_default_timeout(4000);errors=[];page.on('pageerror',lambda e:errors.append(str(e)));row={'width':width,'theme':theme,'passed':False}
   async def route(request):
    if request.request.url=='https://wehouse-preview.vercel.app/':
     return await request.fulfill(status=200,content_type='text/html',body=f'<html data-wh-theme="{theme}"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:var(--wh-bg)"><div id="root"></div></body></html>')
    if request.request.url.startswith('https://wehouse-preview.vercel.app/api/public-catalog?'):
     assert request.request.method=='GET'
     assert not request.request.headers.get('authorization') and not request.request.headers.get('cookie')
     kind=parse_qs(urlparse(request.request.url).query)['kind'][0]
     assert kind in ['homes','hotels']
     await page.evaluate('(kind)=>window.__browse.gatewayRequests.push(kind)',kind)
     count=await page.evaluate('window.__browse.homeCount||1') if kind=='homes' else 1
     homes=[HOME]+[{**HOME,'id':f'public-home-{n}','title':f'Courtyard apartment {n}'} for n in range(2,count+1)]
     return await request.fulfill(status=200,content_type='application/json',body=json.dumps({'items':homes if kind=='homes' else [HOTEL],'has_more':False}))
    if request.request.url.startswith('https://wehouse-preview.vercel.app/brand/v4/'):
     name=urlparse(request.request.url).path.rsplit('/',1)[-1]
     return await request.fulfill(status=200,content_type='image/svg+xml',body=Path('public/brand/v4',name).read_bytes())
    if request.request.url=='https://assets.wehouse.test/interior.jpg':return await request.fulfill(status=200,content_type='image/jpeg',body=Path('public/hero-interior.jpg').read_bytes())
    return await request.abort()
   media_requests=[]
   page.on('request',lambda request:media_requests.append(request.url))
   await page.route('**/*',route)
   try:
    await page.goto('https://wehouse-preview.vercel.app/')
    await page.evaluate(SCRIPT,{'mode':'public','calls':[],'unexpected':[],'home':HOME,'hotel':HOTEL})
    await page.add_style_tag(path=str(B/'fixture.css'));await page.add_script_tag(path=str(B/'fixture.js'))
    await expect(page.get_by_role('heading',name='Find what you need',exact=True)).to_be_visible()
    await expect(page.get_by_role('navigation',name='Main navigation').get_by_role('button',name='Sign in',exact=True)).to_be_visible()
    await expect(page.get_by_placeholder('City, area or home')).to_be_visible()
    await page.get_by_role('button',name='Open filters',exact=True).click()
    await expect(page.get_by_role('button',name='Filter home type',exact=True)).to_have_count(0)
    await expect(page.get_by_text('Bungalow',exact=True)).to_have_count(0)
    await expect(page.get_by_text('Apartment / flat',exact=True)).to_have_count(0)
    await expect(page.get_by_role('checkbox',name='Penthouse',exact=True)).to_be_visible()
    await expect(page.get_by_role('button',name='Studio / self-contained',exact=True)).to_be_visible()
    await page.get_by_role('button',name='Close filters',exact=True).click()
    await page.get_by_role('button',name='Services',exact=True).click()
    await expect(page.get_by_role('heading',name='Sign in to find a professional',exact=True)).to_be_visible()
    await expect(page.get_by_role('listitem')).to_have_count(0)
    await page.get_by_role('button',name='Sign in to continue',exact=True).click()
    assert await page.evaluate("sessionStorage.getItem('wh_guest_return_tab_v1')")=='services'
    await page.get_by_role('navigation',name='Main navigation').get_by_role('button',name='Explore',exact=True).click()
    await page.get_by_role('button',name='Roommates',exact=True).click()
    await expect(page.get_by_role('heading',name='Sign in to find a roommate',exact=True)).to_be_visible()
    await expect(page.get_by_role('listitem')).to_have_count(0)
    await page.get_by_role('button',name='Sign in to continue',exact=True).click()
    assert await page.evaluate("sessionStorage.getItem('wh_guest_return_tab_v1')")=='roommate'
    await page.get_by_role('navigation',name='Main navigation').get_by_role('button',name='Explore',exact=True).click()
    assert not any(('get_my_' in c['name'] or c['name'].startswith('table:')) for c in await page.evaluate('window.__browse.calls'))
    await page.wait_for_function('Array.from(document.querySelectorAll("[data-media-thumbnail] img")).some(img=>img.complete&&img.naturalWidth>0)')
    await page.screenshot(path=str(OUT/f'shared-explore-guest-{width}-{theme}.png'),full_page=True,timeout=15000)
    await page.evaluate('window.__browse.homeCount=4;window.__switchBrowseMode("homes")')
    await expect(page.locator('[data-home-card]')).to_have_count(4)
    assert await page.locator('[data-home-card]').first.get_by_role('button',name='View Courtyard apartment',exact=True).is_visible()
    await expect(page.get_by_role('button',name='Sign in',exact=True)).to_have_count(0)
    await expect(page.get_by_role('heading',name='Find what you need',exact=True)).to_be_visible()
    await expect(page.get_by_placeholder('City, area or home')).to_be_visible()
    await expect(page.locator('[data-home-card]').first).to_contain_text('₦400,000')
    await page.evaluate('window.__switchBrowseMode("locations")')
    await expect(page.get_by_role('button',name='Local Government Any local area',exact=True)).to_be_disabled()
    await page.get_by_role('button',name='State Any region',exact=True).click()
    await page.get_by_placeholder('Search regions').fill('nasar')
    await page.get_by_role('option',name='Nasarawa',exact=True).click()
    await page.get_by_role('button',name='Local Government Any local area',exact=True).click()
    await page.get_by_placeholder('Search local areas').fill('laf')
    await page.get_by_role('option',name='Lafia',exact=True).click()
    await expect(page.get_by_label('Chosen local area')).to_have_text('Lafia')
    await page.get_by_role('button',name='State Nasarawa',exact=True).click()
    await page.get_by_placeholder('Search regions').fill('lagos')
    await page.get_by_role('option',name='Lagos',exact=True).click()
    await expect(page.get_by_label('Chosen local area')).to_have_text('')
    await page.evaluate('window.__switchBrowseMode("privacy")')
    await page.get_by_role('button',name='Request access, correction or deletion',exact=False).click()
    request=await page.evaluate('window.__browse.dataRequest')
    assert request['category']=='account_access' and request['contextSnapshot']=={'source_type':'privacy_request','source_id':'qa-viewer'}
    await expect(page.get_by_text('Choose what you need in the message and send it to submit your request.',exact=False)).to_be_visible()
    await page.evaluate('window.__switchBrowseMode("homes")')
    await expect(page.locator('[data-home-card] [data-media-thumbnail]').first).to_have_attribute('data-media-state','ready')
    await page.screenshot(path=str(OUT/f'shared-explore-signed-in-{width}-{theme}.png'),full_page=True,timeout=15000)
    await page.evaluate('window.__switchBrowseMode("public");window.__browse.calls=[]')
    await page.get_by_role('button',name='Hotels',exact=True).click()
    await page.get_by_placeholder('Search hotel name or location').fill('Keffi Garden')
    await page.get_by_role('button',name='View Garden Lodge',exact=True).click()
    await expect(page.get_by_role('heading',name='Garden Lodge',exact=True)).to_be_visible()
    gallery=page.get_by_role('region',name='Garden Lodge media',exact=True)
    await expect(gallery.get_by_text('Photos are not available.',exact=True)).to_be_visible()
    assert (await gallery.bounding_box())['height']<150
    await page.locator('[data-room-choice="9"] > button').click()
    await expect(page.get_by_role('group',name='Standard packages')).to_be_visible()
    await expect(page.get_by_text('Refundable · cancel at least 48 hours before check-in',exact=True)).to_be_visible()
    await expect(page.get_by_text('Non-refundable',exact=True)).to_be_visible()
    await page.get_by_role('button',name='Breakfast stay',exact=False).click()
    await expect(page.get_by_role('button',name='Breakfast stay',exact=False)).to_have_attribute('aria-pressed','true')
    await page.locator('[data-room-choice="9"]').screenshot(path=str(OUT/f'hotel-room-and-offers-{width}-{theme}.png'))
    assert not any(('get_my_' in c['name'] or c['name'].startswith('table:')) or c['name'].startswith(('create_','saveHotel','rpc:save_')) for c in await page.evaluate('window.__browse.calls'))
    await page.get_by_role('button',name='Save hotel',exact=True).click()
    assert await page.evaluate('window.__browse.requested')
    intent=await page.evaluate('JSON.parse(sessionStorage.getItem("wh_public_property_intent_v1")).property')
    assert intent=={'kind':'hotel','id':'7'}
    await page.evaluate('window.__switchBrowseMode("hotel")')
    await expect(page.get_by_role('button',name='Breakfast stay',exact=False)).to_have_attribute('aria-pressed','true')
    assert await page.locator('[data-room-choice="9"] > button').get_attribute('aria-expanded')=='true'
    assert not await page.evaluate('Boolean(window.__browse.booking)')
    await page.get_by_role('button',name='Back to hotels',exact=True).click()
    await expect(page.get_by_placeholder('Search hotel name or location')).to_have_value('Keffi Garden')
    await page.evaluate('window.__switchBrowseMode("thumbnail")')
    # Explicit load failures never produce an empty tile or endless skeleton.
    await page.locator('img').evaluate_all('(nodes)=>nodes.forEach(node=>node.dispatchEvent(new Event("error")))')
    await page.locator('video').evaluate_all('(nodes)=>nodes.forEach(node=>node.dispatchEvent(new Event("error")))')
    # An unsigned URL is still loading; a decoded failure is unavailable.
    await expect(page.get_by_text('Photo unavailable',exact=True)).to_have_count(1)
    await expect(page.locator('[data-media-thumbnail]').first).to_have_attribute('data-media-state','loading')
    await expect(page.get_by_text('Open video',exact=True)).to_be_visible()
    await expect(page.locator('[data-media-thumbnail] video')).to_have_count(0)
    assert not any(url.endswith('.mp4') for url in media_requests),'Browsing thumbnails downloaded a video'
    # A followed radius remains bound to its origin when returning from detail.
    await page.evaluate("sessionStorage.setItem('wehouse:open-followed-search',JSON.stringify({kind:'hotels',criteria:{query:'Keffi Garden',latitude:8.8,longitude:7.8,radius_km:5}}));window.__switchBrowseMode('hotels')")
    await expect(page.get_by_placeholder('Search hotel name or location')).to_have_value('Keffi Garden')
    await page.wait_for_function("window.__browse.calls.filter(c=>c.name==='getHotels').at(-1)?.args[0]?.latitude===8.8")
    await page.evaluate("window.__switchBrowseMode('thumbnail')")
    await expect(page.get_by_text('Open video',exact=True)).to_be_visible()
    await page.evaluate("window.__switchBrowseMode('hotels')")
    await expect(page.get_by_role('button',name='Using followed search location',exact=True)).to_be_visible()
    await page.get_by_role('button',name='Open filters',exact=True).click()
    await expect(page.get_by_text('Distance from followed search location',exact=True)).to_be_visible()
    await page.get_by_role('button',name='Close filters',exact=True).click()
    # Another identity starts with its own query, radius and saved-search origin.
    await page.evaluate("window.__switchBrowseMode('thumbnail')")
    await expect(page.get_by_text('Open video',exact=True)).to_be_visible()
    await page.evaluate("window.__browse.sessionKey='another-account';window.__switchBrowseMode('hotels')")
    await expect(page.get_by_placeholder('Search hotel name or location')).to_have_value('')
    await expect(page.get_by_role('button',name='Use my location',exact=True)).to_be_visible()
    await page.wait_for_function("(()=>{const f=window.__browse.calls.filter(c=>c.name==='getHotels').at(-1)?.args[0];return f?.search===''&&f?.radiusKm===undefined&&f?.latitude===undefined})()")
    await page.screenshot(path=str(OUT/f'thumbnail-unavailable-states-{width}-{theme}.png'))
    assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
    assert not await page.evaluate('window.__browse.unexpected'),await page.evaluate('window.__browse.unexpected')
    assert await page.evaluate('window.__browse.gatewayRequests.length>0'),'Deployed web must exercise the public gateway'
    assert not errors,errors
    row['passed']=True;row['checks']=['same Explore renderer','guest personal requests denied','same room and offers','selection survives sign-in','no guest save or booking write','Back retains search','searchable State/LGA and stale locality clearing','compact missing gallery','explicit failed thumbnails']
   except Exception as e:
    row['error']=str(e);row['page_errors']=errors;row['unexpected']=await page.evaluate('window.__browse?.unexpected');await page.screenshot(path=str(OUT/f'shared-discovery-FAIL-{width}-{theme}.png'),full_page=True,timeout=15000)
   finally:results.append(row);print(json.dumps(row),flush=True);await context.close()
  await browser.close()
 (OUT/'shared-discovery-results.json').write_text(json.dumps(results,indent=2));assert all(row['passed'] for row in results)
if __name__=='__main__':asyncio.run(main())
