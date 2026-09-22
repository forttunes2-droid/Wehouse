"""Assert the actual welcome composition, not merely absence of overflow.

Uses the existing isolated browser fixture and intercepted synthetic APIs.
"""
import asyncio
import json
from playwright.async_api import async_playwright, expect
from experience import Scenario, OUT

async def main():
    OUT.mkdir(parents=True, exist_ok=True)
    results = []
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        try:
            for width,height in [(320,720),(390,844),(760,900),(1024,768),(1440,900)]:
                scenario = Scenario()
                context,page = await scenario.page(browser,'login',width,height,reduced=True)
                try:
                    await expect(page.get_by_role('heading',name='Welcome',exact=True)).to_be_visible()
                    form = await page.locator('.wh-auth-form').bounding_box()
                    brand = await page.locator('.wh-auth-header').bounding_box()
                    legal = await page.locator('.wh-auth-legal').bounding_box()
                    assert form and brand and legal, 'Welcome composition did not render'
                    assert form['width'] <= 440, (width,'Form is stretched',form)
                    assert abs(form['x']-brand['x']) < 2, (width,'Brand and form are detached',brand,form)
                    assert form['y'] >= brand['y']+brand['height']-2, (width,'Brand is beside the form instead of above it',brand,form)
                    assert 12 <= legal['y']-(form['y']+form['height']) <= 40, (width,'Legal links are stranded at the bottom',form,legal)
                    assert not await page.evaluate('document.documentElement.scrollWidth>innerWidth'), 'Horizontal overflow'
                    await page.screenshot(path=str(OUT/f'welcome-aligned-{width}.png'),full_page=True)
                    await page.get_by_role('button',name='Sign in',exact=True).click()
                    await expect(page.get_by_label('Username or email')).to_be_visible()
                    assert not await page.evaluate('document.documentElement.scrollWidth>innerWidth'), 'Sign-in form overflow'
                    assert not scenario.errors, scenario.errors
                    results.append({'viewport':f'{width}x{height}','passed':True})
                    print('PASS aligned welcome and sign-in',width,height,flush=True)
                except Exception as error:
                    results.append({'viewport':f'{width}x{height}','passed':False,'error':str(error)})
                    await page.screenshot(path=str(OUT/f'welcome-failure-{width}.png'),full_page=True)
                    raise
                finally:
                    (OUT/'welcome-layout-results.json').write_text(json.dumps(results,indent=2))
                    await context.close()
        finally:
            await browser.close()

if __name__ == '__main__': asyncio.run(main())
