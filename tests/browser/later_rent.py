"""Actual rent-credit and Partner account UI. Isolated RPCs; no hosted charge."""
import asyncio,copy,json
from pathlib import Path
from playwright.async_api import async_playwright,expect
BASE='http://127.0.0.1:4173';OUT=Path('test-results/later-rent');OUT.mkdir(parents=True,exist_ok=True)
PLAN='b7990000-7000-4000-8000-000000000001';BANK='b7990000-5000-4000-8000-000000000001';DIGEST='a'*32
def history(state,args,partner=False):
 paid=state['paid'];after=args.get('p_after_sequence',0)
 items=[{'contribution_id':f'b7990000-8000-4000-8000-{i:012d}','agreement_sequence':i+1,'target_year':2,'due_date':'2026-10-27','amount':150000,'paystack_reference':('WHNEXT-'+'A'*32) if i==1 and paid else None,'payment_status':'paid' if i==1 and paid else 'scheduled','settlement_status':'pending' if i==1 and paid else 'not_started','amount_commission':15000 if i==1 and paid else None,'net_amount':135000 if i==1 and paid else None,'paid_at':'2026-10-27T12:00:00Z' if i==1 and paid else None,'can_pay':i==1 and not paid and not partner} for i in range(1,4)]
 page=[p for p in items if p['agreement_sequence']>after][:1 if after==0 else 16]
 return {'reservation_id':'rent-agreement-browser','plan_id':PLAN,'viewer':'partner' if partner else 'customer','currency':'NGN','agreement_digest':DIGEST,'plan_status':'active','collection_available':True,'settlement_consent':state['consent'],'years':[{'target_year':2,'annual_rent':1200000,'gross_rent_paid':150000 if paid else 0,'completed_months':1 if paid else 0,'partial_month_credit':50000 if paid else 0,'next_month_balance':50000 if paid else 100000,'remaining_year_rent':1050000 if paid else 1200000}],'items':page,'has_more':after==0,'next_sequence':2 if after==0 else None}
