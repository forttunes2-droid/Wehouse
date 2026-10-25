"""Real rental-term control with isolated HTTP receipts. No provider traffic."""
import asyncio,json,os
from pathlib import Path
from playwright.async_api import async_playwright,expect
BASE=os.environ.get('QA_BASE_URL','http://127.0.0.1:4173')
OUT=Path('test-results/rent-terms')
async def main():
 OUT.mkdir(parents=True,exist_ok=True);results=[]
 async with async_playwright() as p:
  browser=await p.chromium.launch(args=['--no-sandbox'])
  try:
   for theme,width in [('light',390),('dark',1280)]:
    context=await browser.new_context(viewport={'width':width,'height':950},service_workers='block');page=await context.new_page()
    saved={'listing_id':'b7990000-2000-4000-8000-000000000001','revision':1,'accepted_terms_months':[12],'monthly_accepted':False}
    failures={'write':True};calls=[];errors=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    async def route(handler):
     request=handler.request
     if request.url.startswith(BASE): return await handler.continue_()
     if not request.url.startswith('http://127.0.0.1:54321/'): return await handler.abort()
     headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'}
     if request.method=='OPTIONS': return await handler.fulfill(status=204,headers=headers)
     name=request.url.split('/')[-1];args=request.post_data_json or {};calls.append((name,args))
     data=saved.copy()
     if name=='set_my_long_let_rent_terms':
      if failures['write']: data={**saved,'monthly_accepted':False}
      else: saved.update(revision=2,accepted_terms_months=args['p_terms_months'],monthly_accepted=args['p_monthly_accepted']);data=saved.copy()
     await handler.fulfill(status=200,content_type='application/json',body=json.dumps(data),headers=headers)
    await page.route('**/*',route)
    try:
     await page.goto(BASE+'/tests/browser/rent-terms.html?theme='+theme)
     await expect(page.get_by_role('checkbox',name='1 year',exact=True)).to_be_checked()
     await page.get_by_role('checkbox',name='3 months',exact=True).check()
     await page.get_by_role('checkbox',name='2 years',exact=True).check()
     await page.get_by_role('checkbox',name='Accept monthly payments for later years',exact=True).check()
     await page.get_by_role('button',name='Save rental terms',exact=True).click()
     await expect(page.get_by_role('alert')).to_contain_text('did not match your choices')
     await expect(page.get_by_text('Rental terms saved. Existing agreements are unchanged.',exact=True)).to_have_count(0)
     await expect(page.get_by_role('checkbox',name='Accept monthly payments for later years',exact=True)).to_be_checked()
     failures['write']=False
     await page.get_by_role('button',name='Refresh saved terms',exact=True).click()
     await expect(page.get_by_role('checkbox',name='Accept monthly payments for later years',exact=True)).not_to_be_checked()
     await page.get_by_role('checkbox',name='3 months',exact=True).check()
     await page.get_by_role('checkbox',name='2 years',exact=True).check()
     await page.get_by_role('checkbox',name='Accept monthly payments for later years',exact=True).check()
     await page.get_by_role('button',name='Save rental terms',exact=True).click()
     await expect(page.get_by_text('Rental terms saved. Existing agreements are unchanged.',exact=True)).to_be_visible()
     await expect(page.get_by_role('button',name='Save rental terms',exact=True)).to_be_disabled()
     assert saved['accepted_terms_months']==[3,12,24] and saved['monthly_accepted'] is True
     assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
     assert not errors,errors
     await page.screenshot(path=str(OUT/f'partner-terms-{theme}.png'),full_page=True)
     results.append({'theme':theme,'width':width,'passed':True,'checks':['saved offer','malformed write cannot report success','draft preserved after unknown result','refresh and recovery']})
    finally: await context.close()
   for theme,width in [('light',390),('dark',1280)]:
    context=await browser.new_context(viewport={'width':width,'height':1100},service_workers='block');page=await context.new_page()
    state={'agreement':None,'bad_quote':False};errors=[];calls=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    def quote(months,choice):
     total=1200000*months/12
     payments=[{'sequence':1,'target_year':1,'month_offset':0,'due_before_handover':True,'due_on':None,'amount':1200000 if choice=='monthly' else total}]
     if choice=='monthly':payments.extend([{'sequence':i+2,'target_year':2,'month_offset':i+4,'due_before_handover':False,'due_on':None,'amount':150000} for i in range(8)])
     return {'schema_version':1,'reservation_id':'rent-agreement-browser','listing_id':'b7990000-2000-4000-8000-000000000001','offer_revision':1,'currency':'NGN','quote_digest':('a' if choice=='full' else 'b')*32,'rent_schedule':{'term_months':months,'payment_choice':choice,'annual_rent':1200000,'first_year_rent':min(total,1200000),'contract_total':total,'due_before_handover':payments[0]['amount'],'future_balance':total-payments[0]['amount'],'payments':payments}}
    async def customer_route(handler):
     request=handler.request
     if request.url.startswith(BASE):return await handler.continue_()
     if not request.url.startswith('http://127.0.0.1:54321/'):return await handler.abort()
     headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'}
     if request.method=='OPTIONS':return await handler.fulfill(status=204,headers=headers)
     name=request.url.split('/')[-1];args=request.post_data_json or {};calls.append((name,args))
     if name=='get_my_long_let_terms_offer':data={'reservation_id':'rent-agreement-browser','listing_id':'b7990000-2000-4000-8000-000000000001','offer_revision':1,'accepted_terms_months':[3,6,12,24],'monthly_accepted':True,'monthly_ready':True,'editable':True,'agreement':state['agreement']}
     elif name=='preview_my_long_let_agreement':
      data=quote(args['p_term_months'],args['p_payment_choice'])
      if state['bad_quote']:data['rent_schedule']['contract_total']=1
     elif name=='accept_my_long_let_agreement':
      data={**quote(args['p_term_months'],args['p_payment_choice']),'accepted_by':'rent-customer','accepted_at':'2026-10-25T14:00:00Z'};state['agreement']=data
     else:raise AssertionError('Unexpected rent agreement RPC '+name)
     await handler.fulfill(status=200,content_type='application/json',body=json.dumps(data),headers=headers)
    await page.route('**/*',customer_route)
    try:
     await page.goto(BASE+'/tests/browser/rent-terms.html?mode=customer&theme='+theme)
     pay=page.get_by_role('button',name='Start rent payment',exact=True)
     await expect(pay).to_be_disabled()
     await expect(page.get_by_role('combobox',name='How you pay rent',exact=True)).to_have_count(0)
     await expect(page.get_by_text('Pay the full term before handover',exact=True)).to_be_visible()
     await page.get_by_role('combobox',name='Length of stay',exact=True).select_option('3')
     await page.get_by_role('button',name='Review selected agreement',exact=True).click()
     await expect(page.locator('main')).to_contain_text('₦300,000.00')
     accept=page.get_by_role('button',name='Accept rental agreement',exact=True)
     await expect(accept).to_be_disabled();await expect(pay).to_be_disabled()
     await page.get_by_role('checkbox',name='I have reviewed this term, total rent and payment schedule.',exact=True).check()
     await accept.click();await expect(pay).to_be_enabled()
     await page.get_by_role('combobox',name='Length of stay',exact=True).select_option('24')
     await page.get_by_role('combobox',name='How you pay rent',exact=True).select_option('monthly')
     await expect(pay).to_be_disabled()
     state['bad_quote']=True
     await page.get_by_role('button',name='Review selected agreement',exact=True).click()
     await expect(page.get_by_role('alert')).to_contain_text('Rent totals do not match')
     await expect(pay).to_be_disabled();await expect(accept).to_have_count(0)
     state['bad_quote']=False
     async with page.expect_response(lambda response:response.url.endswith('/get_my_long_let_terms_offer')) as refreshed:
      await page.get_by_role('button',name='Refresh agreement',exact=True).click()
     await refreshed.value
     await expect(page.get_by_role('status').filter(has_text='Loading your rental terms')).to_have_count(0)
     await page.get_by_role('combobox',name='Length of stay',exact=True).select_option('24')
     await page.get_by_role('combobox',name='How you pay rent',exact=True).select_option('monthly')
     await page.get_by_role('button',name='Review selected agreement',exact=True).click()
     await expect(page.locator('main')).to_contain_text('₦1,200,000.00')
     await page.get_by_text('View payment schedule',exact=True).click()
     await expect(page.locator('main')).to_contain_text('11 months after handover')
     await page.get_by_role('checkbox',name='I have reviewed this term, total rent and payment schedule.',exact=True).check()
     await accept.click();await expect(pay).to_be_enabled()
     assert state['agreement']['rent_schedule']['payment_choice']=='monthly'
     assert state['agreement']['rent_schedule']['term_months']==24
     assert state['agreement']['rent_schedule']['due_before_handover']==1200000
     await page.get_by_role('combobox',name='Length of stay',exact=True).select_option('12')
     await expect(page.get_by_role('combobox',name='How you pay rent',exact=True)).to_have_count(0)
     await expect(pay).to_be_disabled()
     await page.get_by_role('button',name='Review selected agreement',exact=True).click()
     await expect(page.locator('main')).to_contain_text('Full payment')
     assert calls[-1][0]=='preview_my_long_let_agreement' and calls[-1][1]['p_payment_choice']=='full','One-year selection must reset to full payment'
     assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
     assert not errors,errors
     await page.screenshot(path=str(OUT/f'customer-agreement-{theme}.png'),full_page=True)
     results.append({'case':'Customer reviewed full/monthly agreement '+theme,'passed':True,'checks':['checkout blocked until confirmed acceptance','term and price match review','changed selection blocks previous checkout','malformed quote fails closed','review and recovery']})
    finally:await context.close()
  finally:
   await browser.close();(OUT/'results.json').write_text(json.dumps(results,indent=2))
asyncio.run(main())
