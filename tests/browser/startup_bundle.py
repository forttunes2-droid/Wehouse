"""Check the actual production bundle, not a test component, with invalid preview
configuration. A safe runtime block must render an actionable error, never an
endless splash or a request to the production database.
"""
import asyncio, json, re
from pathlib import Path
from playwright.async_api import async_playwright, expect
OUT=Path('test-results/experience'); BASE='http://127.0.0.1:4321'
async def main():
 OUT.mkdir(parents=True,exist_ok=True); results=[]
 async with async_playwright() as p:
  browser=await p.chromium.launch(args=['--no-sandbox'])
  try:
   for mode in ['unsafe-preview','missing-app-chunk']:
    context=await browser.new_context(viewport={'width':390,'height':844},service_workers='block'); page=await context.new_page(); external=[]
    async def route(handler):
     request=handler.request
     if not request.url.startswith(BASE): external.append(request.url); return await handler.abort()
     if mode=='missing-app-chunk' and '/assets/' in request.url and request.url.split('?')[0].endswith('.js'): return await handler.abort()
     await handler.continue_()
    await page.route('**/*',route)
    try:
     await page.goto(BASE)
     heading='Preview backend is not connected' if mode=='unsafe-preview' else 'WeHouse could not start'
     await expect(page.get_by_role('heading',name=heading,exact=True)).to_be_visible(timeout=15000)
     await expect(page.get_by_role('button',name='Reload WeHouse',exact=True)).to_be_visible()
     await expect(page.locator('#wh-bootstrap')).to_have_count(0)
     assert not any('.supabase.co' in url for url in external), external
     assert await page.evaluate('document.documentElement.scrollWidth <= innerWidth+1')
     await page.screenshot(path=str(OUT/f'startup-{mode}.png'))
     results.append({'mode':mode,'passed':True,'production_requests':0})
    except Exception as error:
     results.append({'mode':mode,'passed':False,'error':str(error),'external':external}); await page.screenshot(path=str(OUT/f'startup-failure-{mode}.png')); raise
    finally:
     (OUT/'startup-bundle-results.json').write_text(json.dumps(results,indent=2)); await context.close()
  finally: await browser.close()
asyncio.run(main())
