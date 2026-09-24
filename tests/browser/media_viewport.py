"""Actual media viewer, real multi-touch and native viewport scaling.
Synthetic photo URL only. No live API, customer data or page-zoom restriction.
"""
import asyncio,json,os,subprocess
from pathlib import Path
from playwright.async_api import async_playwright,expect
OUT=Path('test-results/experience');BUNDLE=Path('test-results/media-viewport-offline')
async def touches(session,kind,points):
 await session.send('Input.dispatchTouchEvent',{'type':kind,'touchPoints':[{'x':x,'y':y,'id':i} for i,x,y in points]})
async def main():
 subprocess.run(['node','tests/browser/build-media-viewport.mjs'],check=True);OUT.mkdir(parents=True,exist_ok=True);results=[]
 async with async_playwright() as p:
  opts={'headless':True,'args':['--no-sandbox']}
  if os.getenv('CHROMIUM_PATH'):opts['executable_path']=os.environ['CHROMIUM_PATH']
  browser=await p.chromium.launch(**opts)
  for width,height in [(320,640),(390,844),(768,900),(1440,900)]:
   context=await browser.new_context(viewport={'width':width,'height':height},has_touch=True,service_workers='block');page=await context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)));checks=[];phase='open'
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
    checks.append('opaque viewer and background interaction isolation')
    await page.get_by_role('button',name='Zoom in',exact=True).click();await expect(page.get_by_label('Image zoom',exact=True)).to_have_text('150%')
    stage=page.locator('[data-photo-stage]');box=await stage.bounding_box();x=box['x']+box['width']/2;y=box['y']+box['height']/2
    session=await context.new_cdp_session(page)
    await touches(session,'touchStart',[(1,x-35,y),(2,x+35,y)])
    for distance in [45,55,65,75]:await touches(session,'touchMove',[(1,x-distance,y),(2,x+distance,y)])
    await touches(session,'touchEnd',[]);await page.wait_for_timeout(70)
    assert float(await stage.get_attribute('data-image-scale'))>2.5
    await touches(session,'touchStart',[(1,x,y)])
    for dy in [20,40,60,80]:await touches(session,'touchMove',[(1,x+dy,y+dy)])
    await touches(session,'touchEnd',[]);await page.wait_for_timeout(70)
    assert abs(float(await stage.get_attribute('data-image-x')))>0
    await expect(page.get_by_role('button',name='Next media',exact=True)).to_be_visible()
    assert await page.evaluate('scrollY')==0
    checks.append('pinch changes only image, bounded pan does not switch gallery or scroll Account')
    await page.screenshot(path=str(OUT/f'media-viewer-zoom-{width}.png'))
    await page.get_by_role('button',name='Reset image zoom').click();await expect(page.get_by_label('Image zoom',exact=True)).to_have_text('100%')
    await touches(session,'touchStart',[(1,x+65,y)])
    for dx in [20,40,80,130]:await touches(session,'touchMove',[(1,x+65-dx,y)])
    await touches(session,'touchEnd',[])
    await expect(page.get_by_role('button',name='Previous media',exact=True)).to_be_visible();await expect(page.get_by_role('button',name='Next media',exact=True)).to_have_count(0)
    await expect(page.get_by_label('Image zoom',exact=True)).to_have_text('100%');checks.append('fit-size horizontal swipe changes item and resets its camera')
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
  await browser.close()
 (OUT/'media-viewport-results.json').write_text(json.dumps(results,indent=2));print(json.dumps(results,indent=2));assert all(r['passed'] for r in results)
asyncio.run(main())
