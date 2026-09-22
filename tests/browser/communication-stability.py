"""Additional real-browser navigation/send checks with no live network access."""
import asyncio
import json
import re
from playwright.async_api import async_playwright, expect
from experience import Scenario, BASE, OUT, A

class SendingScenario(Scenario):
    async def route(self, route):
        req = route.request
        if req.url.startswith(BASE): return await route.continue_()
        if req.method == 'OPTIONS':
            return await route.fulfill(status=204,headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET,POST,PATCH,DELETE,OPTIONS'})
        name = req.url.split('/')[-1].split('?')[0]
        if req.url.startswith('http://127.0.0.1:54321/') and name == 'send_support_message':
            self.calls.append((name,req.post_data_json))
            await asyncio.sleep(1.2)
            return await route.fulfill(content_type='application/json',body=json.dumps('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),headers={'access-control-allow-origin':'*'})
        return await super().route(route)

async def main():
    OUT.mkdir(parents=True,exist_ok=True)
    results=[]
    async with async_playwright() as p:
        browser=await p.chromium.launch(headless=True)
        try:
            s=Scenario()
            context,page=await s.page(browser,'creator',seed={'wh_navigation_experience-creator:personal':'profile'})
            try:
                await page.get_by_role('button',name='Open workspaces').click()
                await page.get_by_role('dialog',name='Switch workspace').get_by_role('button',name=re.compile('Personal')).click()
                await expect(page.get_by_role('button',name='Explore',exact=True)).to_be_visible()
                await page.get_by_role('button',name='Account',exact=True).click()
                await expect(page).to_have_url(re.compile('#profile$'))
                await page.reload()
                await page.get_by_role('button',name='Back',exact=True).click()
                await expect(page.get_by_role('button',name='Explore',exact=True)).to_be_visible()
                await expect(page.get_by_label('Opening page',exact=True)).to_have_count(0)
                await page.screenshot(path=str(OUT/'personal-settled-mobile.png'))
                assert not s.errors,s.errors
                results.append('Refreshed Account Back reaches a rendered Personal screen, not only a changed URL')
            finally: await context.close()

            s=SendingScenario()
            context,page=await s.page(browser,'messages')
            try:
                await page.get_by_role('button',name=re.compile('Alpha')).click()
                await expect(page.get_by_text('Alpha customer message',exact=True)).to_be_visible()
                await page.locator('textarea').fill('Send to Alpha')
                await page.get_by_role('button',name='Send message',exact=True).click()
                await page.get_by_role('button',name='Back to conversations',exact=True).click()
                await page.get_by_role('button',name=re.compile('Beta')).click()
                await expect(page.get_by_text('Beta customer message',exact=True)).to_be_visible()
                await page.locator('textarea').fill('Keep this Beta draft')
                await page.wait_for_timeout(1600)
                await expect(page.locator('textarea')).to_have_value('Keep this Beta draft')
                sends=[args for name,args in s.calls if name=='send_support_message']
                assert len(sends)==1 and sends[0]['p_conversation_id']==A,sends
                await page.screenshot(path=str(OUT/'pending-send-new-draft.png'))
                assert not s.errors,s.errors
                results.append('Late completion of Alpha send preserves Beta draft and cannot change its recipient')
            finally: await context.close()
        finally:
            await browser.close()
            (OUT/'communication-stability-results.json').write_text(json.dumps(results,indent=2))
    for result in results: print('PASS',result,flush=True)

if __name__=='__main__': asyncio.run(main())
