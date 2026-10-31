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
     operating=page.get_by_role('region',name='Booking operating rules',exact=True)
     if mode!='valid':
      await expect(operating.get_by_role('alert')).to_contain_text('Your saved money rules could not be loaded')
      await expect(operating.get_by_role('spinbutton')).to_have_count(0)
      await expect(operating.get_by_role('button',name='Review & publish')).to_have_count(0)
      assert not await page.evaluate('window.__moneyTest.elevations.length')
      await page.evaluate('window.__moneyTest.mode="valid"')
      await operating.get_by_role('button',name='Try again',exact=True).click()
     await expect(operating.get_by_role('alert')).to_have_count(0)
     fee=operating.get_by_label('Reservation payment',exact=False)
     await expect(fee).to_have_value('12345')
     await expect(page.get_by_role('button',name='Review & publish',exact=True)).to_be_disabled()
     assert not [c for c in await page.evaluate('window.__moneyTest.calls') if c['name']=='creator_publish_booking_money_rules_v4']
     # A successful Retry allows the normal explicit, protected publication path.
     await fee.fill('13000')
     await page.get_by_placeholder('Why are these rules changing?').fill('Fixture-only policy review')
     await page.get_by_role('button',name='Review & publish',exact=True).click()
     await expect(fee).to_have_value('12345')
     assert await page.evaluate('window.__moneyTest.elevations')==['policy_publish']
     published=[c for c in await page.evaluate('window.__moneyTest.calls') if c['name']=='creator_publish_operating_money_rules']
     assert len(published)==1 and published[0]['args']['p_rules']['long_let']['reservation_amount']==13000
     assert published[0]['args']['p_creator_elevation_id']=='test-only-elevation'
     assert published[0]['args']['p_expected_digest']=='a'*64
     # Commission controls publish without requiring unrelated timing policies.
     rent=page.get_by_role('region',name='Later-year rent collection policy',exact=True)
     await expect(rent.get_by_role('checkbox')).not_to_be_checked()
     await rent.get_by_role('checkbox').check()
     await expect(rent.get_by_role('button',name='Confirm rent collection policy',exact=True)).to_be_disabled()
     await rent.get_by_label('Collection policy reason',exact=True).fill('Synthetic Test collection verification')
     await page.evaluate('window.__moneyTest.loseRent=true')
     await rent.get_by_role('button',name='Confirm rent collection policy',exact=True).click()
     await expect(rent.get_by_role('alert')).to_contain_text('Synthetic lost rent policy response')
     await expect(rent.get_by_role('button',name='Confirm rent collection policy',exact=True)).to_be_disabled()
     await rent.get_by_role('button',name='Refresh collection policy',exact=True).click()
     await expect(rent.get_by_role('alert')).to_have_count(0)
     await expect(rent.get_by_role('checkbox')).to_be_checked()
     rent_calls=[c for c in await page.evaluate('window.__moneyTest.calls') if c['name']=='creator_set_later_rent_collection']
     assert len(rent_calls)==1 and rent_calls[0]['args']['p_expected_policy_version_id']=='b7990000-4000-4000-8000-000000000099' and rent_calls[0]['args']['p_enabled'] is True
     commissions=page.get_by_role('region',name='Platform commissions',exact=True)
     await commissions.get_by_role('button',name='Refresh commissions',exact=True).click()
     await commissions.get_by_label('Short Let additional management',exact=False).fill('3')
     await commissions.get_by_label('Commission change reason',exact=True).fill('Fixture-only fee decision')
     await commissions.get_by_role('button',name='Confirm and publish commissions',exact=True).click()
     await expect(commissions.get_by_role('status')).to_contain_text('Commission changes recorded')
     fee_commands=[c for c in await page.evaluate('window.__moneyTest.calls') if c['name']=='creator_publish_booking_money_rules_v4']
     assert len(fee_commands)==1 and list(fee_commands[0]['args']['p_rules'])==['commissions']
     assert fee_commands[0]['args']['p_rules']['commissions']['short_let_wehouse_percent']==policy['active']['commission_short_let']['value']['percent']+3
     experience=page.get_by_role('region',name='Activity commission',exact=True)
     await expect(experience.get_by_text('Not configured. No commission rate has been assumed.',exact=True)).to_be_visible()
     await experience.get_by_label('WeHouse commission (%)',exact=True).fill('9.25')
     await experience.get_by_label('Reason for change',exact=True).fill('Fixture-only Activity commission')
     await experience.get_by_role('button',name='Confirm and publish commission',exact=True).click()
     await expect(experience.get_by_text('Published: 9.25% - Version 1',exact=True)).to_be_visible()
     commands=[c for c in await page.evaluate('window.__moneyTest.calls') if c['name']=='creator_publish_experience_commission']
     assert len(commands)==1 and commands[0]['args']['p_percent']==9.25 and commands[0]['args']['p_expected_version']==0
     assert not errors,errors
     row['passed']=True
    except Exception as e:
     row['error']=str(e);await page.screenshot(path=str(OUT/f'money-rules-{mode}-{width}-failure.png'))
    finally:
     results.append(row);print(json.dumps(row),flush=True);await context.close()
  for theme in ('light','dark'):
   for screen in ('fee-disclosure','fee-existing'):
    context=await browser.new_context(viewport={'width':390,'height':844},service_workers='block');page=await context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)));await page.route('**/*',lambda route:route.abort())
    fee={'available':True,'product':'short_let','management_mode':'wehouse','base_policy_version_id':'92000000-0000-4000-8000-000000000001','policy_version_id':'92000000-0000-4000-8000-000000000002','base_percent':10,'management_percent':3,'total_percent':13,'deducted_from':'provider_earnings','basis':'accommodation_value','digest':'b'*64}
    await page.set_content('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>')
    await page.evaluate('([screen,fee,theme])=>{document.documentElement.dataset.whTheme=theme;document.documentElement.classList.toggle("dark",theme==="dark");window.__moneyTest={screen,fee,calls:[],elevations:[],loseAccept:true}}',[screen,fee,theme]);await page.add_style_tag(path=str(BUNDLE/'fixture.css'));await page.add_script_tag(path=str(BUNDLE/'fixture.js'))
    await expect(page.get_by_text('13%',exact=True)).to_be_visible();await expect(page.get_by_role('checkbox')).not_to_be_checked();await page.get_by_role('checkbox').check()
    if screen=='fee-disclosure':
     await expect(page.get_by_text('₦87,000.00',exact=True)).to_be_visible();assert await page.evaluate('window.__moneyTest.acceptedDigest')=='b'*64
     await page.evaluate('Object.assign(window.__moneyTest.fee,{management_percent:4,total_percent:14,digest:"c".repeat(64)})');await page.get_by_role('button',name='Refresh fees',exact=True).click();await expect(page.get_by_text('14%',exact=True)).to_be_visible();await expect(page.get_by_role('checkbox')).not_to_be_checked();assert await page.evaluate('window.__moneyTest.acceptedDigest') is None
    else:
     await page.get_by_role('button',name='Accept current property fees',exact=True).click();await expect(page.get_by_role('alert')).to_contain_text('Synthetic lost acceptance response');await page.get_by_role('button',name='Refresh fees',exact=True).click();await expect(page.get_by_text('Your acceptance of these rates is recorded.',exact=False)).to_be_visible();await expect(page.get_by_role('checkbox')).to_be_checked();await expect(page.get_by_role('checkbox')).to_be_disabled();assert len([c for c in await page.evaluate('window.__moneyTest.calls') if c['name']=='accept_my_property_fees'])==1
    assert not errors,errors;await page.screenshot(path=str(OUT/f'{screen}-{theme}.png'),full_page=True);results.append({'screen':screen,'theme':theme,'passed':True,'page_errors':errors});await context.close()
  await browser.close()
 (OUT/'money-rules-results.json').write_text(json.dumps(results,indent=2))
 assert all(r['passed'] for r in results)
asyncio.run(main())