async def main():
 results=[]
 async with async_playwright() as p:
  browser=await p.chromium.launch(args=['--no-sandbox'])
  for theme,width in [('light',390),('dark',1440)]:
   context=await browser.new_context(viewport={'width':width,'height':900},service_workers='block');page=await context.new_page();errors=[];calls=[]
   page.on('pageerror',lambda e:errors.append(str(e)))
   state={'paid':False,'consent':None,'lost_acceptance':True,'read_error':True,'bad_credit':False,'setup_ready':False,'auto':'manual'};partner=False
   async def route(h):
    nonlocal partner
    req=h.request
    if req.url.startswith(BASE):return await h.continue_()
    if req.url.startswith('https://checkout.paystack.com/'):return await h.fulfill(status=200,content_type='text/html',body='<p>Isolated checkout destination</p>')
    if not req.url.startswith('http://127.0.0.1:54321/'):return await h.abort()
    headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'}
    if req.method=='OPTIONS':return await h.fulfill(status=204,headers=headers)
    name=req.url.split('/')[-1];args=req.post_data_json or {};calls.append((name,args));data={};status=200
    if name=='get_my_later_rent_history':
     data=history(state,args,partner)
     if state['read_error']:return await h.fulfill(status=503,body=json.dumps({'message':'Synthetic history outage'}),headers=headers)
     if state['bad_credit']:data['years'][0]['gross_rent_paid']=135000
    elif name=='accept_my_later_rent_settlement':
     state['consent']={'accepted_by':'rent-customer','accepted_at':'2026-10-27T12:00:00Z','agreement_digest':DIGEST,'payment_protection_hold':False,'gross_rent_credit':True}
     if state['lost_acceptance']:return await h.fulfill(status=503,body=json.dumps({'message':'Synthetic lost acceptance receipt'}),headers=headers)
     data=state['consent']
    elif name=='create_rent_plan_contribution_payment':data={'success':True,'reference':'WHNEXT-'+'A'*32,'amount':150000,'currency':'NGN'}
    elif name=='payment-init':data={'success':True,'purpose':'rent_plan_contribution','reference':'WHNEXT-'+'A'*32,'authorization_url':'https://checkout.paystack.com/rent-fixture'}
    elif name=='get_my_property_later_rent_accounts':data={'listing_id':args['p_listing_id'],'items':[{'plan_id':PLAN,'reservation_id':'rent-agreement-browser','tenant_name':'Ada','status':'active'}],'has_more':False,'next_id':None}
    elif name=='get_my_rent_settlement_setup':data={'listing_id':args['p_listing_id'],'bank_account_id':BANK,'bank_name':'Synthetic Bank','last4':'0123','ready':state['setup_ready']}
    elif name=='rent-settlement-setup':state['setup_ready']=True;data={'success':True,'ready':True,'bank_account_id':BANK}
    elif name=='get_my_later_rent_debit':data={'reservation_id':'rent-agreement-browser','status':state['auto'],'last4':'0123' if state['auto']=='active' else None,'card_type':'Visa' if state['auto']=='active' else None,'payment_pending':False,'last_result':None}
    elif name=='rent-automatic-payment':state['auto']='active';data={'success':True}
    elif name=='disable_my_later_rent_debit':state['auto']='disabled';data={'reservation_id':'rent-agreement-browser','status':'disabled','last4':None,'card_type':None,'payment_pending':False,'last_result':None}
    return await h.fulfill(status=status,content_type='application/json',body=json.dumps(data),headers=headers)
   await page.route('**/*',route)
   await page.goto(BASE+f'/tests/browser/rent-terms.html?mode=history&theme={theme}')
   await expect(page.get_by_role('alert')).to_contain_text('Synthetic history outage');await expect(page.get_by_role('button',name='Pay scheduled rent',exact=True)).to_have_count(0)
   state['read_error']=False;await page.get_by_role('button',name='Refresh payments',exact=True).click();await expect(page.get_by_text('0 complete months funded',exact=True)).to_be_visible()
   pay=page.get_by_role('button',name='Pay scheduled rent',exact=True);await expect(pay).to_be_disabled()
   await page.get_by_role('checkbox',name='I accept direct Partner settlement',exact=False).check();await page.get_by_role('button',name='Accept later-year settlement',exact=True).click();await expect(page.get_by_role('alert')).to_contain_text('Synthetic lost acceptance receipt');await expect(pay).to_be_disabled()
   await page.get_by_role('button',name='Refresh payments',exact=True).click();await expect(pay).to_be_enabled();assert len([c for c in calls if c[0]=='accept_my_later_rent_settlement'])==1
   await pay.click();await page.wait_for_url('https://checkout.paystack.com/rent-fixture');assert len([c for c in calls if c[0]=='create_rent_plan_contribution_payment'])==1
   state['paid']=True;await page.goto(BASE+f'/tests/browser/rent-terms.html?mode=history&theme={theme}');await expect(page.get_by_text('1 complete month funded',exact=True)).to_be_visible();await expect(page.get_by_text('Partner settlement pending',exact=False)).to_be_visible()
   auto=page.get_by_role('region',name='Automatic rent payment',exact=True)
   await auto.get_by_text('Choose optional automatic payment',exact=True).click()
   await expect(auto.get_by_role('button',name='Check card and enable automatic payment',exact=True)).to_be_disabled()
   await auto.get_by_role('checkbox').check();await auto.get_by_role('button',name='Check card and enable automatic payment',exact=True).click()
   await expect(auto.get_by_text('Automatic payment is on',exact=False)).to_contain_text('0123')
   await auto.get_by_role('button',name='Turn off future automatic payments',exact=True).click();await expect(auto.get_by_text('Manual payment.',exact=False)).to_be_visible()
   assert len([c for c in calls if c[0]=='rent-automatic-payment'])==1
   await page.get_by_role('button',name='More scheduled payments',exact=True).click();await expect(page.locator('section[aria-label="Later-year rent payments"] ol > li')).to_have_count(3)
   await expect(page.get_by_text('1 complete month funded',exact=True)).to_be_visible();await page.get_by_role('button',name='Get help with rent or early exit',exact=True).click();assert await page.evaluate('window.__rentHelpOpened') is True
   assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth+1');await page.screenshot(path=str(OUT/f'customer-{theme}.png'),full_page=True)
   state['bad_credit']=True;await page.get_by_role('button',name='Refresh payments',exact=True).click();await expect(page.get_by_role('alert')).to_contain_text('does not match verified payments');await expect(page.get_by_text('1 complete month funded',exact=True)).to_have_count(0)
   state['bad_credit']=False;partner=True;await page.goto(BASE+f'/tests/browser/rent-terms.html?mode=partner-history&theme={theme}')
   assert not [c for c in calls if c[0]=='get_my_property_later_rent_accounts'];await page.get_by_role('button',name='Rent payments and settlement',exact=True).click()
   await page.get_by_role('button',name='Prepare or check settlement setup',exact=True).click();await expect(page.get_by_role('status')).to_contain_text('Partner settlement setup verified')
   await page.get_by_role('button',name='Ada · active',exact=True).click();await expect(page.get_by_text('Your net ₦135,000.00',exact=False)).to_be_visible();await expect(page.get_by_role('button',name='Pay scheduled rent',exact=True)).to_have_count(0)
   assert not errors,errors;assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth+1');await page.screenshot(path=str(OUT/f'partner-{theme}.png'),full_page=True)
   results.append({'theme':theme,'width':width,'outage_recovery':True,'lost_acceptance_recovery':True,'one_checkout':True,'gross_credit':True,'paged_history':True,'partner_earnings':True,'bad_credit_denied':True,'passed':True});await context.close()
  await browser.close()
 (OUT/'results.json').write_text(json.dumps(results,indent=2));print(json.dumps(results))
asyncio.run(main())
