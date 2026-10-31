"""Same production components for guests and signed-in customers, isolated APIs.
No live account, database, provider, payment or published data is changed.
"""
import asyncio,json,os,subprocess
from urllib.parse import urlparse,parse_qs
from pathlib import Path
from playwright.async_api import async_playwright,expect
from discovery_requests import settled_search,install_read_counter
OUT=Path('test-results/experience');B=Path('test-results/shared-discovery-offline')
HOME={'id':'public-home','title':'Courtyard apartment','sub_type':'long_stay','property_type':'apartment','availability_status':'available','city':'Lafia','state':'Nasarawa','address':'Test road','status':'available','price':18000000,'images':['https://assets.wehouse.test/interior.jpg'],'amenities':[],'description':'Sample home','bedrooms':2,'bathrooms':1}
RATES=[{'rate_plan_id':10,'room_id':9,'active':True,'name':'Room only','meal_plan':'room_only','payment_timing':'pay_now','refundable':False,'cancellation_hours':None,'price_per_night':30000,'included_features':[]},{'rate_plan_id':11,'room_id':9,'active':True,'name':'Breakfast stay','meal_plan':'breakfast','payment_timing':'pay_now','refundable':True,'cancellation_hours':48,'price_per_night':35000,'included_features':['Lounge access']}]
HOTEL={'hotel_id':7,'name':'Garden Lodge','city':'Keffi','state':'Nasarawa','address':'Hotel test road','status':'active','images':[],'amenities':[],'hotel_rooms':[{'room_id':9,'room_type':'Standard','price_per_night':30000,'images':[],'max_guests':2,'bed_type':'Double bed','rate_plans':RATES}],'description':'Sample hotel.'}
SCRIPT="""s=>{
 window.__browse=s;
 window.__browse.gatewayRequests=[];
 window.addEventListener('openSupportChat',event=>{window.__browse.dataRequest=event.detail;});
 for(const name of ['sessionStorage','localStorage']){const data=new Map();Object.defineProperty(window,name,{value:{getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,String(value)),removeItem:key=>data.delete(key),clear:()=>data.clear()}})}
 window.__browseAPI=async(name,args)=>{
  const s=window.__browse;s.calls.push({name,args});
  if(name==='getHotels'){
   const count=s.hotelCount||1,cursor=args[1];
   const hotel=n=>({...s.hotel,hotel_id:6+n,name:n===1?s.hotel.name:s.hotel.name+' '+n,images:n>1&&n%2===0?['https://assets.wehouse.test/interior.jpg']:[]});
   const hotels=cursor?[hotel(count),hotel(count+1),hotel(count+2)]:Array.from({length:count},(_,i)=>hotel(i+1));
   const more=count>6&&!cursor&&!args[0]?.search;
   return{hotels,error:null,hasMore:more,nextCursor:more?{featured:false,createdAt:'2026-10-30T00:00:00Z',id:count+6}:null};
  }
  if(name==='getHotelById')return{hotel:s.hotel,error:null};
  if(name==='getListing')return{listing:s.home,error:null};
  if(name==='getProfile')return{profile:{...s.profile,user_id:args[0],profile_complete:true,worker_occupation:'Carpenter',worker_skills:['Carpentry'],worker_price:1000,worker_bio:'Existing work biography',worker_experience:'4 years',worker_verified:true},error:null};
  if(name==='getProfileCountryOptions')return{countries:s.failCountryList?[]:[{country_code:'NG',name:'Nigeria'},{country_code:'GH',name:'Ghana'}],error:s.failCountryList?{message:'Synthetic country list unavailable'}:null};
  if(name==='getMyWorkerServiceCoverage')return{coverage:s.failWorkLoad?null:{country_code:'NG',country:'Nigeria',state:'Nasarawa',city:'Lafia',area:'Work service area'},error:s.failWorkLoad?{message:'Synthetic saved work location unavailable'}:null};
  if(name==='getServiceCategories')return{categories:[{id:'category-1',name:'Repairs'}],error:null};
  if(name==='getServiceSubcategories')return{subcategories:[{name:'Carpentry'}],error:null};
  if(name==='table:worker_services')return{data:[{service_name:'Carpentry',price:1000}],error:null};
  if(name==='saveMyWorkerProfile'){s.workSave=args;return{profile:s.badWorkReceipt?null:{...s.profile,user_id:'qa-viewer',worker_verified:!s.workNeedsReview},error:s.failWorkSave?{message:'Synthetic work save failed'}:null};}
  if(name==='updateProfile'){s.profileUpdates=args[1];s.profile={user_id:args[0],...s.profile,...args[1]};return{profile:s.profile,error:null};}
  if(name==='getHotelReviews')return{reviews:[],eligible:false,error:null};
  if(name==='updatePrivacySettings'){s.privacy={...(s.privacy||{}),...args[1]};return{profile:{user_id:args[0],...s.privacy},error:null};}
  if(name==='rpc:get_my_private_call_preferences')return{data:{allow_audio_calls:true,allow_video_calls:true},error:null};
  if(name==='getReservationForListing')return{reservation:null,error:null};
  if(name==='rpc:search_discoverable_homes'){
   const q=args[0]||{},count=s.homeCount||1;
   let homes=[s.home,...Array.from({length:count-1},(_,index)=>{const n=index+2;return{...s.home,id:'public-home-'+n,title:'Courtyard apartment '+n,sub_type:n%2===0?'short_let':'long_stay',price:n%2===0?50000:s.home.price};})];
   if(q.p_cursor_id)homes=[homes.at(-1),...Array.from({length:2},(_,i)=>({...s.home,id:'public-home-'+(count+i+1),title:'Courtyard apartment '+(count+i+1)}))];
   if(q.p_stay_type)homes=homes.filter(home=>home.sub_type===q.p_stay_type);
   return{data:{items:homes,has_more:false,next_cursor_created_at:null,next_cursor_id:null},error:null};
  }
  if(name==='rpc:get_sponsored_discovery')return{data:[],error:null};
  if(name==='rpc:get_public_discovery_settings')return{data:[],error:null};
  if(name==='rpc:get_my_page_distances')return{data:[{subject_type:'hotel',subject_id:'7',distance_km:2}],error:null};
  if(name==='rpc:get_my_workspace_access')return{data:{identity:{user_id:'qa-viewer'},personal_workspace:true,privileged_workspaces:[]},error:null};
  if(['rpc:get_all_settings_v2','rpc:get_my_saved_searches','rpc:get_my_saved_hotels','rpc:get_my_saved_hotel_ids','rpc:get_my_shared_housing_groups','table:saved_searches','table:saved_hotels'].includes(name))return{data:[],error:null};
  s.unexpected.push({name,args});throw new Error('Unexpected browse API '+name);
 };
}"""
async def main():
 subprocess.run(['node','tests/browser/build-shared-discovery.mjs'],check=True,timeout=120);OUT.mkdir(parents=True,exist_ok=True);results=[]
 async with async_playwright() as p:
  options={'headless':True,'args':['--no-sandbox']}
  if os.getenv('CHROMIUM_PATH'):options['executable_path']=os.environ['CHROMIUM_PATH']
  browser=await p.chromium.launch(**options)
  for width,theme in [(w,t) for w in [320,390,768,1440] for t in ['dark','light']]:
   context=await browser.new_context(viewport={'width':width,'height':844},service_workers='block');page=await context.new_page();page.set_default_timeout(4000);errors=[];page.on('pageerror',lambda e:errors.append(str(e)));row={'width':width,'theme':theme,'passed':False}
   async def route(request):
    if request.request.url=='https://wehouse-preview.vercel.app/':
     return await request.fulfill(status=200,content_type='text/html',body=f'<html class="{"dark" if theme=="dark" else ""}" data-wh-theme="{theme}"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:var(--wh-bg)"><div id="root"></div></body></html>')
    if request.request.url.startswith('https://wehouse-preview.vercel.app/api/public-catalog?'):
     assert request.request.method=='GET'
     assert not request.request.headers.get('authorization') and not request.request.headers.get('cookie')
     kind=parse_qs(urlparse(request.request.url).query)['kind'][0]
     assert kind in ['homes','hotels']
     params={key:values[0] for key,values in parse_qs(urlparse(request.request.url).query).items()}
     await page.evaluate('(params)=>window.__browse.gatewayRequests.push(params)',params)
     count=await page.evaluate('window.__browse.homeCount||1') if kind=='homes' else 1
     homes=[HOME]+[{**HOME,'id':f'public-home-{n}','title':f'Courtyard apartment {n}','sub_type':'short_let' if n%2==0 else 'long_stay','price':50000 if n%2==0 else HOME['price']} for n in range(2,count+1)]
     paged=kind=='homes' and count>6 and not params.get('p_stay_type') and not params.get('p_query') and not params.get('p_min_price') and not params.get('p_max_price')
     if params.get('p_cursor_id'):
      homes=[homes[-1]]+[{**HOME,'id':f'public-home-{n}','title':f'Courtyard apartment {n}'} for n in range(count+1,count+3)]
     elif params.get('p_stay_type'):
      homes=[home for home in homes if home['sub_type']==params['p_stay_type']]
     more=paged and not params.get('p_cursor_id')
     return await request.fulfill(status=200,content_type='application/json',body=json.dumps({'items':homes if kind=='homes' else [HOTEL],'has_more':more,'next_cursor_created_at':'2026-10-30T00:00:00Z' if more else None,'next_cursor_id':homes[-1]['id'] if more else None}))
    if request.request.url.startswith('https://wehouse-preview.vercel.app/brand/v4/'):
     name=urlparse(request.request.url).path.rsplit('/',1)[-1]
     return await request.fulfill(status=200,content_type='image/svg+xml',body=Path('public/brand/v4',name).read_bytes())
    if request.request.url=='https://assets.wehouse.test/interior.jpg':return await request.fulfill(status=200,content_type='image/jpeg',body=Path('public/hero-interior.jpg').read_bytes())
    return await request.abort()
   await install_read_counter(page)
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
    await expect(page.get_by_role('navigation',name='Discover categories')).to_be_visible()
    await expect(page.get_by_role('button',name='Privacy Policy',exact=True)).to_have_count(0)
    await expect(page.get_by_role('button',name='Terms of Service',exact=True)).to_have_count(0)
    assert await page.locator('[data-guest-access="services"]').evaluate('(node)=>getComputedStyle(node.firstElementChild).borderTopWidth==="0px"&&getComputedStyle(node.firstElementChild).boxShadow==="none"')
    await page.screenshot(path=str(OUT/f'guest-services-{width}-{theme}.png'),full_page=True)
    await expect(page.get_by_role('listitem')).to_have_count(0)
    await page.get_by_role('button',name='Sign in to continue',exact=True).click()
    assert await page.evaluate("sessionStorage.getItem('wh_guest_return_tab_v1')")=='services'
    await page.get_by_role('button',name='Hotels',exact=True).click()
    await expect(page.get_by_placeholder('Search hotel name or location')).to_be_visible()
    await expect(page.get_by_role('heading',name='Sign in to find a professional',exact=True)).to_have_count(0)
    await page.get_by_role('button',name='Homes',exact=True).click()
    await expect(page.get_by_placeholder('City, area or home')).to_be_visible()
    await page.get_by_role('button',name='Roommates',exact=True).click()
    await expect(page.get_by_role('heading',name='Sign in to find a roommate',exact=True)).to_be_visible()
    await expect(page.get_by_role('navigation',name='Discover categories')).to_be_visible()
    await page.screenshot(path=str(OUT/f'guest-roommates-{width}-{theme}.png'),full_page=True)
    await expect(page.get_by_role('listitem')).to_have_count(0)
    await page.get_by_role('button',name='Sign in to continue',exact=True).click()
    assert await page.evaluate("sessionStorage.getItem('wh_guest_return_tab_v1')")=='roommate'
    await page.get_by_role('button',name='Homes',exact=True).click()
    await expect(page.get_by_placeholder('City, area or home')).to_be_visible()
    for section,title in [('Bookings','Sign in to view your bookings'),('Inbox','Sign in to open your inbox')]:
     await page.get_by_role('navigation',name='Main navigation').get_by_role('button',name=section,exact=True).click()
     await expect(page.get_by_role('heading',name=title,exact=True)).to_be_visible()
     await expect(page.get_by_role('button',name='Privacy Policy',exact=True)).to_have_count(0)
     assert await page.locator('[data-guest-access]').evaluate('(node)=>getComputedStyle(node.firstElementChild).borderTopWidth==="0px"&&getComputedStyle(node.firstElementChild).boxShadow==="none"')
    await page.get_by_role('navigation',name='Main navigation').get_by_role('button',name='Explore',exact=True).click()
    assert not any(('get_my_' in c['name'] or c['name'].startswith('table:')) for c in await page.evaluate('window.__browse.calls'))
    await page.wait_for_function('Array.from(document.querySelectorAll("[data-media-thumbnail] img")).some(img=>img.complete&&img.naturalWidth>0)')
    await page.screenshot(path=str(OUT/f'shared-explore-guest-{width}-{theme}.png'),full_page=True,timeout=15000)
    await page.evaluate('window.__browse.homeCount=8;window.__switchBrowseMode("homes")')
    await expect(page.locator('[data-home-card]')).to_have_count(8)
    assert await page.locator('[data-home-card]').first.get_by_role('button',name='View Courtyard apartment',exact=True).is_visible()
    await expect(page.get_by_role('button',name='Sign in',exact=True)).to_have_count(0)
    await expect(page.get_by_role('heading',name='Find what you need',exact=True)).to_be_visible()
    await expect(page.get_by_placeholder('City, area or home')).to_be_visible()
    await expect(page.locator('[data-home-card]').first).to_contain_text('₦18,000,000')
    shelf=page.get_by_role('group',name='Homes to explore listings',exact=True)
    await expect(shelf).to_be_visible()
    await expect(shelf.locator('[data-home-card]')).to_have_count(8)
    await expect(shelf.get_by_text('Short Let',exact=True)).to_have_count(4)
    await expect(shelf.get_by_text('Long Let',exact=True)).to_have_count(4)
    grid=page.get_by_role('group',name='Homes to explore, row 2 listings',exact=True)
    await expect(grid).to_have_count(0)
    requests=await page.evaluate('window.__browse.gatewayRequests.length')
    next_homes=page.get_by_role('button',name='Scroll Homes to explore forward',exact=True)
    if width>=640:
     await expect(next_homes).to_be_enabled();await next_homes.click()
    else:
     await expect(next_homes).not_to_be_visible()
     await shelf.focus();await page.keyboard.press('ArrowRight')
    await page.wait_for_function('document.querySelector(\'[aria-label="Homes to explore listings"]\').scrollLeft>0')
    await shelf.focus();await page.keyboard.press('ArrowLeft')
    assert await page.evaluate('window.__browse.gatewayRequests.length')==requests,'Rail browsing fetched the catalog again'
    await page.get_by_role('button',name='Show more homes',exact=True).click()
    await expect(page.locator('[data-home-card]')).to_have_count(10)
    await expect(shelf.locator('[data-home-card]')).to_have_count(8)
    await expect(grid.locator('[data-home-card]')).to_have_count(2)
    await expect(page.get_by_role('heading',name='More homes',exact=True)).to_have_count(0)
    assert 'sr-only' in (await page.get_by_role('heading',name='Homes to explore, row 2',exact=True).get_attribute('class'))
    titles=await page.locator('[data-home-card] h3').all_text_contents()
    assert len(titles)==len(set(titles)),titles
    await grid.locator('[data-home-card]').first.get_by_role('button',name='Save home',exact=True).click()
    assert await page.evaluate('window.__browse.savedId')=='public-home-9'
    await grid.get_by_role('button',name='View Courtyard apartment 9',exact=True).click()
    assert await page.evaluate('window.__browse.destination')=={'page':'detail','id':'public-home-9'}
    assert not await page.evaluate('document.documentElement.scrollWidth>innerWidth')
    await page.evaluate('window.scrollTo(0,0)')
    await page.screenshot(path=str(OUT/f'homes-rail-grid-{width}-{theme}.png'),full_page=True)
    await page.get_by_role('group',name='Stay type',exact=True).get_by_role('button',name='Long Lets',exact=True).click()
    await expect(shelf).to_have_count(0);await expect(page.locator('[data-home-card]')).to_have_count(4)
    await page.wait_for_function('window.__browse.gatewayRequests.some(q=>q.kind==="homes"&&q.p_stay_type==="long_stay")')
    await page.get_by_role('button',name='Clear',exact=True).click();await expect(shelf).to_be_visible()
    await page.get_by_role('button',name='Open filters',exact=True).click()
    await page.get_by_role('dialog',name='Home filters',exact=True).get_by_role('button',name='Long Let',exact=True).click()
    assert float(await page.get_by_role('slider',name='Maximum price',exact=True).get_attribute('aria-valuemax'))>=18000000
    await expect(page.get_by_placeholder('No maximum',exact=True)).to_be_visible()
    await settled_search(page,page.locator('input[inputmode="numeric"]').first,['190000','200000','210000'],"(window.__discoveryReads.public_homes||0)")
    maximum=page.get_by_label('Maximum price amount',exact=True)
    await maximum.fill('25000000');await maximum.press('Tab')
    await expect(maximum).to_have_value('25000000')
    await page.wait_for_function("window.__browse.gatewayRequests.at(-1)?.p_max_price==='25000000'")
    await maximum.fill('');await maximum.press('Tab')
    await expect(maximum).to_have_value('')
    await page.wait_for_function("window.__browse.gatewayRequests.at(-1)?.p_min_price==='210000'&&!Object.hasOwn(window.__browse.gatewayRequests.at(-1),'p_max_price')")
    await page.screenshot(path=str(OUT/f'open-price-filter-{width}-{theme}.png'),full_page=True)
    await page.get_by_role('button',name='Reset',exact=True).click();await page.get_by_role('button',name='Close filters',exact=True).click()
    await expect(shelf).to_be_visible()
    await settled_search(page,page.get_by_placeholder('City, area or home'),['C','Courtyard','Courtyard apartment'],"window.__browse.calls.filter(c=>c.name==='rpc:search_discoverable_homes').length")
    await page.get_by_role('button',name='Clear',exact=True).click();await expect(shelf).to_be_visible()
    await page.screenshot(path=str(OUT/f'homes-rail-{width}-{theme}.png'),full_page=True)
    await page.evaluate('window.__switchBrowseMode("locations")')
    await expect(page.get_by_role('heading',name='Location',exact=True)).to_be_visible()
    await expect(page.get_by_role('button',name='Local area (LGA) Any local area',exact=True)).to_be_disabled()
    await page.get_by_role('button',name='State Any state',exact=True).click()
    await page.get_by_placeholder('Search states').fill('nasar')
    await page.get_by_role('option',name='Nasarawa',exact=True).click()
    await page.get_by_role('button',name='Local area (LGA) Any local area',exact=True).click()
    await page.get_by_placeholder('Search local areas').fill('laf')
    await page.get_by_role('option',name='Lafia',exact=True).click()
    await expect(page.get_by_label('Chosen local area')).to_have_text('Lafia')
    await page.get_by_role('button',name='State Nasarawa',exact=True).click()
    await page.get_by_placeholder('Search states').fill('lagos')
    await page.get_by_role('option',name='Lagos',exact=True).click()
    await expect(page.get_by_label('Chosen local area')).to_have_text('')
    # Existing profiles keep their own country when display defaults differ.
    await page.evaluate("window.__browse.profile={username:'viewer',full_name:'Synthetic member',country:'Ghana',state:'Greater Accra',city:'Accra',local_government:'Accra',gender:'female',is_student:true,school:'Existing overseas institution',precise_address:'Old test street',precise_latitude:5.6,precise_longitude:-0.1};window.__switchBrowseMode('profile-edit')")
    await page.get_by_role('button',name='Edit profile',exact=True).click()
    await expect(page.get_by_text('Country · Ghana',exact=True)).to_be_visible()
    await expect(page.get_by_role('textbox',name='State / region',exact=True)).to_have_value('Greater Accra')
    await expect(page.get_by_role('textbox',name='Institution',exact=True)).to_have_value('Existing overseas institution')
    await page.get_by_role('textbox',name='State / region',exact=True).fill('Ashanti')
    await expect(page.get_by_role('textbox',name='City / area',exact=True)).to_have_value('')
    await page.get_by_role('textbox',name='City / area',exact=True).fill('Kumasi')
    await page.get_by_role('button',name='Save changes',exact=True).click()
    await expect(page.get_by_role('button',name='Edit profile',exact=True)).to_be_visible()
    updates=await page.evaluate('window.__browse.profileUpdates')
    assert updates['state']=='Ashanti' and updates['city']=='Kumasi' and updates['precise_address'] is None
    assert await page.evaluate('window.__browse.updatedProfile.country')=='Ghana'
    assert updates['school']=='Existing overseas institution'
    await page.evaluate("window.__switchBrowseMode('profile-other-default')")
    await page.get_by_role('button',name='Edit profile',exact=True).click()
    await page.get_by_role('button',name='State / region Nasarawa',exact=True).click()
    await expect(page.get_by_role('option',name='Nasarawa',exact=False)).to_have_attribute('aria-selected','true')
    await page.keyboard.press('Escape')
    await page.evaluate("window.__browse.profile={username:'viewer',full_name:'Synthetic member',country:null,state:'Nasarawa',city:'Lafia',local_government:'Lafia',gender:null,is_student:false};window.__browse.failCountryList=true;window.__switchBrowseMode('profile-edit')")
    await page.get_by_role('button',name='Edit profile',exact=True).click()
    await expect(page.get_by_text('Country · Not set',exact=True)).to_be_visible()
    await expect(page.get_by_text('Synthetic country list unavailable',exact=True)).to_be_visible()
    await expect(page.get_by_role('button',name='Country Choose country',exact=True)).to_be_disabled()
    await expect(page.get_by_text('Choose your country to edit this location.',exact=False)).to_be_visible()
    await page.evaluate('window.__browse.failCountryList=false')
    await page.get_by_role('button',name='Retry countries',exact=True).click()
    await page.get_by_role('button',name='Country Choose country',exact=True).click()
    await page.get_by_role('option',name='Nigeria',exact=True).click()
    await expect(page.get_by_role('button',name='State / region Nasarawa',exact=True)).to_be_visible()
    await page.get_by_role('button',name='Save changes',exact=True).click()
    await expect(page.get_by_role('button',name='Edit profile',exact=True)).to_be_visible()
    assert await page.evaluate('window.__browse.profileUpdates.country')=='Nigeria'
    assert await page.evaluate('window.__browse.profileUpdates.city')=='Lafia'
    await page.evaluate("window.__switchBrowseMode('homes')")
    await expect(page.get_by_placeholder('City, area or home')).to_be_visible()
    await page.evaluate("window.__switchBrowseMode('profile-edit')")
    await page.get_by_role('button',name='Edit profile',exact=True).click()
    await page.get_by_role('button',name='Country Nigeria',exact=True).click()
    await page.get_by_role('option',name='Ghana',exact=True).click()
    await expect(page.get_by_role('textbox',name='State / region',exact=True)).to_have_value('')
    await expect(page.get_by_role('textbox',name='City / area',exact=True)).to_have_value('')
    await page.evaluate("window.__switchBrowseMode('profile-location')")
    await expect(page.get_by_role('textbox',name='State / region *',exact=True)).to_have_value('Greater Accra')
    await page.get_by_role('textbox',name='State / region *',exact=True).fill('Ashanti')
    await expect(page.get_by_role('textbox',name='City *',exact=True)).to_have_value('')
    await page.evaluate("window.__browse.calls=[];window.__browse.failWorkLoad=true;window.__switchBrowseMode('worker-setup')")
    await expect(page.get_by_text('Synthetic saved work location unavailable',exact=True)).to_be_visible()
    await expect(page.get_by_role('textbox',name='Full name',exact=True)).to_be_disabled()
    await expect(page.get_by_role('button',name='Back',exact=True)).to_be_enabled()
    await page.evaluate('window.__browse.failWorkLoad=false')
    await page.get_by_role('button',name='Refresh work profile',exact=True).click()
    await expect(page.get_by_role('status').filter(has_text='Loading your work profile')).to_have_count(0)
    await expect(page.get_by_role('button',name='State * Nasarawa',exact=True)).to_be_visible()
    await expect(page.get_by_role('textbox',name='Full name',exact=True)).to_have_value('Synthetic member')
    await page.get_by_role('button',name='Back',exact=True).click()
    await expect(page.get_by_placeholder('City, area or home')).to_be_visible()
    assert not any(c['name'].startswith(('activate_','saveMyWorker','updateProfile')) for c in await page.evaluate('window.__browse.calls'))
    await page.evaluate("window.__browse.failWorkSave=true;window.__switchBrowseMode('worker-setup')")
    await expect(page.get_by_role('button',name='State * Nasarawa',exact=True)).to_be_visible()
    await page.get_by_role('textbox',name='Full name',exact=True).fill('Edited work name')
    await page.get_by_role('button',name='Save changes',exact=True).click()
    await expect(page.get_by_text('Synthetic work save failed',exact=True)).to_be_visible()
    assert not await page.evaluate('Boolean(window.__browse.workerComplete)')
    await page.evaluate('window.__browse.failWorkSave=false;window.__browse.badWorkReceipt=true')
    await page.get_by_role('button',name='Save changes',exact=True).click()
    await expect(page.get_by_text('The saved profile could not be confirmed. Refresh your work profile before retrying.',exact=True)).to_be_visible()
    assert not await page.evaluate('Boolean(window.__browse.workerComplete)')
    await page.evaluate('window.__browse.badWorkReceipt=false')
    await page.get_by_role('button',name='Save changes',exact=True).click()
    await page.wait_for_function('window.__browse.workerComplete===true')
    work=await page.evaluate('window.__browse.workSave')
    assert work[1]['country']=='Nigeria' and work[1]['state']=='Nasarawa' and work[1]['city']=='Lafia'
    assert not any(c['name']=='rpc:set_my_worker_services' for c in await page.evaluate('window.__browse.calls'))
    await page.evaluate("window.__browse.workerComplete=false;window.__browse.workNeedsReview=true;window.__switchBrowseMode('homes');window.__switchBrowseMode('worker-setup')")
    await expect(page.get_by_role('button',name='State * Nasarawa',exact=True)).to_be_visible()
    await page.get_by_role('textbox',name='Full name',exact=True).fill('Changed service professional')
    await page.get_by_role('button',name='Save changes',exact=True).click()
    await page.wait_for_function('window.__browse.workerReview===true')
    assert not await page.evaluate('Boolean(window.__browse.workerComplete)')
    await page.evaluate('window.__switchBrowseMode("privacy")')
    await page.get_by_role('button',name='Privacy & calls',exact=False).click()
    online=page.get_by_role('switch',name='Online and last seen',exact=True)
    await expect(online).to_be_checked();await online.click();await expect(online).not_to_be_checked()
    assert await page.evaluate('window.__browse.privacy.privacy_activity_visible===false')
    await page.get_by_role('button',name='Back',exact=True).click()
    await page.get_by_role('button',name='Request data deletion',exact=False).click()
    request=await page.evaluate('window.__browse.dataRequest')
    assert request['category']=='account_access' and request['contextType']=='contextual_help' and request['contextSnapshot']=={'reason_code':'personal_data_deletion','subject_type':'account','source_id':'qa-viewer'}
    await expect(page.get_by_text('Send your message to submit a request.',exact=False)).to_be_visible()
    await page.evaluate('window.__switchBrowseMode("homes")')
    await expect(page.locator('[data-home-card] [data-media-thumbnail]').first).to_have_attribute('data-media-state','ready')
    await page.screenshot(path=str(OUT/f'shared-explore-signed-in-{width}-{theme}.png'),full_page=True,timeout=15000)
    await page.evaluate('window.__browse.hotelCount=8;window.__switchBrowseMode("public");window.__browse.calls=[]')
    await page.get_by_role('button',name='Hotels',exact=True).click()
    hotels_shelf=page.get_by_role('group',name='Hotels to explore listings',exact=True)
    await expect(hotels_shelf.locator('[data-hotel-card]')).to_have_count(8)
    hotels_grid=page.get_by_role('group',name='Hotels to explore, row 2 listings',exact=True)
    await expect(hotels_grid).to_have_count(0)
    first_hotel=hotels_shelf.locator('[data-hotel-card]').first
    await expect(first_hotel.get_by_text('Photos not available',exact=True)).to_be_visible()
    await expect(first_hotel.locator('[data-media-state="loading"]')).to_have_count(0)
    hotel_reads=await page.evaluate('window.__browse.calls.filter(c=>c.name==="getHotels").length')
    next_hotels=page.get_by_role('button',name='Scroll Hotels to explore forward',exact=True)
    if width>=640:
     await next_hotels.click()
    else:
     await expect(next_hotels).not_to_be_visible()
     await hotels_shelf.focus();await page.keyboard.press('ArrowRight')
    await page.wait_for_function('document.querySelector(\'[aria-label="Hotels to explore listings"]\').scrollLeft>0')
    assert await page.evaluate('window.__browse.calls.filter(c=>c.name==="getHotels").length')==hotel_reads
    await page.get_by_role('button',name='Show more hotels',exact=True).click()
    await expect(page.locator('[data-hotel-card]')).to_have_count(10)
    await expect(hotels_grid.locator('[data-hotel-card]')).to_have_count(2)
    names=await page.locator('[data-hotel-card] h3').all_text_contents()
    assert len(names)==len(set(names))
    assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
    await page.evaluate('window.scrollTo(0,0)')
    await page.screenshot(path=str(OUT/f'hotels-rail-grid-{width}-{theme}.png'),full_page=True)
    await settled_search(page,page.get_by_placeholder('Search hotel name or location'),['K','Keffi','Keffi Garden'],"window.__browse.calls.filter(c=>c.name==='getHotels').length")
    await expect(hotels_shelf).to_have_count(0)
    await expect(page.get_by_role('region',name='Hotel results',exact=True)).to_be_visible()
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
    row['passed']=True;row['checks']=['same Explore renderer and category switching','plain signed-out prompts without repeated policy links','guest personal requests denied','mixed Homes rail/grid with exact open/save targets','Hotel rail/grid and missing-photo state','pagination without duplicate Homes or Hotels','rail arrows do not fetch','focused searches use comparison grids','same room and offers','selection survives sign-in','no guest save or booking write','Back retains search','searchable State/LGA and stale locality clearing','compact missing gallery','explicit failed thumbnails']
   except Exception as e:
    row['error']=str(e);row['page_errors']=errors;row['unexpected']=await page.evaluate('window.__browse?.unexpected');row['last_reads']=await page.evaluate('window.__browse?.gatewayRequests.slice(-6)');await page.screenshot(path=str(OUT/f'shared-discovery-FAIL-{width}-{theme}.png'),full_page=True,timeout=15000)
   finally:results.append(row);print(json.dumps(row),flush=True);await context.close()
  await browser.close()
 (OUT/'shared-discovery-results.json').write_text(json.dumps(results,indent=2));assert all(row['passed'] for row in results)
if __name__=='__main__':asyncio.run(main())
