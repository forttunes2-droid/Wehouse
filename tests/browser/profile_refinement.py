"""Production UI/hooks with isolated API fixtures: not real customer data or production writes."""
import asyncio,base64,json,os,subprocess
from pathlib import Path
from playwright.async_api import async_playwright,expect
OUT=Path('test-results/experience');BUNDLE=Path('test-results/profile-refinement-offline')
async def swipe(page,target,dy):
 box=await target.bounding_box();assert box
 x=box['x']+box['width']/2;y=box['y']+box['height']/2
 session=await page.context.new_cdp_session(page)
 await session.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':x,'y':y}]})
 for i in range(1,9):await session.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':[{'x':x,'y':y+dy*i/8}]})
 await session.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]});await session.detach();await page.wait_for_timeout(120)
async def main():
 subprocess.run(['node','tests/browser/build-profile-refinement.mjs'],check=True);OUT.mkdir(parents=True,exist_ok=True);results=[]
 async with async_playwright() as p:
  opts={'headless':True,'args':['--no-sandbox']}
  if os.getenv('CHROMIUM_PATH'):opts['executable_path']=os.environ['CHROMIUM_PATH']
  browser=await p.chromium.launch(**opts)
  for width in [320,390,768,1440]:
   for mode in ['public','owner','owner-link','private','error','media-error','stale','help','help-error','help-wrong-user']:
    context=await browser.new_context(viewport={'width':width,'height':844},has_touch=True,service_workers='block');page=await context.new_page();page.set_default_timeout(6000)
    errors=[];page.on('pageerror',lambda e:errors.append(str(e)));row={'case':mode,'width':width,'passed':False,'page_errors':errors}
    async def route(handler):
     if handler.request.url=='https://assets.wehouse.test/work.jpg':return await handler.fulfill(status=200,content_type='image/jpeg',body=Path('public/hero-interior.jpg').read_bytes())
     return await handler.abort()
    await page.route('**/*',route)
    try:
     await page.set_content('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#090B10"><div id="root"></div></body></html>')
     await page.evaluate('([mode,video])=>{window.__refinementMode=mode;window.__demoVideo="data:video/webm;base64,"+video}',[mode,Path('tests/browser/demo-work.webm.b64').read_text()])
     await page.add_style_tag(path=str(BUNDLE/'fixture.css'));await page.add_script_tag(path=str(BUNDLE/'fixture.js'))
     tiles=page.locator('[data-showcase-grid] > button')
     if mode=='public':
      await expect(page.get_by_role('heading',name='Sani Example',exact=True)).to_be_visible();await expect(tiles).to_have_count(24)
      assert 'Hidden' not in await page.locator('[data-showcase-grid]').inner_text()
      assert await page.locator('video').evaluate_all('(v)=>v.every(e=>e.paused)')
      await page.screenshot(path=str(OUT/f'worker-public-profile-{width}.png'))
      await page.get_by_role('tab',name='Reviews',exact=True).click();await expect(page.get_by_text('Careful work and a tidy finish.',exact=True)).to_be_visible()
      assert await page.locator('[data-showcase-grid]').count()==0
      await page.get_by_role('tab',name='Reviews',exact=True).press('ArrowLeft');await expect(page.get_by_role('tab',name='Work posts')).to_be_focused()
      await tiles.nth(0).click();viewer=page.get_by_role('dialog',name='Sani Example work post',exact=True);await expect(viewer).to_be_visible()
      await expect(viewer.get_by_text('1 / 24',exact=True)).to_be_visible()
      await viewer.get_by_role('button',name='Next work post',exact=True).click();await expect(viewer.get_by_text('2 / 24',exact=True)).to_be_visible()
      await page.wait_for_function('!!document.querySelector("[data-showcase-stage] video") && document.querySelector("[data-showcase-stage] video").readyState>=2')
      assert await viewer.locator('video').count()==1
      await page.screenshot(path=str(OUT/f'worker-post-viewer-{width}.png'))
      await viewer.get_by_role('button',name='Open comments',exact=True).click();await expect(page.get_by_role('region',name='Work post comments')).to_be_visible()
      assert await viewer.locator('video').evaluate('(v)=>v.paused')
      await page.get_by_label('Add a comment',exact=True).fill('Is this finish available in oak?');await page.get_by_role('button',name='Post',exact=True).click()
      await expect(page.get_by_text('Is this finish available in oak?',exact=True)).to_be_visible()
      await page.get_by_role('button',name='Back to work post',exact=True).click();await expect(viewer.get_by_role('button',name='Open comments')).to_be_focused()
      await swipe(page,page.locator('[data-showcase-stage]'),-100);await expect(viewer.get_by_text('3 / 24',exact=True)).to_be_visible()
      await swipe(page,page.locator('[data-showcase-stage]'),100);await expect(viewer.get_by_text('2 / 24',exact=True)).to_be_visible()
      await page.get_by_role('button',name='Back to work posts',exact=True).click();await expect(viewer).to_have_count(0)
      await expect(tiles.nth(0)).to_be_focused()
      await page.get_by_role('button',name='Show more work',exact=True).click();await expect(tiles).to_have_count(27)
      assert len(set(await tiles.evaluate_all('(els)=>els.map(e=>e.getAttribute("aria-label"))')))==27
     elif mode=='owner':
      await expect(tiles).to_have_count(24);await page.get_by_label('Post visibility',exact=True).select_option('hidden');await expect(tiles).to_have_count(1)
      assert not any(x['name']=='set_my_worker_work_post_hidden' for x in await page.evaluate('window.__fixtureState.calls'))
      await page.get_by_label('Post visibility',exact=True).select_option('all');await page.screenshot(path=str(OUT/f'worker-own-showcase-{width}.png'))
      await tiles.nth(0).click();await page.get_by_label('Post options',exact=True).click();await page.get_by_role('button',name='Hide from profile',exact=True).click()
      await expect(page.get_by_role('dialog',name='Sani Example work post')).to_have_count(0)
      assert len([x for x in await page.evaluate('window.__fixtureState.calls') if x['name']=='set_my_worker_work_post_hidden'])==1
      await page.locator('input[type=file]').set_input_files({'name':'work.jpg','mimeType':'image/jpeg','buffer':Path('public/hero-interior.jpg').read_bytes()})
      await expect(page.get_by_role('dialog',name='New work post')).to_be_visible()
      await page.get_by_placeholder('Describe this work').fill('Sample cabinet fitting')
      await expect(page.get_by_label('Link completed job')).to_be_visible()
      await page.screenshot(path=str(OUT/f'worker-new-post-{width}.png'))
      await page.get_by_role('button',name='Close preview',exact=True).click();await expect(page.get_by_role('dialog',name='New work post')).to_have_count(0)
      assert not any(x['name']=='create_my_worker_showcase_post' for x in await page.evaluate('window.__fixtureState.calls'))
     elif mode=='owner-link':
      await expect(page.get_by_role('dialog',name='Sani Example work post')).to_be_visible();await expect(page.get_by_text('Work sample 27',exact=True)).to_be_visible()
      await page.get_by_role('button',name='Back to work posts',exact=True).click();await expect(tiles).to_have_count(24)
     elif mode=='private':
      await expect(page.get_by_text('Conversation info',exact=True)).to_be_visible();await page.wait_for_timeout(100)
      assert await page.evaluate('window.__fixtureState.calls.length')==0
      assert await page.get_by_role('tab',name='Work posts').count()==0;assert await page.get_by_text('About',exact=True).count()==0
     elif mode=='error':
      await expect(page.get_by_text('Profile totals are unavailable.',exact=False)).to_be_visible();await expect(page.get_by_role('alert')).to_be_visible()
      assert await page.get_by_text('0 completed jobs',exact=True).count()==0;assert await page.get_by_text('No published work posts yet.',exact=True).count()==0
      await page.get_by_role('tab',name='Reviews').click();await expect(page.get_by_role('alert')).to_contain_text('Reviews could not be loaded')
      assert await page.get_by_text('No customer reviews yet.',exact=True).count()==0
      await page.evaluate('Object.assign(window.__fixtureState,{failReviews:false,failTrust:false,failPosts:false})')
      await page.get_by_role('alert').get_by_role('button',name='Try again').click();await expect(page.get_by_text('Careful work and a tidy finish.',exact=True)).to_be_visible()
      await page.get_by_role('tab',name='Work posts').click();await page.get_by_role('alert').get_by_role('button',name='Try again').click();await expect(tiles).to_have_count(24)
     elif mode=='media-error':
      await expect(tiles).to_have_count(24);await tiles.nth(0).click();await expect(page.get_by_text('This media could not be loaded.',exact=True)).to_be_visible()
      await page.evaluate('window.__fixtureState.failMedia=false');await page.get_by_role('dialog',name='Sani Example work post').get_by_role('button',name='Try again').click()
      await expect(page.get_by_alt_text('Sani Example work',exact=True)).to_be_visible()
     elif mode=='stale':
      await page.wait_for_function('window.__fixtureState.pending.length>0')
      await page.evaluate('window.__switchWorker()');await expect(page.get_by_role('heading',name='Chika Example')).to_be_visible();await expect(tiles).to_have_count(24)
      await page.evaluate('window.__fixtureState.pending.forEach(resolve=>resolve())');await page.wait_for_timeout(100)
      await tiles.nth(0).click();await expect(page.get_by_role('dialog',name='Chika Example work post')).to_be_visible();assert await page.get_by_role('heading',name='Sani Example').count()==0
      calls=await page.evaluate('window.__fixtureState.calls');assert any(x.get('worker')=='worker-b' for x in calls)
     elif mode=='help':
      await page.get_by_role('button',name='Property or stay').click();await expect(page.get_by_text('Garden Lodge',exact=True)).to_be_visible()
      assert await page.get_by_text('Cancelled test stay',exact=True).count()==0;assert 'Record 12345678' not in await page.locator('body').inner_text()
      await page.screenshot(path=str(OUT/f'help-current-records-{width}.png'))
      await page.get_by_label('Records to show',exact=True).select_option('all');await expect(page.get_by_text('Cancelled test stay',exact=True)).to_be_visible()
      await page.get_by_placeholder('Search your records').fill('Garden');await page.get_by_role('radio').check();await page.get_by_role('button',name='Message WeHouse',exact=True).click()
      assert (await page.evaluate('window.__helpEvent'))['contextId']=='stay-current'
      await page.get_by_role('button',name='Back',exact=True).click();await page.get_by_role('button',name='Payments and refunds').click()
      await expect(page.get_by_text('Refund under review',exact=True)).to_be_visible();assert await page.get_by_label('Records to show').count()==0
      assert await page.get_by_text('Cancelled test stay',exact=True).count()==0
     elif mode.startswith('help-'):
      await expect(page.get_by_role('alert')).to_contain_text("couldn't load")
      assert await page.get_by_text('Garden Lodge',exact=True).count()==0
      await page.evaluate('Object.assign(window.__fixtureState,{failHelp:false,wrongAccount:false})')
      await page.get_by_role('button',name='Try again',exact=True).click();await expect(page.get_by_role('button',name='Property or stay')).to_be_visible()
     assert not errors,errors
     assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
     row['passed']=True
    except Exception as e:
     row['error']=str(e);await page.screenshot(path=str(OUT/f'FAIL-refinement-{mode}-{width}.png'))
    finally:results.append(row);print(json.dumps(row),flush=True);await context.close()
  await browser.close()
 (OUT/'profile-refinement-results.json').write_text(json.dumps(results,indent=2));print(json.dumps(results,indent=2));assert all(row['passed'] for row in results)
asyncio.run(main())
