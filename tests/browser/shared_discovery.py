"""Same production components for guests and signed-in customers, isolated APIs.
No live account, database, provider, payment or published data is changed.
"""
import asyncio,json,os,subprocess
from pathlib import Path
from playwright.async_api import async_playwright,expect
OUT=Path('test-results/experience');B=Path('test-results/shared-discovery-offline')
HOME={'id':'public-home','title':'Courtyard apartment','sub_type':'long_stay','property_type':'apartment','availability_status':'available','city':'Lafia','state':'Nasarawa','address':'Test road','status':'available','price':400000,'images':['https://assets.wehouse.test/interior.jpg'],'amenities':[],'description':'Sample home','bedrooms':2,'bathrooms':1}
RATES=[{'rate_plan_id':10,'room_id':9,'active':True,'name':'Room only','meal_plan':'room_only','payment_timing':'pay_now','refundable':False,'cancellation_hours':None,'price_per_night':30000,'included_features':[]},{'rate_plan_id':11,'room_id':9,'active':True,'name':'Breakfast stay','meal_plan':'breakfast','payment_timing':'pay_now','refundable':True,'cancellation_hours':48,'price_per_night':35000,'included_features':['Lounge access']}]
HOTEL={'hotel_id':7,'name':'Garden Lodge','city':'Keffi','state':'Nasarawa','address':'Hotel test road','status':'active','images':[],'amenities':[],'hotel_rooms':[{'room_id':9,'room_type':'Standard','price_per_night':30000,'images':[],'max_guests':2,'bed_type':'Double bed','rate_plans':RATES}],'description':'Sample hotel.'}
SCRIPT="""s=>{
 window.__browse=s;
 for(const name of ['sessionStorage','localStorage']){const data=new Map();Object.defineProperty(window,name,{value:{getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,String(value)),removeItem:key=>data.delete(key),clear:()=>data.clear()}})}
 window.__browseAPI=async(name,args)=>{
  const s=window.__browse;s.calls.push({name,args});
  if(name==='getHotels')return{hotels:[s.hotel],error:null};
  if(name==='getHotelById')return{hotel:s.hotel,error:null};
  if(name==='getListing')return{listing:s.home,error:null};
  if(name==='getHotelReviews')return{reviews:[],eligible:false,error:null};
  if(name==='getReservationForListing')return{reservation:null,error:null};
  if(name==='rpc:get_discoverable_listings')return{data:[s.home],error:null};
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
  for width in [320,390,768,1440]:
   context=await browser.new_context(viewport={'width':width,'height':844},service_workers='block');page=await context.new_page();page.set_default_timeout(4000);errors=[];page.on('pageerror',lambda e:errors.append(str(e)));row={'width':width,'passed':False}
   async def route(request):
    if request.request.url=='https://assets.wehouse.test/interior.jpg':return await request.fulfill(status=200,content_type='image/jpeg',body=Path('public/hero-interior.jpg').read_bytes())
    return await request.abort()
   await page.route('**/*',route)
   try:
    await page.set_content('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#090B10"><div id="root"></div></body></html>')
    await page.evaluate(SCRIPT,{'mode':'public','calls':[],'unexpected':[],'home':HOME,'hotel':HOTEL})
    await page.add_style_tag(path=str(B/'fixture.css'));await page.add_script_tag(path=str(B/'fixture.js'))
    await expect(page.get_by_role('heading',name='Find what you need',exact=True)).to_be_visible()
    await expect(page.get_by_role('navigation',name='Main navigation').get_by_role('button',name='Sign in',exact=True)).to_be_visible()
    await expect(page.get_by_placeholder('City, area or apartment')).to_be_visible()
    assert not any(('get_my_' in c['name'] or c['name'].startswith('table:')) for c in await page.evaluate('window.__browse.calls'))
    await page.wait_for_function('Array.from(document.querySelectorAll("[data-media-thumbnail] img")).some(img=>img.complete&&img.naturalWidth>0)')
    await page.screenshot(path=str(OUT/f'shared-explore-guest-{width}.png'),full_page=True)
    await page.evaluate('window.__switchBrowseMode("homes")')
    await expect(page.get_by_role('button',name='Sign in',exact=True)).to_have_count(0)
    await expect(page.get_by_role('heading',name='Find what you need',exact=True)).to_be_visible()
    await expect(page.get_by_placeholder('City, area or apartment')).to_be_visible()
    await page.screenshot(path=str(OUT/f'shared-explore-signed-in-{width}.png'),full_page=True)
    await page.evaluate('window.__switchBrowseMode("public");window.__browse.calls=[]')
    await page.get_by_role('button',name='Hotels',exact=True).click()
    await page.get_by_placeholder('Search hotel name').fill('Garden')
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
    await page.locator('[data-room-choice="9"]').screenshot(path=str(OUT/f'hotel-room-and-offers-{width}.png'))
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
    await expect(page.get_by_placeholder('Search hotel name')).to_have_value('Garden')
    await page.evaluate('window.__switchBrowseMode("thumbnail")')
    # Explicit load failures never produce an empty tile or endless skeleton.
    await page.locator('img').evaluate_all('(nodes)=>nodes.forEach(node=>node.dispatchEvent(new Event("error")))')
    await page.locator('video').evaluate_all('(nodes)=>nodes.forEach(node=>node.dispatchEvent(new Event("error")))')
    await expect(page.get_by_text('Photo unavailable',exact=True)).to_have_count(2)
    await expect(page.get_by_text('Preview unavailable · open video',exact=True)).to_be_visible()
    await page.screenshot(path=str(OUT/f'thumbnail-unavailable-states-{width}.png'))
    assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
    assert not await page.evaluate('window.__browse.unexpected'),await page.evaluate('window.__browse.unexpected')
    assert not errors,errors
    row['passed']=True;row['checks']=['same Explore renderer','guest personal requests denied','same room and offers','selection survives sign-in','no guest save or booking write','Back retains search','compact missing gallery','explicit failed thumbnails']
   except Exception as e:
    row['error']=str(e);row['page_errors']=errors;row['unexpected']=await page.evaluate('window.__browse?.unexpected');await page.screenshot(path=str(OUT/f'shared-discovery-FAIL-{width}.png'),full_page=True)
   finally:results.append(row);print(json.dumps(row),flush=True);await context.close()
  await browser.close()
 (OUT/'shared-discovery-results.json').write_text(json.dumps(results,indent=2));assert all(row['passed'] for row in results)
if __name__=='__main__':asyncio.run(main())
