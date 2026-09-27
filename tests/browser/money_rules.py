"""Actual Creator money editor with isolated RPC results; never uses live money or Auth."""
import asyncio, json, os, subprocess
from pathlib import Path
from playwright.async_api import async_playwright, expect
OUT=Path('test-results/experience'); BUNDLE=Path('test-results/money-rules-offline')
async def main():
 subprocess.run(['node','tests/browser/build-money-rules.mjs'],check=True)
 OUT.mkdir(parents=True,exist_ok=True); results=[]
 policy=json.loads(Path('tests/fixtures/booking-money-policy.json').read_text())
 async with async_playwright() as p:
  options={'headless':True,'args':['--no-sandbox']}
  if os.getenv('CHROMIUM_PATH'):options['executable_path']=os.environ['CHROMIUM_PATH']
  browser=await p.chromium.launch(**options)
  for width in [390,1440]:
   for mode in ['error','thrown','missing','partial','null-price','valid']:
    context=await browser.new_context(viewport={'width':width,'height':844},service_workers='block')
    page=await context.new_page();page.set_default_timeout(3000);errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    await page.route('**/*',lambda route:route.abort())
    row={'width':width,'mode':mode,'passed':False,'page_errors':errors}
    try:
     await page.set_content('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#090B10;color:white"><div id="root"></div></body></html>')
     await page.evaluate('([mode,policy])=>window.__moneyTest={mode,policy,calls:[],elevations:[]}',[mode,policy])
     await page.add_style_tag(path=str(BUNDLE/'fixture.css'));await page.add_script_tag(path=str(BUNDLE/'fixture.js'))
     if mode!='valid':
      await expect(page.get_by_role('alert')).to_contain_text('Your saved money rules could not be loaded')
      await expect(page.get_by_role('spinbutton')).to_have_count(0)
      await expect(page.get_by_role('button',name='Review & publish')).to_have_count(0)
      assert not await page.evaluate('window.__moneyTest.elevations.length')
      await page.evaluate('window.__moneyTest.mode="valid"')
      await page.get_by_role('button',name='Try again',exact=True).click()
     await expect(page.get_by_role('alert')).to_have_count(0)
     fee=page.get_by_label('Reservation payment',exact=False)
     await expect(fee).to_have_value('12345')
     await expect(page.get_by_role('button',name='Review & publish',exact=True)).to_be_disabled()
     assert not [c for c in await page.evaluate('window.__moneyTest.calls') if c['name']=='creator_publish_booking_money_rules']
     # A successful Retry allows the normal explicit, protected publication path.
     await fee.fill('13000')
     await page.get_by_placeholder('Why are these rules changing?').fill('Fixture-only policy review')
     await page.get_by_role('button',name='Review & publish',exact=True).click()
     await expect(fee).to_have_value('12345')
     assert await page.evaluate('window.__moneyTest.elevations')==['policy_publish']
     published=[c for c in await page.evaluate('window.__moneyTest.calls') if c['name']=='creator_publish_booking_money_rules']
     assert len(published)==1 and published[0]['args']['p_rules']['long_let']['reservation_amount']==13000
     assert published[0]['args']['p_creator_elevation_id']=='test-only-elevation'
     assert not errors,errors
     row['passed']=True
    except Exception as e:
     row['error']=str(e);await page.screenshot(path=str(OUT/f'money-rules-{mode}-{width}-failure.png'))
    finally:
     results.append(row);print(json.dumps(row),flush=True);await context.close()
  await browser.close()
 (OUT/'money-rules-results.json').write_text(json.dumps(results,indent=2))
 assert all(r['passed'] for r in results)
asyncio.run(main())
