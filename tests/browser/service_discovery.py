"""Actual discovery rendering; synthetic public projections, no hosted reads or tracking."""
import asyncio,json,os
from pathlib import Path
from playwright.async_api import async_playwright,expect
BASE=os.environ.get('QA_BASE_URL','http://127.0.0.1:4173')
PROVIDERS=[{'user_id':'serves-keffi','full_name':'Keffi coverage provider','state':'Nasarawa','city':'Lafia','local_government':'Lafia','worker_occupation':'Cleaner','worker_skills':['Cleaning'],'worker_price':15000,'rating':4.8,'review_count':2,'coverage':[{'state':'Nasarawa','lga':'Keffi','areas':['University area']}]},{'user_id':'base-only','full_name':'Base-only provider','state':'Nasarawa','city':'Keffi','local_government':'Keffi','worker_occupation':'Cleaner','worker_skills':['Cleaning'],'worker_price':15000,'coverage':[{'state':'Nasarawa','lga':'Lafia','areas':[]}]}]
for provider in PROVIDERS:
 provider.setdefault('rating',0);provider.setdefault('review_count',0)
MANY=[{**PROVIDERS[0],'user_id':f'many-{i:03}','full_name':f'Many provider {i:03}','rating':4.5,'review_count':3} for i in range(30)]
def search_page(args):
 rows=MANY if args.get('p_query') in ('many','slow') else PROVIDERS
 words=(args.get('p_query') or '').lower().split()
 rows=[row for row in rows if (args.get('p_query') in ('many','slow') or all(word in ' '.join([row['full_name'],row['worker_occupation'],row['state'],row['city'],*row['worker_skills'],*[str(c) for c in row['coverage']]]).lower() for word in words))
  and (not args.get('p_state') or any(c['state']==args['p_state'] and (not args.get('p_city') or c['lga']==args['p_city']) for c in row['coverage']))
  and (not args.get('p_category') or args['p_category']=='Home care')]
 rows=sorted(rows,key=lambda row:(row['rating'],row['review_count'],row['user_id']),reverse=True)
 if args.get('p_after_id'):rows=[row for row in rows if (row['rating'],row['review_count'],row['user_id'])<(args['p_after_rating'],args['p_after_reviews'],args['p_after_id'])]
 items=rows[:24];last=items[-1] if items else None
 return {'items':items,'has_more':len(rows)>24,'next_cursor':{'rating':last['rating'],'reviews':last['review_count'],'id':last['user_id']} if last else None}
