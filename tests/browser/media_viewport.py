"""Actual media viewer, real multi-touch and native viewport scaling.
Synthetic photo URL only. No live API, customer data or page-zoom restriction.
"""
import asyncio,json,os,subprocess
from pathlib import Path
from playwright.async_api import async_playwright,expect
OUT=Path('test-results/experience');BUNDLE=Path('test-results/media-viewport-offline')
async def touches(session,kind,points):
 await session.send('Input.dispatchTouchEvent',{'type':kind,'touchPoints':[{'x':x,'y':y,'id':i} for i,x,y in points]})
async def swipe(session, box, dx, dy=0, cancel=False):
 x=box['x']+box['width']/2;y=box['y']+box['height']/2
 await touches(session,'touchStart',[(1,x,y)])
 for i in range(1,7):
  await touches(session,'touchMove',[(1,x+dx*i/6,y+dy*i/6)])
 await touches(session,'touchCancel' if cancel else 'touchEnd',[])
 await asyncio.sleep(.08)

async def mixed_gallery(browser,width):
 context=await browser.new_context(viewport={'width':width,'height':844},has_touch=True,service_workers='block')
 page=await context.new_page();page.set_default_timeout(6000);errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 row={'case':'mixed-gallery','width':width,'passed':False,'page_errors':errors};phase='start'
 async def route(handler):
  if handler.request.url.endswith('/broken.jpg'):return await handler.fulfill(status=404,body='Not found')
  if handler.request.url.startswith('https://assets.wehouse.test/'):return await handler.fulfill(status=200,content_type='image/jpeg',body=Path('public/hero-interior.jpg').read_bytes())
  return await handler.abort()
 await page.route('**/*',route)
 try:
  await page.set_content('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><div id="root"></div></body></html>')
  await page.evaluate('(clip)=>{window.__mediaMode="mixed";window.__galleryVideo="data:video/webm;base64,"+clip}',Path('tests/browser/demo-work.webm.b64').read_text())
  await page.add_style_tag(path=str(BUNDLE/'fixture.css'));await page.add_script_tag(path=str(BUNDLE/'fixture.js'))
  await page.get_by_role('button',name='View profile photo').click()
  viewer=page.get_by_role('dialog',name='Profile photo',exact=True);stage=page.locator('[data-media-stage]')
  await expect(viewer).to_have_attribute('data-media-count','4')
  await page.wait_for_function('document.querySelector("[data-photo-stage] img")?.naturalWidth>0')
  assert await viewer.locator('[data-media-paging-action]').evaluate_all('(nodes)=>nodes.every(node=>node.getBoundingClientRect().width<=1)')
  assert '‹' not in await viewer.inner_text() and '›' not in await viewer.inner_text()
  session=await context.new_cdp_session(page)
  phase='image swipe enters video'
  await swipe(session,await stage.bounding_box(),-110)
  await expect(viewer).to_have_attribute('data-media-index','1')
  video=viewer.locator('video');await expect(video).to_have_count(1)
  await page.wait_for_function('document.querySelector("video")?.readyState>=2')
  # Retain the media node solely to prove it stops playing after navigation.
  await video.evaluate('(node)=>window.__previousVideo=node')
  phase='ordinary tap and timeline are not paging'
  # This fixture clip is only one second; loop it so natural ending cannot
  # race the normal pause/play tap being asserted.
  await video.evaluate('async(node)=>{node.loop=true;await node.play()}')
  await viewer.locator('[data-media-toggle]').tap()
  await page.wait_for_function('document.querySelector("video").paused')
  await viewer.locator('[data-media-toggle]').tap()
  await page.wait_for_function('!document.querySelector("video").paused')
  await expect(viewer).to_have_attribute('data-media-index','1')
  slider=viewer.get_by_role('slider',name='Video position')
  await swipe(session,await slider.bounding_box(),min(50,width/10))
  await expect(viewer).to_have_attribute('data-media-index','1')
  phase='cancelled, diagonal and multi-touch cannot change media'
  await swipe(session,await stage.bounding_box(),-110,cancel=True)
  await expect(viewer).to_have_attribute('data-media-index','1')
  await swipe(session,await stage.bounding_box(),-60,120)
  await expect(viewer).to_have_attribute('data-media-index','1')
  box=await stage.bounding_box();x=box['x']+box['width']/2;y=box['y']+box['height']/2
  await touches(session,'touchStart',[(1,x-45,y),(2,x+45,y)])
  for dx in [20,40,60,85]:await touches(session,'touchMove',[(1,x-45-dx,y),(2,x+45-dx,y)])
  await touches(session,'touchEnd',[])
  await expect(viewer).to_have_attribute('data-media-index','1')
  phase='video and missing image both allow paging'
  await swipe(session,await stage.bounding_box(),-110)
  await expect(viewer).to_have_attribute('data-media-index','2')
  await expect(viewer.get_by_text('This media could not be loaded',exact=True)).to_be_visible()
  assert await page.evaluate('window.__previousVideo.paused')
  await swipe(session,await stage.bounding_box(),-110)
  await expect(viewer).to_have_attribute('data-media-index','3')
  await page.wait_for_function('document.querySelector("[data-photo-stage] img")?.naturalWidth>0')
  await expect(page.locator('[data-photo-stage]')).to_have_attribute('data-image-scale','1')
  await swipe(session,await stage.bounding_box(),-110)
  await expect(viewer).to_have_attribute('data-media-index','3')
  await page.screenshot(path=str(OUT/f'gallery-gesture-only-{width}.png'))
  phase='keyboard and assistive actions remain available'
  await page.locator('[data-photo-stage]').focus()
  await page.keyboard.press('Tab')
  previous=viewer.get_by_role('button',name='Previous media',exact=True)
  await expect(previous).to_be_focused()
  box=await previous.bounding_box();assert box and box['width']>=44
  await page.keyboard.press('Enter');await expect(viewer).to_have_attribute('data-media-index','2')
  # No additional page, account state, conversation or network mutation.
  assert await page.evaluate('document.getElementById("root").inert')
  await viewer.get_by_role('button',name='Close media preview').click()
  await expect(viewer).to_have_count(0)
  assert not await page.evaluate('document.getElementById("root").inert')
  assert not errors,errors
  row.update(passed=True,checks=['no visible paging arrows','image/video/error/gallery boundaries','seek/tap/multi-touch/cancel separation','previous video stops','keyboard/assistive action preserved','opaque background and close'])
 except Exception as error:
  row.update(error=str(error),phase=phase);await page.screenshot(path=str(OUT/f'mixed-gallery-FAIL-{width}.png'))
 finally:print(json.dumps(row),flush=True);await context.close()
 return row

