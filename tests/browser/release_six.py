import asyncio,json,os,subprocess
from pathlib import Path
from playwright.async_api import async_playwright,expect
OUT=Path('test-results/experience');B=Path('test-results/release-six-offline')
async def main():
 subprocess.run(['node','tests/browser/build-release-six.mjs'],check=True);OUT.mkdir(parents=True,exist_ok=True);rows=[]
 async with async_playwright() as p:
  opts={'headless':True,'args':['--no-sandbox']}
  if os.getenv('CHROMIUM_PATH'):opts['executable_path']=os.environ['CHROMIUM_PATH']
  browser=await p.chromium.launch(**opts)
  for width in [390,1440]:
   for mode in ['management','security']:
    ctx=await browser.new_context(viewport={'width':width,'height':844},service_workers='block');page=await ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    await page.route('**/*',lambda route:route.abort());row={'width':width,'mode':mode,'passed':False}
    try:
     management={'listing_id':'11111111-1111-4111-8111-111111111111','management_mode':'host','wehouse_management_status':'not_required','management_host_user_id':'owner-a','assignments':[{'assignment_id':'a-owner','user_id':'owner-a','name':'Test Owner','username':'test-owner','role':'owner','status':'active'},{'assignment_id':'a-manager','user_id':'manager-b','name':'Bola Manager','username':'bola-manager','role':'manager','status':'active'}]}
     await page.set_content('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#090B10"><div id="root"></div></body></html>')
     await page.evaluate('x=>window.__releaseSix=x',{'mode':mode,'management':management,'calls':[]})
     await page.add_style_tag(path=str(B/'fixture.css'));await page.add_script_tag(path=str(B/'fixture.js'))
     if mode=='management':
      await expect(page.get_by_role('heading',name='Host-managed',exact=True)).to_be_visible()
      await expect(page.get_by_text('You are responsible',exact=True)).to_be_visible()
      await expect(page.get_by_text('Bola Manager',exact=True)).to_be_visible()
      await expect(page.get_by_role('button',name='WeHouse-managed',exact=False)).to_be_visible()
     else:
      await expect(page.get_by_role('heading',name='Two-step verification',exact=True)).to_be_visible()
      await expect(page.get_by_role('button',name='Set up authenticator',exact=True)).to_be_visible()
      await expect(page.get_by_role('heading',name='Creator security password',exact=True)).to_be_visible()
      await expect(page.get_by_role('button',name='Create Creator security password',exact=True)).to_be_visible()
     assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
     assert not errors,errors
     await page.screenshot(path=str(OUT/f'release-six-{mode}-{width}.png'),full_page=True)
     row['passed']=True
    except Exception as e: row['error']=str(e);await page.screenshot(path=str(OUT/f'release-six-FAIL-{mode}-{width}.png'),full_page=True)
    finally: rows.append(row);print(json.dumps(row),flush=True);await ctx.close()
  await browser.close()
 (OUT/'release-six-results.json').write_text(json.dumps(rows,indent=2));assert all(r['passed'] for r in rows)
asyncio.run(main())
