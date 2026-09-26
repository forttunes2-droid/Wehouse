"""Actual plan/document components; synthetic API responses, no live writes."""
import asyncio, json, os, subprocess
from pathlib import Path
from playwright.async_api import async_playwright, expect
OUT=Path('test-results/experience'); BUNDLE=Path('test-results/worker-documents-offline')
RECORD={'id':'doc-a','worker_id':'worker-a','customer_id':'customer-a','document_number':'WHQ-TEST','booking_id':'job-a','booking_code':'TEST-JOB','document_type':'quote','title':'Cabinet repair','items':[{'description':'Hinges and fitting','quantity':2,'unit_price':5000,'line_total':10000}], 'subtotal':10000,'total':10000,'currency':'NGN','document_status':'draft','payment_status':'not_applicable','payment_label':'Not applicable','note':'Sample job record, not a real customer'}
INSIGHTS={'completed_jobs':3,'released_earnings_ngn':10000,'active_jobs':1,'review_count':0,'repeat_customers':0,'worker_cancelled_jobs':0,'featured':{'signed_in_unique_impressions':0,'unique_profile_opens':0,'booking_requests':0},'definitions':{},'generated_at':'2026-09-25T00:00:00Z'}
async def main():
 subprocess.run(['node','tests/browser/build-worker-documents.mjs'],check=True);OUT.mkdir(parents=True,exist_ok=True);results=[]
 async with async_playwright() as p:
  options={'headless':True,'args':['--no-sandbox']}
  if os.getenv('CHROMIUM_PATH'):options['executable_path']=os.environ['CHROMIUM_PATH']
  browser=await p.chromium.launch(**options)
  for width in [320,390,768,1440]:
   for mode in ['expired','unknown','loading','active','doc-error','malformed','jobs-error','lapse','identity-switch']:
    context=await browser.new_context(viewport={'width':width,'height':844},service_workers='block',accept_downloads=True)
    page=await context.new_page();page.set_default_timeout(3000);errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    await page.route('**/*',lambda route:route.abort());row={'width':width,'mode':mode,'passed':False,'page_errors':errors}
    try:
     await page.set_content('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>')
     other={**RECORD,'worker_id':'other-worker','id':'not-ours','title':'Another worker private draft'}
     await page.evaluate('s=>window.__documents=s',{'mode':mode,'records':[RECORD,other],'insights':INSIGHTS,'calls':[],'pending':[],'failDocs':mode=='doc-error','malformed':mode=='malformed','failJobs':mode=='jobs-error'})
     await page.add_style_tag(path=str(BUNDLE/'fixture.css'));await page.add_script_tag(path=str(BUNDLE/'fixture.js'))
     active=mode in ['active','jobs-error','lapse']
     if active:await page.get_by_role('button',name='Quotes & invoices',exact=True).click()
     archive=page.get_by_role('region',name='Your work documents')
     await expect(archive).to_be_visible()
     if mode in ['doc-error','malformed']:
      await expect(archive.get_by_role('alert')).to_contain_text('could not be loaded')
      await expect(archive.get_by_text('No quotes or invoices yet.',exact=True)).to_have_count(0)
      await page.evaluate('Object.assign(window.__documents,{failDocs:false,malformed:false})')
      await archive.get_by_role('button',name='Retry records').click()
     await expect(archive.get_by_text('Cabinet repair',exact=True)).to_be_visible()
     await expect(archive.get_by_text('Another worker private draft',exact=True)).to_have_count(0)
     await archive.get_by_text('View details',exact=True).click()
     await expect(archive.get_by_text('Hinges and fitting',exact=False)).to_be_visible()
     if not active:
      assert not any(c['name']=='jobs' for c in await page.evaluate('window.__documents.calls'))
      for action in ['New document','Send to customer','Mark offline payment']:
       await expect(archive.get_by_role('button',name=action,exact=True)).to_have_count(0)
      async with page.expect_download() as download:
       await archive.get_by_role('button',name='Export',exact=True).click()
      file=await download.value;assert file.suggested_filename=='WHQ-TEST.txt'
      text=Path(await file.path()).read_text();assert 'Hinges and fitting' in text and '10000' in text.replace(',','')
      assert not any(c['name'].startswith(('save_','send_','mark_')) for c in await page.evaluate('window.__documents.calls'))
     if active:
      await archive.get_by_role('button',name='New document',exact=True).click()
      if mode=='jobs-error':
       await expect(archive.get_by_role('alert')).to_contain_text('Your jobs could not be loaded')
       await expect(archive.get_by_text('Cabinet repair',exact=True)).to_be_visible()
       await page.evaluate('window.__documents.failJobs=false')
       await archive.get_by_role('button',name='Retry jobs').click()
      await expect(archive.get_by_label('WeHouse job',exact=True)).to_be_enabled()
      await expect(archive.get_by_label('WeHouse job',exact=True)).to_have_value('')
      await expect(archive.get_by_role('button',name='Save draft',exact=True)).to_be_disabled()
      await archive.get_by_label('WeHouse job',exact=True).select_option('job-a')
      await archive.get_by_label('Title',exact=True).fill('Labour and materials')
      await archive.get_by_label('Line 1 description').fill('Materials I selected')
      await archive.get_by_label('Line 1 quantity').fill('2')
      await archive.get_by_label('Line 1 unit price').fill('5000')
      desc=await archive.get_by_label('Line 1 description').bounding_box()
      assert desc['width']>=width*.65 if width<400 else desc['width']>200
      await archive.get_by_role('button',name='Add item',exact=True).click()
      await archive.get_by_label('Line 2 description').fill('Labour I quoted')
      await archive.get_by_label('Line 2 unit price').fill('15000')
      await expect(archive.get_by_text('Total ₦25,000',exact=True)).to_be_visible()
      if mode=='lapse':
       await page.evaluate('window.__expire()')
       await expect(archive.get_by_role('button',name='Save draft',exact=True)).to_have_count(0)
       await expect(archive.get_by_text('Cabinet repair',exact=True)).to_be_visible()
       assert not any(c['name'].startswith(('save_','send_','mark_')) for c in await page.evaluate('window.__documents.calls'))
      else:
       if mode=='active':await page.screenshot(path=str(OUT/f'worker-quote-editor-{width}.png'),full_page=True)
       await archive.get_by_role('button',name='Save draft',exact=True).click()
       await expect(archive.get_by_role('button',name='New document',exact=True)).to_be_visible()
       writes=[c for c in await page.evaluate('window.__documents.calls') if c['name']=='save_my_worker_work_document']
       assert len(writes)==1 and writes[0]['args']['p_booking_id']=='job-a' and writes[0]['args']['p_items'][1]['unit_price']==15000
     if mode=='identity-switch':
      await page.evaluate('window.__switchWorker()')
      await expect(archive.get_by_text('Cabinet repair',exact=True)).to_have_count(0)
      await expect(archive.get_by_text('No quotes or invoices yet.',exact=True)).to_be_visible()
     if mode=='expired':await page.screenshot(path=str(OUT/f'worker-records-after-expiry-{width}.png'),full_page=True)
     assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
     assert not errors,errors;row['passed']=True
    except Exception as error:
     row['error']=str(error);await page.screenshot(path=str(OUT/f'worker-records-FAIL-{mode}-{width}.png'),full_page=True)
    finally:results.append(row);print(json.dumps(row),flush=True);await context.close()
  await browser.close()
 (OUT/'worker-documents-results.json').write_text(json.dumps(results,indent=2));assert all(r['passed'] for r in results)
asyncio.run(main())
