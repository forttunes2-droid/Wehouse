"""Actual chat rendering with isolated RPC/signal fixtures; no hosted calls or charges."""
import asyncio,json,os
from pathlib import Path
from playwright.async_api import async_playwright,expect
BASE=os.environ.get('QA_BASE_URL','http://127.0.0.1:4173')
OUT=Path('test-results/service-quote')
async def main():
 OUT.mkdir(parents=True,exist_ok=True);results=[]
 async with async_playwright() as p:
  browser=await p.chromium.launch(args=['--no-sandbox'])
  try:
   for theme,width in [('light',390),('dark',1280)]:
    context=await browser.new_context(viewport={'width':width,'height':1000},service_workers='block')
    # Empty message fixture: exercise quote UI with an already-unlocked test identity.
    # This does not test encryption or manufacture a usable private key.
    await context.add_init_script("sessionStorage.setItem('wehouse:e2ee:private-key:quote-customer','{}'); sessionStorage.setItem('wehouse:e2ee:private-key:quote-customer:version','1')")
    page=await context.new_page()
    state={'amount':None,'hold':None,'held':False,'contract':False};counts={};errors=[];commands=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    async def route(handler):
     request=handler.request
     if request.url.startswith(BASE):return await handler.continue_()
     if not request.url.startswith('http://127.0.0.1:54321/'):return await handler.abort()
     headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'}
     if request.method=='OPTIONS':return await handler.fulfill(status=204,headers=headers)
     name=request.url.split('?')[0].split('/')[-1];counts[name]=counts.get(name,0)+1
     data=[]
     if name=='get_my_worker_booking_details':
      amount=state['amount'];data={'id':'quote-booking','user_id':'quote-customer','worker_id':'quote-provider','service_type':'Cleaning','booking_code':'QUOTE01','status':'waiting_payment' if amount else 'negotiating','currency':'NGN','negotiated_amount':amount,'agreed_amount':amount,'scheduled_date':'2026-11-10','description':'Clean a two-bedroom flat','address':'Agreed customer address','worker_name':'Service Provider','user_name':'Customer','job_support_open':True}
      if state['contract']:
       data.update(service_quote_revision=1,service_quote={'revision':1,'booking_id':'quote-booking','customer_id':'quote-customer','provider_id':'quote-provider','amount':amount,'currency':'NGN','customer_service_charge':0,'scope':'Clean a two-bedroom flat','address':'Agreed customer address','starts_at':'2027-01-02T09:00:00Z','timezone':'Africa/Lagos','cancellation':{'version':'service-standard-24h-v1','full_refund_until':'2027-01-01T09:00:00Z','late_cancellation':'wehouse_review','provider_cancellation':'full_refund'}})
      if state['hold'] is not None and not state['held']:
       state['held']=True;await state['hold'].wait()
     elif name=='user_encryption_identities':data={'user_id':'quote-customer','key_version':1}
     elif name=='conversation_key_envelopes':data={'recipient_user_id':'quote-customer'}
     elif name=='get_my_private_conversation_profile':data=None
     elif name=='accept_my_service_quote':
      commands.append(name);assert request.post_data_json=={'p_booking_id':'quote-booking','p_revision':1};data={'accepted':True,'revision':1,'accepted_at':'2026-10-26T12:00:00Z'}
     elif name=='create_worker_booking_payment':commands.append(name);data={'success':True,'reference':'WHBK-synthetic-browser'}
     elif name=='payment-init':
      commands.append(name);return await handler.fulfill(status=503,content_type='application/json',body=json.dumps({'success':False,'error':'Synthetic checkout connection failure'}),headers=headers)
     await handler.fulfill(status=200,content_type='application/json',body=json.dumps(data),headers=headers)
    await page.route('**/*',route)
    try:
     await page.goto(BASE+'/tests/browser/service-quote.html?theme='+theme)
     await expect(page.get_by_text('Cleaning',exact=True).first).to_be_visible()
     await expect(page.get_by_role('button',name='Review quote',exact=False)).to_have_count(0)
     message_reads=counts.get('get_private_encrypted_messages',0)
     state['amount']=42000
     await page.evaluate("window.dispatchEvent(new CustomEvent('qa-service-booking-change',{detail:{booking_id:'quote-booking'}}))")
     review=page.get_by_role('button',name='Review quote',exact=False)
     await expect(review).to_contain_text('42,000')
     assert counts.get('get_private_encrypted_messages',0)==message_reads,'Price signal reloaded/decrypted the whole conversation'
     await review.click()
     await expect(page.get_by_role('dialog',name='Review service booking payment')).to_contain_text('Receiving a quote does not commit you to paying')
     await expect(page.get_by_role('button',name='Payment unavailable',exact=True)).to_be_disabled()
     await page.get_by_role('button',name='Back to conversation',exact=True).click()
     state['contract']=True
     await page.evaluate("window.dispatchEvent(new CustomEvent('qa-service-booking-change',{detail:{booking_id:'quote-booking'}}))")
     await expect(page.get_by_text('Start time:',exact=False)).to_be_visible()
     await review.click()
     accept=page.get_by_role('button',name='Accept quote and continue to payment',exact=True)
     await expect(accept).to_be_disabled()
     await expect(page.get_by_role('dialog',name='Review service booking payment')).to_contain_text('Africa/Lagos')
     await page.get_by_role('checkbox',name='Accept Service quote and cancellation terms',exact=True).check()
     await accept.click()
     await expect(page.get_by_text('Synthetic checkout connection failure',exact=True)).to_be_visible()
     assert commands==['accept_my_service_quote','create_worker_booking_payment','payment-init'],commands
     await expect(page.get_by_role('checkbox',name='Accept Service quote and cancellation terms',exact=True)).to_be_checked()
     await expect(accept).to_be_enabled()
     await page.screenshot(path=str(OUT/f'quote-review-recovery-{theme}.png'),full_page=True)
     await page.get_by_role('button',name='Back to conversation',exact=True).click()
     state['hold']=asyncio.Event()
     await page.evaluate("window.dispatchEvent(new CustomEvent('qa-service-booking-change',{detail:{booking_id:'quote-booking'}}))")
     for _ in range(50):
      if state['held']:break
      await asyncio.sleep(.05)
     assert state['held'],'Delayed booking read was not started'
     state['amount']=73000
     await page.evaluate("window.dispatchEvent(new Event('focus'))")
     await expect(review).to_contain_text('73,000')
     state['hold'].set();await page.wait_for_timeout(400)
     await expect(review).to_contain_text('73,000')
     assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
     await page.screenshot(path=str(OUT/f'quote-{theme}.png'),full_page=True)
     await page.evaluate('window.__switchQuoteCustomer()')
     await expect(page.get_by_role('button',name='Review quote',exact=False)).to_have_count(0)
     await expect(page.get_by_role('alert')).to_contain_text('could not be confirmed')
     assert not errors,errors
     results.append({'theme':theme,'width':width,'passed':True,'checks':['quote visible without manual refresh','booking-only invalidation','old response cannot restore old price','receiving quote creates no payment','explicit consent before checkout','acceptance then server checkout reference','failed checkout preserves agreement and shows persistent error','account switch clears quote']})
    finally:
     if state['hold']:state['hold'].set()
     await context.close()
  finally:
   await browser.close();(OUT/'results.json').write_text(json.dumps(results,indent=2))
asyncio.run(main())
