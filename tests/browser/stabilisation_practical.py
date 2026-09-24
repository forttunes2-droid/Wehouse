"""Real UI components + API wrappers. Synthetic RPC responses are not live-provider acceptance."""
import asyncio,json,os,subprocess
from pathlib import Path
from playwright.async_api import async_playwright,expect
OUT=Path('test-results/experience');BUNDLE=Path('test-results/stabilisation-offline')
async def main():
 subprocess.run(['node','tests/browser/build-stabilisation-fixture.mjs'],check=True);OUT.mkdir(parents=True,exist_ok=True);results=[]
 async with async_playwright() as p:
  options={'headless':True,'args':['--no-sandbox']}
  if os.getenv('CHROMIUM_PATH'):options['executable_path']=os.environ['CHROMIUM_PATH']
  browser=await p.chromium.launch(**options)
  for width in [320,390,768,1440]:
   for mode in ['preferences','profile','publication-global','publication-worker','split','shared-guest']:
    context=await browser.new_context(viewport={'width':width,'height':844},service_workers='block',has_touch=True)
    page=await context.new_page();errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
    await page.route('**/*',lambda route:route.abort())
    row={'case':mode,'width':width,'passed':False,'page_errors':errors}
    try:
     await page.set_content('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#090B10"><div id="root"></div></body></html>')
     await page.evaluate('(mode)=>window.__practicalMode=mode',mode)
     await page.add_style_tag(path=str(BUNDLE/'fixture.css'));await page.add_script_tag(path=str(BUNDLE/'fixture.js'))
     if mode=='preferences':
      await expect(page.get_by_role('heading',name='Roommate preferences')).to_be_visible()
      form=await page.evaluate('window.__getForm()');assert all(form[x]=='' for x in ['preferred_state','preferred_lga','cleanliness','noise_level','visitors','move_in_mode','room_arrangement'])
      assert form['school_name']=='Example Polytechnic' and not form['school_match']
      await page.get_by_label('Preferred State',exact=True).select_option('Nasarawa');await page.get_by_label('Preferred LGA',exact=True).select_option('Lafia')
      await page.get_by_role('button',name='Anyone',exact=True).click()
      await page.get_by_label('Minimum annual rent share').fill('300000');await page.get_by_label('Maximum annual rent share').fill('500000')
      await page.get_by_label('When would you like to move?',exact=True).select_option('flexible')
      await page.get_by_label('What would you share?',exact=True).select_option('separate_bedrooms')
      await page.get_by_role('switch',name='Same-school matching').click();await expect(page.get_by_role('switch')).to_be_checked()
      await page.screenshot(path=str(OUT/f'roommate-housing-{width}.png'),full_page=True)
      await page.get_by_role('button',name='Continue',exact=True).click()
      assert not await page.evaluate('Boolean(window.__savedForm)')
      await page.get_by_role('group',name='Do you smoke?',exact=True).get_by_role('button',name='No',exact=True).click()
      await page.get_by_role('group',name='Would you live with someone who smokes?',exact=True).get_by_role('button',name='Only outside',exact=True).click()
      await page.get_by_label('How often you have visitors',exact=True).select_option('rarely')
      await page.get_by_label('Overnight visitors',exact=True).select_option('agreement')
      await page.get_by_role('button',name='Back',exact=True).click()
      assert (await page.evaluate('window.__getForm()'))['smoking_preference']=='outdoors'
      await page.get_by_role('button',name='Continue',exact=True).click()
      await page.screenshot(path=str(OUT/f'roommate-living-{width}.png'),full_page=True)
      await page.get_by_role('button',name='Continue',exact=True).click()
      await expect(page.get_by_role('heading',name='Review',exact=True)).to_be_visible()
      await page.get_by_role('button',name='Save preferences',exact=True).click();await expect(page.get_by_role('status')).to_contain_text('saved')
      saved=await page.evaluate('window.__savedForm');assert saved['preferred_lga']=='Lafia' and saved['school_match'] and saved['budget_max']==500000 and saved['cleanliness']=='' and saved['overnight_visitors']=='agreement'
      await page.evaluate('scrollTo(0,0)')
     elif mode=='profile':
      await expect(page.get_by_text('Discuss before deciding',exact=True)).to_have_count(1)
      await expect(page.get_by_text('75%',exact=True)).to_be_visible()
      assert await page.get_by_text('Example Polytechnic',exact=True).count()==0
     elif mode.startswith('publication'):
      await expect(page.get_by_role('button',name='Open customer discovery' if mode=='publication-global' else 'Pause publication',exact=True)).to_be_disabled()
      before=await page.evaluate('window.__practicalTransport.calls');assert all(x['name']=='creator_get_worker_publication' for x in before)
      await page.get_by_label('Reason for this change',exact=True).fill('Reviewed launch decision' if mode=='publication-global' else 'Pause while details are reviewed')
      await page.get_by_role('button',name='Open customer discovery' if mode=='publication-global' else 'Pause publication',exact=True).click()
      await expect(page.get_by_role('status')).to_contain_text('saved')
      state=await page.evaluate('window.__practicalTransport');assert state['elevations']==['all_sensitive'];assert state['enabled'] if mode=='publication-global' else state['paused']
      call=[x for x in state['calls'] if x['name'].startswith('creator_set')];assert len(call)==1 and call[0]['args']['p_creator_elevation_id']=='test-elevation'
     elif mode=='split':
      await page.get_by_role('button',name='Split costs with connections',exact=True).click()
      await expect(page.get_by_label('Invite Bola Example')).to_be_visible();assert await page.get_by_label('Invite Pending Example').count()==0 and await page.get_by_label('Invite Blocked Example').count()==0
      await page.get_by_label('Invite Bola Example').check();await page.get_by_label('Invite Chika Example').check()
      await expect(page.get_by_text('You: ₦500',exact=True)).to_be_visible()
      assert not any(x['name']=='create_my_shared_short_let' for x in await page.evaluate('window.__practicalTransport.calls'))
      await page.screenshot(path=str(OUT/f'short-let-shares-before-invitation-{width}.png'),full_page=True)
      await page.get_by_role('button',name='Send cost-sharing invitation',exact=True).click();await expect(page.get_by_role('dialog',name='Shared payment')).to_be_visible()
      result=await page.evaluate('window.__createdGroup');assert result['reservation_id']=='reservation-existing'
      assert not any(x['name'] in ['payment-init','create_my_shared_housing_payment'] for x in await page.evaluate('window.__practicalTransport.calls'))
      await expect(page.get_by_role('button',name='Open reservation',exact=True)).to_be_visible();await page.get_by_role('button',name='Open reservation',exact=True).click();assert await page.evaluate('window.__openedBooking')=='reservation-existing'
     else:
      await expect(page.get_by_role('dialog',name='Shared payment')).to_be_visible()
      assert await page.get_by_role('button',name='Pay my share').count()==0
      await page.get_by_role('button',name='Accept my share',exact=True).click();await expect(page.get_by_role('button',name='Accept my share',exact=True)).to_have_count(0)
      assert await page.get_by_role('button',name='Pay my share').count()==0
      await page.evaluate('window.__practicalTransport.allAccepted=true');await page.get_by_role('button',name='Refresh',exact=True).click()
      await expect(page.get_by_role('button',name='Pay my share · ₦500',exact=True)).to_be_visible()
      await page.get_by_role('button',name='Pay my share · ₦500',exact=True).click();await page.wait_for_timeout(100)
      calls=await page.evaluate('window.__practicalTransport.calls');assert len([x for x in calls if x['name']=='payment-init'])==1
      await page.evaluate('window.__practicalTransport.denied=true');await page.get_by_role('button',name='Refresh',exact=True).click()
      await expect(page.get_by_role('alert')).to_be_visible();assert await page.get_by_text('Courtyard Short Let',exact=True).count()==0
      await page.evaluate('window.__practicalTransport.denied=false');await page.get_by_role('button',name='Refresh shared payment',exact=True).click();await expect(page.get_by_text('Courtyard Short Let',exact=True)).to_be_visible()
     assert not errors;assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
     await page.screenshot(path=str(OUT/f'stabilisation-{mode}-{width}.png'),full_page=True)
     if mode in ['split','shared-guest']:
      await page.get_by_role('button',name='Back from shared payment',exact=True).click();await expect(page.get_by_role('dialog',name='Shared payment')).to_have_count(0)
      assert await page.evaluate('window.__closed')
     row['passed']=True
    except Exception as error:
     row['error']=str(error);await page.screenshot(path=str(OUT/f'FAIL-stabilisation-{mode}-{width}.png'),full_page=True)
    finally:results.append(row);await context.close()
  await browser.close()
 (OUT/'stabilisation-practical-results.json').write_text(json.dumps(results,indent=2));print(json.dumps(results,indent=2));assert all(x['passed'] for x in results)
asyncio.run(main())
