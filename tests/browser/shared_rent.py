"""Real shared-rent UI and API wrappers; rollback-only server receipts.
No PSP request, live identity or Production database is used.
"""
import asyncio,copy,json,datetime
from pathlib import Path
from playwright.async_api import async_playwright,expect

BASE='http://127.0.0.1:4173'
OUT=Path('test-results/shared-rent');OUT.mkdir(parents=True,exist_ok=True)
F=json.loads(Path('tests/browser/shared-rent-fixtures.json').read_text())

async def main():
 results=[]
 async with async_playwright() as p:
  browser=await p.chromium.launch(args=['--no-sandbox'])
  for width,theme in [(320,'light'),(390,'dark'),(1440,'light'),(1440,'dark')]:
   context=await browser.new_context(viewport={'width':width,'height':900},service_workers='block')
   page=await context.new_page();errors=[];calls=[];unexpected=[]
   page.on('pageerror',lambda e:errors.append(str(e)))
   state={'mode':'owner','group':'fee_paid','bad_quote':False,'lost_acceptance':True}
   def group():
    value=copy.deepcopy(F[state['group']]);value['expires_at']=(datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(days=2)).isoformat()
    return value
   async def route(h):
    req=h.request
    if req.url.startswith(BASE):return await h.continue_()
    if not req.url.startswith('http://127.0.0.1:54321/'):
     unexpected.append(req.url);return await h.abort()
    headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'}
    if req.method=='OPTIONS':return await h.fulfill(status=204,headers=headers)
    name=req.url.split('/')[-1];args=req.post_data_json or {};calls.append((name,args));data={}
    if name=='get_my_shared_housing_group':data=group()
    elif name=='get_my_shared_long_let_terms':data=F['offer']
    elif name=='preview_my_shared_long_let_agreement':
     assert args['p_term_months']==24 and args['p_payment_choice']=='monthly'
     data=copy.deepcopy(F['quote'])
     if state['bad_quote']:data['payer_agreements'][0]['rent_schedule']['payments'][1]['wehouse_amount']+=1
    elif name=='start_my_shared_contract_split':
     assert args['p_quote_digest']==F['quote']['agreement']['quote_digest']
     state['group']='started';data=group()
    elif name=='respond_to_shared_rent_agreement':
     assert args['p_group_id']==F['offer']['group_id'] and args['p_checkout_attempt']==F['peer_offer']['checkout_attempt']
     assert args['p_quote_digest']==F['peer_invitation']['rent_agreement']['quote_digest'] and args['p_accept'] is True
     state['group']='peer_accepted'
     if state['lost_acceptance']:return await h.fulfill(status=503,headers=headers,content_type='application/json',body=json.dumps({'message':'Synthetic lost acceptance response'}))
     data=group()
    elif name=='create_my_shared_housing_payment':data={'reference':'WH-SH-'+'A'*32,'amount':600000,'payment_phase':'contract_rent','product_type':'long_let'}
    elif name=='payment-init':
     assert args['reference']=='WH-SH-'+'A'*32
     state['group']='occupied';data={'success':True,'already_paid':True,'reference':args['reference'],'purpose':'shared_housing_share'}
    elif name=='get_my_stay_arrival_instructions':data='Synthetic directions for confirmed tenants only'
    elif name=='get_my_later_rent_history':
     which='peer_history' if state['mode']=='peer' or args.get('p_plan_id')==F['peer_history']['plan_id'] else 'customer_history'
     data=copy.deepcopy(F[which])
     if state['mode']=='partner':data['viewer']='partner'
    elif name=='get_my_later_rent_debit':data={'reservation_id':F['offer']['reservation_id'],'status':'manual','last4':None,'card_type':None,'payment_pending':False,'last_result':None}
    elif name=='get_my_property_later_rent_accounts':data=F['partner_accounts']
    elif name=='get_my_rent_settlement_setup':data={'listing_id':args['p_listing_id'],'bank_account_id':'b7990000-5000-4000-8000-000000000001','bank_name':'Synthetic Bank','last4':'0000','ready':True}
    else:
     unexpected.append(name);return await h.fulfill(status=500,headers=headers,body='Unexpected fixture request')
    return await h.fulfill(status=200,headers=headers,content_type='application/json',body=json.dumps(data))
   await page.route('**/*',route)
   async def open_mode(mode):
    state['mode']=mode
    await page.goto(BASE+f'/tests/browser/rent-terms.html?mode=shared-rent-{mode}&theme={theme}')
    assert await page.evaluate("document.documentElement.classList.contains('dark')")== (theme=='dark')
    assert await page.evaluate('document.documentElement.style.colorScheme')==theme
   async def review():
    await page.get_by_role('combobox',name='Shared rental term',exact=True).select_option('24')
    await page.get_by_role('combobox',name='How you share rent payments',exact=True).select_option('monthly')
    await page.get_by_role('button',name='Review rent and participant shares',exact=True).click()

   await open_mode('owner');await review()
   await expect(page.get_by_role('region',name='Participant rent shares')).to_contain_text('₦600,000.00 before handover')
   accept=page.get_by_role('button',name='Accept my share and invite the others',exact=True)
   await expect(accept).to_be_disabled();await page.get_by_role('checkbox').check();await accept.click()
   await expect(page.get_by_text('Waiting for each person',exact=False)).to_be_visible()
   assert len([c for c in calls if c[0]=='start_my_shared_contract_split'])==1
   await expect(page.get_by_role('button',name='Complete my payment',exact=False)).to_have_count(0)
   assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
   await page.screenshot(path=str(OUT/f'owner-{theme}-{width}.png'),full_page=True)
   results.append({'case':'owner reviewed term, own share and peer invitation','theme':theme,'width':width,'passed':True})

   state['group']='peer_invitation';await open_mode('peer')
   accept=page.get_by_role('button',name='Accept my share',exact=True)
   await expect(accept).to_be_disabled();await page.get_by_role('checkbox').check();await accept.click()
   await expect(page.get_by_role('alert')).to_contain_text('Synthetic lost acceptance response')
   await page.get_by_role('button',name='Refresh shared reservation',exact=True).click()
   await expect(accept).to_have_count(0)
   assert len([c for c in calls if c[0]=='respond_to_shared_rent_agreement'])==1
   await page.get_by_role('button',name='Complete my payment',exact=False).click()
   await expect(page.get_by_role('region',name='Shared booking arrival')).to_contain_text('Synthetic contract address')
   await expect(page.get_by_role('heading',name='Your later-year rent share',exact=True)).to_be_visible()
   await expect(page.get_by_text('0 complete months of this rent share funded',exact=True)).to_be_visible()
   await expect(page.get_by_text('This contribution is overdue.',exact=False)).to_be_visible()
   await expect(page.get_by_role('button',name='Pay scheduled rent',exact=True)).to_be_disabled()
   await page.evaluate("window.addEventListener('openSupportChat',e=>window.__sharedHelp=e.detail,{once:true})")
   await page.get_by_role('button',name='Get help with rent or early exit',exact=True).click()
   detail=await page.evaluate('window.__sharedHelp');assert detail['contextSnapshot']['subject_type']=='shared_payment' and detail['contextId']==F['offer']['group_id']
   assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
   await page.locator('div[role="dialog"]').evaluate('(el)=>el.scrollTo(0,0)')
   await page.screenshot(path=str(OUT/f'peer-{theme}-{width}.png'),full_page=True)
   results.append({'case':'peer consent retry, own checkout, protected arrival and overdue share','theme':theme,'width':width,'passed':True})

   await open_mode('partner');await page.get_by_role('button',name='Rent payments and settlement',exact=True).click()
   combined=page.get_by_role('region',name='Combined shared rent',exact=True)
   await expect(combined).to_have_count(1);await expect(combined).to_contain_text('₦75,000.00')
   buttons=page.get_by_role('button',name='Tenant · active',exact=True);await expect(buttons).to_have_count(2)
   for index in [0,1]:
    await buttons.nth(index).click()
    await expect(page.get_by_role('region',name='Later-year rent payments')).to_be_visible()
    await expect(page.get_by_role('button',name='Pay scheduled rent',exact=True)).to_have_count(0)
   await expect(page.locator('section[aria-label="Later-year rent payments"] ol > li')).to_have_count(1)
   await page.get_by_role('button',name='View full rent schedule',exact=True).click()
   await expect(page.locator('section[aria-label="Later-year rent payments"] ol > li')).to_have_count(8)
   await page.get_by_role('button',name='Show current payments',exact=True).click()
   assert len(set(c[1]['p_plan_id'] for c in calls if c[0]=='get_my_later_rent_history' and c[1].get('p_plan_id')))==2
   assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
   await page.screenshot(path=str(OUT/f'partner-{theme}-{width}.png'),full_page=True)
   results.append({'case':'Partner combined receipts and separate payer histories','theme':theme,'width':width,'passed':True})

   state['group']='fee_paid';state['bad_quote']=True;await open_mode('owner');await review()
   await expect(page.get_by_role('region',name='Shared rental agreement').get_by_role('alert')).to_be_visible()
   await expect(page.get_by_role('button',name='Accept my share and invite the others',exact=True)).to_have_count(0)
   assert not errors,errors;assert not unexpected,unexpected
   results.append({'case':'conflicting fee receipt blocks agreement','theme':theme,'width':width,'passed':True})
   await context.close()
  await browser.close()
 (OUT/'results.json').write_text(json.dumps(results,indent=2));print(json.dumps(results))
asyncio.run(main())