async def main():
 out=Path('test-results/experience');out.mkdir(parents=True,exist_ok=True);results=[]
 async with async_playwright() as p:
  browser=await p.chromium.launch(args=['--no-sandbox'])
  try:
   for theme,width in [('light',390),('dark',1280)]:
    context=await browser.new_context(viewport={'width':width,'height':900},service_workers='block');page=await context.new_page();calls=[];searches=[];errors=[];fail={'workers':False,'more':False,'another_viewer':False};slow_started=asyncio.Event()
    page.on('pageerror',lambda error:errors.append(str(error)))
    async def route(handler):
     request=handler.request
     if request.url.startswith(BASE):return await handler.continue_()
     if not request.url.startswith('http://127.0.0.1:54321/'):return await handler.abort()
     headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'}
     if request.method=='OPTIONS':return await handler.fulfill(status=204,headers=headers)
     name=request.url.split('?')[0].split('/')[-1];calls.append(name)
     if name=='search_service_providers':
      args=request.post_data_json;searches.append(args)
      if fail['workers']:return await handler.fulfill(status=503,headers=headers,content_type='application/json',body=json.dumps({'message':'Synthetic discovery outage'}))
      if fail['more'] and args.get('p_after_id'):return await handler.fulfill(status=503,headers=headers,content_type='application/json',body=json.dumps({'message':'Synthetic next-page outage'}))
      if args.get('p_query')=='slow':slow_started.set();await asyncio.sleep(1)
      data=search_page(args)
      if fail['another_viewer']:data={'items':[],'has_more':False,'next_cursor':None}
     elif name=='get_discoverable_service_providers':data=[row for row in PROVIDERS+MANY if row['user_id'] in request.post_data_json['p_ids']]
     elif name=='get_my_worker_block_state':data={'blocked_by_me':False,'blocked_me':False}
     elif name=='get_worker_marketplace_trust':data={'rating':4.5,'review_count':3}
     elif name=='saved_service_providers':data=None
     elif name=='worker_services':data=[{'service_name':'Cleaning','price':15000,'price_type':'per_job'}]
     elif name in ('worker_showcase_posts','get_public_worker_reviews','get_worker_showcase_reactions','get_worker_pro_service_packages','get_worker_pro_featured_posts'):data=[]
     elif name=='get_public_discovery_settings':data=[{'key':'worker_marketplace_launch_enabled','value':'true'}]
     elif name=='service_categories':data=[{'id':'cleaning-category','name':'Home care','is_active':True,'sort_order':1}]
     elif name=='service_subcategories':data=[{'id':'cleaning-skill','category_id':'cleaning-category','name':'Cleaning','is_active':True,'sort_order':1}]
     elif name=='get_my_workspace_inbox':data=[]
     else:raise AssertionError('Unexpected API '+name)
     return await handler.fulfill(status=200,headers=headers,content_type='application/json',body=json.dumps(data))
    await page.route('**/*',route)
    try:
     await page.goto(BASE+'/tests/browser/service-discovery.html?theme='+theme+'&category=Cleaning')
     await expect(page.get_by_role('heading',name='Keffi coverage provider',exact=True)).to_be_visible()
     await expect(page.get_by_role('heading',name='Base-only provider',exact=True)).to_have_count(0)
     await expect(page.get_by_text('Base: Lafia, Nasarawa',exact=True)).to_be_visible()
     await expect(page.get_by_text('Serves Keffi, Nasarawa',exact=True)).to_be_visible()
     await page.get_by_role('button',name='Open filters',exact=True).click()
     await expect(page.get_by_role('button',name='Work category Home care',exact=True)).to_be_visible()
     await expect(page.get_by_role('button',name='Service Cleaning',exact=True)).to_be_visible()
     await page.get_by_role('button',name='Reset',exact=True).click();await page.get_by_role('button',name='Show results',exact=True).click()
     await page.get_by_role('button',name='Open filters',exact=True).click()
     await page.get_by_role('button',name='Work category Any category',exact=True).click()
     await page.get_by_role('option',name='Home care',exact=True).click()
     await page.get_by_role('button',name='Service Any service',exact=True).click()
     await page.get_by_role('option',name='Cleaning',exact=True).click()
     await page.get_by_role('button',name='Show results',exact=True).click()
     await expect(page.get_by_role('heading',name='Keffi coverage provider',exact=True)).to_be_visible()
     await page.get_by_placeholder('Search service, skill or name').fill('Keffi cleaner')
     await expect(page.get_by_role('heading',name='Keffi coverage provider',exact=True)).to_be_visible()
     await page.get_by_role('button',name='Open filters',exact=True).click()
     await page.get_by_role('button',name='Reset',exact=True).click()
     await page.get_by_role('button',name='Show results',exact=True).click()
     await expect(page.get_by_role('heading',name='Base-only provider',exact=True)).to_be_visible()
     await page.get_by_role('button',name='Clear',exact=True).click()
     await expect(page.get_by_role('heading',name='Base-only provider',exact=True)).to_be_visible()
     await expect(page.get_by_placeholder('Search service, skill or name')).to_have_value('')
     await page.get_by_placeholder('Search service, skill or name').fill('slow');await slow_started.wait()
     await page.get_by_placeholder('Search service, skill or name').fill('many')
     await expect(page.get_by_role('heading',name='Many provider 029',exact=True)).to_be_visible()
     await asyncio.sleep(1.1)
     assert len(await page.get_by_role('heading',name='Many provider',exact=False).all())==24
     fail['more']=True
     await page.get_by_role('button',name='Show more Providers',exact=True).evaluate('(button)=>{button.click();button.click();}')
     await expect(page.get_by_role('alert')).to_contain_text('Synthetic next-page outage')
     await expect(page.get_by_role('heading',name='Many provider 029',exact=True)).to_be_visible()
     assert len([args for args in searches if args.get('p_after_id')])==1,'A repeated click started a duplicate page read'
     fail['more']=False;await page.get_by_role('button',name='Show more Providers',exact=True).click()
     await expect(page.get_by_role('heading',name='Many provider 000',exact=True)).to_be_visible()
     assert len(await page.get_by_role('heading',name='Many provider',exact=False).all())==30
     await expect(page.get_by_role('button',name='Show more Providers',exact=True)).to_have_count(0)
     await page.get_by_placeholder('Search service, skill or name').fill('Keffi cleaner')
     await expect(page.get_by_role('heading',name='Many provider 029',exact=True)).to_have_count(0)
     assert 'worker_showcase_posts' not in calls,'Discovery still reads retired stories'
     assert not errors,errors
     assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
     await page.screenshot(path=str(out/f'service-coverage-{theme}.png'))
     fail['workers']=True;await page.get_by_placeholder('Search service, skill or name').fill('outage')
     await expect(page.get_by_role('alert')).to_contain_text('Service Providers could not be loaded.')
     fail['workers']=False;await page.get_by_role('button',name='Try again',exact=True).click()
     await page.get_by_placeholder('Search service, skill or name').fill('Keffi cleaner')
     await expect(page.get_by_role('heading',name='Keffi coverage provider',exact=True)).to_be_visible()
     await page.get_by_role('button',name='Open filters',exact=True).click()
     await expect(page.get_by_role('button',name='Work category Any category',exact=True)).to_be_visible()
     await page.get_by_role('button',name='Show results',exact=True).click()
     await page.goto(BASE+'/tests/browser/service-discovery.html?theme='+theme+'&id=many-000')
     await expect(page.get_by_role('dialog',name='Many provider 000 profile',exact=True)).to_be_visible()
     assert 'get_discoverable_service_providers' in calls,'A shared profile still depended on the first organic page'
     await page.get_by_role('button',name='Back',exact=True).click()
     await expect(page.get_by_role('heading',name='Keffi coverage provider',exact=True)).to_be_visible()
     before=len(searches);fail['another_viewer']=True;await page.evaluate("window.dispatchEvent(new Event('qa-service-viewer'))")
     await expect(page.get_by_text('No Worker matches this search',exact=True)).to_be_visible()
     assert len(searches)>before,'Personalized eligibility was reused after changing the signed-in person'
     assert not errors,errors
     results.append({'theme':theme,'width':width,'passed':True,'checks':['server search combines declared coverage/category/service/text','base and service area explained','reset does not reapply saved area','tied-rating pagination reaches thirty Providers','duplicate-page clicks bounded','failed next page retains results','slow old query cannot replace new query']})
    finally:await context.close()
  finally:await browser.close()
 (out/'service-coverage-results.json').write_text(json.dumps(results,indent=2));print(json.dumps(results))
if __name__=='__main__':asyncio.run(main())
