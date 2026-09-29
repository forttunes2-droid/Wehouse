"""Capture the real Partner Pro component with synthetic, isolated API responses."""
import asyncio,base64,subprocess
from pathlib import Path
from playwright.async_api import async_playwright,expect
OUT=Path('test-results/experience');BUNDLE=Path('test-results/partner-pro-offline')
async def main():
 subprocess.run(['node','tests/browser/build-partner-pro-preview.mjs'],check=True)
 OUT.mkdir(parents=True,exist_ok=True)
 async with async_playwright() as p:
  browser=await p.chromium.launch(headless=True,args=['--no-sandbox'])
  for width in (390,768):
   page=await browser.new_page(viewport={'width':width,'height':844},device_scale_factor=1)
   errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   await page.set_content('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#090B10"><div id="root"></div></body></html>')
   await page.add_style_tag(path=str(BUNDLE/'fixture.css'));await page.add_script_tag(path=str(BUNDLE/'fixture.js'))
   for section in ('Calendar','Income','Tasks'):
    if section!='Calendar':await page.get_by_role('navigation',name='Property Pro tools').get_by_role('button',name=section).click()
    await expect(page.get_by_role('heading',name={'Calendar':'Upcoming stays','Income':'Available earnings','Tasks':'Maintenance and turnover'}[section])).to_be_visible()
    await page.screenshot(path=str(OUT/f'partner-pro-{section.lower()}-{width}.png'),full_page=True)
    if width==390:
     jpg=await page.screenshot(type='jpeg',quality=45,full_page=False)
     print(f'WEHOUSE_PREVIEW_PARTNER_{section.upper()}='+base64.b64encode(jpg).decode(),flush=True)
   assert not errors,errors
   await page.close()
  await browser.close()
if __name__=='__main__':asyncio.run(main())