async def main():
 subprocess.run(['node','tests/browser/build-media-viewport.mjs'],check=True);OUT.mkdir(parents=True,exist_ok=True);results=[]
 async with async_playwright() as p:
  opts={'headless':True,'args':['--no-sandbox']}
  if os.getenv('CHROMIUM_PATH'):opts['executable_path']=os.environ['CHROMIUM_PATH']
  browser=await p.chromium.launch(**opts)
  for width,height in [(320,640),(390,844),(768,900),(1440,900)]:
   context=await browser.new_context(viewport={'width':width,'height':height},has_touch=True,service_workers='block');page=await context.new_page();page.set_default_timeout(6000);errors=[];page.on('pageerror',lambda e:errors.append(str(e)));checks=[];phase='open'
   async def route(handler):
    if handler.request.url.startswith('https://assets.wehouse.test/'):return await handler.fulfill(status=200,content_type='image/jpeg',body=Path('public/hero-interior.jpg').read_bytes())
    return await handler.abort()
   await page.route('**/*',route)
   try:
    await page.set_content('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><div id="root"></div></body></html>')
    await page.add_style_tag(path=str(BUNDLE/'fixture.css'));await page.add_script_tag(path=str(BUNDLE/'fixture.js'))
    opener=page.get_by_role('button',name='View profile photo');await opener.click();viewer=page.get_by_role('dialog',name='Profile photo',exact=True);await expect(viewer).to_be_visible()
    await page.wait_for_function('document.querySelector("[data-photo-stage] img")?.naturalWidth>0')
    await expect(page.get_by_role('button',name='Close media preview')).to_be_focused()
    assert await page.evaluate('document.getElementById("root").inert')
    assert await viewer.evaluate('(e)=>getComputedStyle(e).backgroundColor')=='rgb(0, 0, 0)'
    assert '%' not in await viewer.inner_text()
    checks.append('opaque viewer, no zoom calculation and background interaction isolation')
    await expect(page.get_by_role('group',name='Photo controls')).to_have_count(0)
    await expect(page.get_by_role('button',name='Zoom in',exact=True)).to_have_count(0)
    await expect(page.get_by_role('button',name='Zoom out',exact=True)).to_have_count(0)
    assert '%' not in await viewer.inner_text()
    stage=page.locator('[data-photo-stage]');box=await stage.bounding_box();x=box['x']+box['width']/2;y=box['y']+box['height']/2
    session=await context.new_cdp_session(page)
    await touches(session,'touchStart',[(1,x-35,y),(2,x+35,y)])
    for distance in [45,65,85,105]:await touches(session,'touchMove',[(1,x-distance,y),(2,x+distance,y)])
    await touches(session,'touchEnd',[]);await page.wait_for_timeout(70)
    assert float(await stage.get_attribute('data-image-scale'))>2.5
    await touches(session,'touchStart',[(1,x,y)])
    for dy in [20,40,60,80]:await touches(session,'touchMove',[(1,x+dy,y+dy)])
    await touches(session,'touchEnd',[]);await page.wait_for_timeout(70)
    assert abs(float(await stage.get_attribute('data-image-x')))>0
    await expect(viewer).to_have_attribute('data-media-index','0')
    assert await viewer.locator('[data-media-paging-action]').evaluate_all('(nodes)=>nodes.every(node=>node.getBoundingClientRect().width<=1)')
    assert await page.evaluate('scrollY')==0
    checks.append('pinch changes only image, bounded pan does not switch gallery or scroll Account')
    await page.screenshot(path=str(OUT/f'media-viewer-zoom-{width}.png'))
    # A double tap resets the zoom without touching a toolbar.
    for tap in range(2):
     await touches(session,'touchStart',[(1,x,y)]);await touches(session,'touchEnd',[])
     await page.wait_for_timeout(60)
    await expect(stage).to_have_attribute('data-image-scale','1')
    # Keyboard users retain equivalent controls without visible +/− controls.
    await stage.focus();await page.keyboard.press('+');await expect(stage).to_have_attribute('data-image-scale','1.5')
    await page.keyboard.press('0');await expect(stage).to_have_attribute('data-image-scale','1')
    checks.append('no zoom toolbar; double-tap reset and keyboard equivalents work')
    await touches(session,'touchStart',[(1,x+65,y)])
    for dx in [20,40,80,130]:await touches(session,'touchMove',[(1,x+65-dx,y)])
    await touches(session,'touchEnd',[])
    await expect(viewer).to_have_attribute('data-media-index','1')
    await expect(page.get_by_role('button',name='Next media',exact=True)).to_be_disabled()
    await expect(page.locator('[data-photo-stage]')).to_have_attribute('data-image-scale','1');checks.append('fit-size horizontal swipe changes item and resets its camera')
    await page.set_viewport_size({'width':height,'height':width});await page.wait_for_timeout(80)
    bounds=await viewer.bounding_box();assert abs(bounds['height']-width)<2 and abs(bounds['width']-height)<2
    await session.send('Emulation.setPageScaleFactor',{'pageScaleFactor':1.7});await page.wait_for_timeout(80)
    viewport=await page.evaluate('({width:visualViewport.width,height:visualViewport.height,left:visualViewport.offsetLeft,top:visualViewport.offsetTop})');bounds=await viewer.bounding_box()
    assert abs(bounds['width']-viewport['width'])<2 and abs(bounds['height']-viewport['height'])<2,(bounds,viewport)
    checks.append('orientation and real browser page scale track the visual viewport')
    await session.send('Emulation.setPageScaleFactor',{'pageScaleFactor':1});await page.set_viewport_size({'width':width,'height':height})
    await page.get_by_role('button',name='Close media preview').click();await expect(viewer).to_have_count(0);await expect(opener).to_be_focused();assert not await page.evaluate('document.getElementById("root").inert')
    phase='immediate Escape after reopen'
    await opener.click();await page.keyboard.press('Escape');await expect(viewer).to_have_count(0);await expect(opener).to_be_focused()
    phase='native Back after reopen'
    await opener.click();await page.go_back();await expect(viewer).to_have_count(0);await expect(opener).to_be_focused();assert not await page.evaluate('document.getElementById("root").inert')
    checks.append('close, Escape and browser Back release page lock and restore opener')
    phase='first-committed-frame Escape'
    for repeat in range(4):
     await opener.focus()
     await page.evaluate('window.__openWithImmediateEscape()')
     await expect(viewer).to_have_count(0)
     await expect(opener).to_be_focused()
     assert not await page.evaluate('document.getElementById("root").inert')
    checks.append('first-frame Escape works on four immediate reopen cycles without delaying input')
    assert not errors,errors
    results.append({'width':width,'passed':True,'checks':checks,'page_errors':errors})
   except Exception as e:
    results.append({'width':width,'passed':False,'error':str(e),'phase':phase,'history':await page.evaluate('history.state'),'page_errors':errors});await page.screenshot(path=str(OUT/f'media-viewer-FAIL-{width}.png'))
   finally:await context.close()
  for width in [320,390,768,1440]:
   results.append(await mixed_gallery(browser,width))
  await browser.close()
 (OUT/'media-viewport-results.json').write_text(json.dumps(results,indent=2));print(json.dumps(results,indent=2));assert all(r['passed'] for r in results)
asyncio.run(main())
