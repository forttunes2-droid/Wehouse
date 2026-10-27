"""Actual app error boundary: readable themes, private diagnostics and explicit retry."""
import asyncio,json
from pathlib import Path
from playwright.async_api import async_playwright,expect
BASE='http://127.0.0.1:4173';OUT=Path('test-results/error-states');OUT.mkdir(parents=True,exist_ok=True)
async def main():
 results=[]
 async with async_playwright() as p:
  browser=await p.chromium.launch(args=['--no-sandbox'])
  for theme,width in [('light',390),('dark',1440)]:
   for mode,title in [('error-generic','We couldn’t open this screen'),('error-chunk','This screen couldn’t load')]:
    context=await browser.new_context(viewport={'width':width,'height':850},service_workers='block');page=await context.new_page();navigations=[]
    page.on('framenavigated',lambda frame:navigations.append(frame.url) if frame==page.main_frame else None)
    await page.route('**/*',lambda r:r.continue_() if r.request.url.startswith(BASE) else r.abort())
    await page.goto(BASE+f'/tests/browser/rent-terms.html?mode={mode}&theme={theme}')
    await expect(page.get_by_role('heading',name=title,exact=True)).to_be_visible()
    text=await page.locator('body').inner_text();assert 'Synthetic private' not in text and 'synthetic-private-path' not in text and 'clear your browser cache' not in text
    contrast=await page.get_by_role('heading',name=title,exact=True).evaluate(r'''h=>{const rgb=s=>s.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4});const lum=s=>{const c=rgb(s);return .2126*c[0]+.7152*c[1]+.0722*c[2]};const a=lum(getComputedStyle(h).color),b=lum(getComputedStyle(h.closest('main > div')).backgroundColor);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05)}''')
    assert contrast>=4.5,contrast
    assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
    await page.wait_for_timeout(250);assert len(navigations)==1,navigations
    await page.screenshot(path=str(OUT/f'{mode}-{theme}.png'),full_page=True)
    await page.get_by_role('button',name='Refresh WeHouse',exact=True).click()
    await expect(page.get_by_role('heading',name=title,exact=True)).to_be_visible();assert len(navigations)==2,navigations
    results.append({'theme':theme,'width':width,'mode':mode,'contrast':round(contrast,2),'private_diagnostics_hidden':True,'explicit_retry':True,'passed':True});await context.close()
  await browser.close()
 (OUT/'results.json').write_text(json.dumps(results,indent=2));print(json.dumps(results))
asyncio.run(main())
