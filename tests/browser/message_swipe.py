"""Exercise the shared production MessagePress with actual browser touch events."""
import asyncio
import json
from pathlib import Path
from playwright.async_api import async_playwright, expect

BASE = 'http://127.0.0.1:4173'
OUT = Path('test-results/experience')

async def swipe(page, session, side, dx, dy=0, cancel=False, hold=0, capture=None):
    box = await page.get_by_test_id(side+'-text').bounding_box()
    assert box, side
    x=box['x']+box['width']/2
    y=box['y']+box['height']/2
    point=lambda a,b: [{'x':a,'y':b,'id':1}]
    await session.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':point(x,y)})
    if hold: await page.wait_for_timeout(hold)
    for step in range(1,9):
        await session.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':point(x+dx*step/8,y+dy*step/8)})
        await page.wait_for_timeout(18)
        assert not await page.evaluate('document.documentElement.scrollWidth>innerWidth'), 'Gesture exposed horizontal page overflow'
    if capture:
        await page.screenshot(path=str(OUT/capture))
        assert not await page.evaluate('document.documentElement.scrollWidth>innerWidth'), 'Swipe exposed horizontal page overflow'
    await session.send('Input.dispatchTouchEvent',{'type':'touchCancel' if cancel else 'touchEnd','touchPoints':[]})
    await page.wait_for_timeout(100)

async def main():
    OUT.mkdir(parents=True,exist_ok=True)
    results=[]
    async with async_playwright() as p:
        browser=await p.chromium.launch(headless=True)
        try:
            for width in [320,390,760]:
                context=await browser.new_context(viewport={'width':width,'height':844},has_touch=True,is_mobile=True,reduced_motion='reduce')
                page=await context.new_page()
                errors=[]
                page.on('pageerror',lambda error:errors.append(str(error)))
                session=await context.new_cdp_session(page)
                try:
                    await page.goto(BASE+'/tests/browser/message-swipe.html')
                    await expect(page.get_by_role('heading',name='Message gestures')).to_be_visible()
                    for side,direction in [('incoming',1),('outgoing',-1)]:
                        await page.get_by_role('button',name='Reset gesture result').click()
                        # Outward travel must neither move the page nor select Reply.
                        await swipe(page,session,side,-direction*100)
                        await expect(page.get_by_label('Reply count')).to_have_text('0')
                        await swipe(page,session,side,direction*40)
                        await expect(page.get_by_label('Reply count')).to_have_text('0')
                        await swipe(page,session,side,direction*100,capture=f'reply-inward-{side}-{width}.png')
                        await expect(page.get_by_label('Reply result')).to_have_text(side)
                        await expect(page.get_by_label('Reply count')).to_have_text('1')
                        await page.get_by_role('button',name='Reset gesture result').click()
                        await swipe(page,session,side,direction*100,cancel=True)
                        await expect(page.get_by_label('Reply count')).to_have_text('0')
                    await page.get_by_role('button',name='Reset gesture result').click()
                    await swipe(page,session,'incoming',0,dy=-110)
                    await expect(page.get_by_label('Reply count')).to_have_text('0')
                    assert await page.evaluate('window.scrollY > 0'), 'Message must permit vertical page scrolling'
                    await page.evaluate('window.scrollTo({top:0,behavior:"instant"})')
                    await swipe(page,session,'incoming',0,hold=470)
                    await expect(page.get_by_label('Action count')).to_have_text('1')
                    await expect(page.get_by_label('Reply count')).to_have_text('0')
                    await page.get_by_role('button',name='Play voice note').first.click()
                    await expect(page.get_by_label('Voice plays')).to_have_text('1')
                    assert not errors,errors
                    assert not await page.evaluate('document.documentElement.scrollWidth>innerWidth')
                    results.append({'width':width,'passed':True,'checks':['inward only','threshold','cancel','long press','embedded controls','vertical scrolling','no horizontal overflow throughout both directions']})
                    print('PASS native touch reply gesture',width,flush=True)
                except Exception as error:
                    results.append({'width':width,'passed':False,'error':str(error),'page_errors':errors})
                    await page.screenshot(path=str(OUT/f'reply-failure-{width}.png'),full_page=True)
                    raise
                finally:
                    (OUT/'message-swipe-results.json').write_text(json.dumps(results,indent=2))
                    await context.close()
        finally:
            await browser.close()

if __name__=='__main__':asyncio.run(main())
