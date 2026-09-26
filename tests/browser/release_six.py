import asyncio,json,os,subprocess
from pathlib import Path
from playwright.async_api import async_playwright,expect
OUT=Path('test-results/experience');B=Path('test-results/release-six-offline')
async def main():
 subprocess.run(['node','tests/browser/build-release-six.mjs'],check=True);OUT.mkdir(parents=True,exist_ok=True);rows=[]
 async with async_playwright() as p:
  opts={'headless':True,'args':['--no-sandbox']}
  if os.getenv('CHROMIUM_PATH'):opts['executable_path']=os.environ['CHROMIUM_PATH']
  browser=await p.chromium.launch(**opts)
  for width in [390,1440]:
   for mode in ['management','security']:
    ctx=await browser.new_context(viewport={'width':width,'height':844},service_workers='block');page=await ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    await page.route('**/*',lambda route:route.abort());row={'width':width,'mode':mode,'passed':False}
    try:
     management={'listing_id':'11111111-1111-4111-8111-111111111111','management_mode':'host','wehouse_management_status':'not_required','management_host_user_id':'owner-a','assignments':[{'assignment_id':'a-owner','user_id':'owner-a','name':'Test Owner','username':'test-owner','role':'owner','status':'active'},{'assignment_id':'a-manager','user_id':'manager-b','name':'Bola Manager','username':'bola-manager','role':'manager','status':'active'}]}
     controls={'listing_id':'11111111-1111-4111-8111-111111111111','sub_type':'short_let','price':25000,'currency':'NGN','status':'available','availability_status':'available','host_booking_paused':False,'accepting_reservations':True,'min_nights':1,'max_nights':90,'date_blocks':[]}
     await page.set_content('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#090B10"><div id="root"></div></body></html>')
     await page.evaluate('x=>window.__releaseSix=x',{'mode':mode,'management':management,'controls':controls,'calls':[]})
     await page.add_style_tag(path=str(B/'fixture.css'));await page.add_script_tag(path=str(B/'fixture.js'))
     if mode=='management':
      await expect(page.get_by_role('heading',name='You manage this home',exact=True)).to_be_visible()
      await expect(page.get_by_text('You are responsible',exact=True)).to_be_visible()
      await expect(page.get_by_text('Bola Manager',exact=True)).to_be_visible()
      await expect(page.get_by_role('button',name='WeHouse manages',exact=False)).to_be_visible()
      await expect(page.get_by_text('Hosting controls',exact=True)).to_be_visible()
      await expect(page.get_by_role('button',name='Pause bookings',exact=True)).to_be_visible()
      await expect(page.get_by_label('Nightly price',exact=True)).to_have_value('25000')
      await page.get_by_label('Nightly price',exact=True).fill('30000')
      await page.get_by_role('button',name='Save',exact=True).click()
      await expect(page.get_by_text('₦30,000 per night',exact=True)).to_be_visible()
      await page.get_by_role('button',name='Pause bookings',exact=True).click()
      await expect(page.get_by_text('Bookings paused',exact=True)).to_be_visible()
      assert await page.evaluate("window.__releaseSix.calls.some(x=>x.name==='set_my_property_future_price')")
      assert await page.evaluate("window.__releaseSix.calls.some(x=>x.name==='set_my_property_booking_availability')")
     else:
      await expect(page.get_by_role('heading',name='Two-step verification',exact=True)).to_be_visible()
      await expect(page.get_by_role('button',name='Set up authenticator',exact=True)).to_be_visible()
      await expect(page.get_by_role('heading',name='Creator security password',exact=True)).to_be_visible()
      await expect(page.get_by_role('button',name='Create Creator security password',exact=True)).to_be_visible()
     assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
     assert not errors,errors
     await page.screenshot(path=str(OUT/f'release-six-{mode}-{width}.png'),full_page=True)
     row['passed']=True
    except Exception as e: row['error']=str(e);await page.screenshot(path=str(OUT/f'release-six-FAIL-{mode}-{width}.png'),full_page=True)
    finally: rows.append(row);print(json.dumps(row),flush=True);await ctx.close()
  await browser.close()
 (OUT/'release-six-results.json').write_text(json.dumps(rows,indent=2));assert all(r['passed'] for r in rows)
asyncio.run(main())
