"""Actual report controls recover from hung reads and uncertain writes."""
import asyncio,json
from pathlib import Path
from playwright.async_api import async_playwright,expect

BASE='http://127.0.0.1:4173';OUT=Path('test-results/security-controls')

async def main():
 results=[];OUT.mkdir(parents=True,exist_ok=True)
 async with async_playwright() as p:
  browser=await p.chromium.launch(args=['--no-sandbox'])
  for theme,width in [('light',390),('dark',1440)]:
   for mode in ['reports-history','reports-generic','reports-listing','reports-hotel','reports-admin']:
    context=await browser.new_context(viewport={'width':width,'height':900},service_workers='block')
    page=await context.new_page();await page.clock.install();calls=[];release=asyncio.Event();errors=[]
    state={'first_read':True,'updated':False};page.on('pageerror',lambda e:errors.append(str(e)))
    row={'id':'sample-report','report_id':'sample-report','subject_type':'profile','subject_user_id':'sample','reason':'spam','status':'open','created_at':'2026-10-27T12:00:00Z'}
    async def route(handler):
     req=handler.request
     if req.url.startswith(BASE):return await handler.continue_()
     if not req.url.startswith('http://127.0.0.1:54321/'):return await handler.abort()
     headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'}
     if req.method=='OPTIONS':return await handler.fulfill(status=204,headers=headers)
     name=req.url.split('/')[-1];calls.append(name);data=None
     if name=='list_my_content_reports':
      if state['first_read']:
       state['first_read']=False;await release.wait();data=[{**row,'report_id':'obsolete-report'}]
      else:data=[row]
     elif name=='admin_list_content_reports':data=[] if state['updated'] else [row]
     elif name=='admin_resolve_content_report':state['updated']=True;await release.wait()
     elif name in ['report_content','report_listing','report_hotel']:await release.wait();data='saved-late-report'
     return await handler.fulfill(status=200,content_type='application/json',body=json.dumps(data),headers=headers)
    await page.route('**/*',route)
    await page.goto(BASE+f'/tests/browser/rent-terms.html?mode={mode}&theme={theme}')
    if mode=='reports-history':
     await expect(page.get_by_role('status')).to_contain_text('Loading your reports')
     await page.clock.fast_forward(16000)
     await expect(page.get_by_role('alert')).to_contain_text('could not be loaded')
     await expect(page.get_by_text('You have not sent any reports.',exact=True)).to_have_count(0)
     await page.get_by_role('button',name='Try again',exact=True).click()
     await expect(page.get_by_text('Report reference: sample-report',exact=True)).to_be_visible()
     release.set();await page.wait_for_timeout(50)
     await expect(page.get_by_text('Report reference: obsolete-report',exact=True)).to_have_count(0)
    elif mode=='reports-admin':
     await page.get_by_role('button',name='Actioned',exact=True).click()
     await page.clock.fast_forward(16000)
     await expect(page.get_by_text('The report update is not confirmed. Refreshing its current status.',exact=True)).to_be_visible()
     await expect(page.get_by_text('No open reports in your coverage.',exact=True)).to_be_visible()
     await expect(page.get_by_text('Report updated',exact=True)).to_have_count(0)
     assert calls.count('admin_resolve_content_report')==1
    else:
     if mode=='reports-generic':await page.get_by_role('button',name='Spam',exact=True).click()
     else:await page.get_by_role('radio',name='Suspicious activity or possible fraud',exact=True).check()
     await page.get_by_role('button',name='Send report',exact=True).click()
     await expect(page.get_by_role('button',name='Sending…' if mode=='reports-generic' else 'Sending report…',exact=True)).to_be_disabled()
     await page.clock.fast_forward(16000)
     await expect(page.get_by_text('Your report is not confirmed. Check Reports you sent before trying again.',exact=True)).to_be_visible()
     await expect(page.get_by_role('dialog')).to_be_visible()
     await expect(page.get_by_role('button',name='Send report',exact=True)).to_be_enabled()
     release.set();await page.wait_for_timeout(50)
     await expect(page.get_by_text('Report form closed',exact=True)).to_have_count(0)
     assert sum(calls.count(n) for n in ['report_content','report_listing','report_hotel'])==1
    await page.screenshot(path=str(OUT/f'{mode}-{theme}.png'),full_page=True)
    assert not errors,errors
    results.append({'theme':theme,'mode':mode,'timeout_recovered':True,'no_false_success':True,'passed':True})
    release.set();await context.close()
  await browser.close()
 (OUT/'report-recovery-results.json').write_text(json.dumps(results,indent=2));print(json.dumps(results))

asyncio.run(main())
