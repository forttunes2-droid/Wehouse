"""Real inspection component: isolated transport, theme/width and save-receipt recovery."""
import asyncio,json,os,re,subprocess
from pathlib import Path
from playwright.async_api import async_playwright,expect
OUT=Path('test-results/experience');BUNDLE=Path('test-results/inspection-offline')
async def main():
 subprocess.run(['node','tests/browser/build-support-inbox.mjs','--inspection'],check=True)
 OUT.mkdir(parents=True,exist_ok=True);results=[]
 async with async_playwright() as p:
  options={'headless':True}
  if os.getenv('CHROMIUM_PATH'):options['executable_path']=os.environ['CHROMIUM_PATH']
  browser=await p.chromium.launch(**options)
  try:
   for source in ['partner','user']:
    for theme in ['light','dark']:
     for width in [320,768,1440]:
      context=await browser.new_context(viewport={'width':width,'height':900},service_workers='block');page=await context.new_page();page.set_default_timeout(8000)
      errors=[];page.on('pageerror',lambda error:errors.append(str(error)));result={'source':source,'theme':theme,'width':width,'passed':False}
      try:
       await page.route('**/*',lambda route:route.abort())
       await page.route('https://wehouse.test/**',lambda route:route.fulfill(content_type='text/html',body='<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0"><div id="root"></div></body></html>'))
       await page.goto('https://wehouse.test/?source='+source)
       await page.evaluate('(theme)=>document.documentElement.setAttribute("data-wh-theme",theme)',theme)
       await page.add_style_tag(path=str(BUNDLE/'fixture.css'));await page.add_script_tag(path=str(BUNDLE/'fixture.js'))
       await page.get_by_role('button',name=re.compile('Assigned property visit')).click()
       if source=='partner':
        await expect(page.get_by_role('heading',name='Changes requested by Property Operations')).to_be_visible()
        await expect(page.get_by_text('Add clearer entrance evidence.',exact=True)).to_be_visible()
        await expect(page.get_by_placeholder('Inspection report')).to_have_value('Previous inspection report')
        await expect(page.get_by_text('Add more visit photos',exact=True)).to_be_visible()
       else:
        await expect(page.get_by_text('Photos and videos are optional supporting evidence for this customer visit.',exact=True)).to_be_visible()
        await expect(page.get_by_text('Add 4 visit photos',exact=True)).to_have_count(0)
       await page.get_by_placeholder('Inspection report').fill('Confirmed report from this assigned visit.')
       submit=page.get_by_role('button',name='Submit inspection for review' if source=='partner' else 'Submit visit report',exact=True)
       await expect(submit).to_be_enabled()
       assert await page.evaluate('document.documentElement.scrollWidth<=window.innerWidth+1')
       await page.screenshot(path=str(OUT/f'inspection-{source}-{theme}-{width}.png'),full_page=True)
       await submit.click()
       await expect(page.get_by_text('Inspection save could not be confirmed. Retry to confirm.',exact=True)).to_be_visible()
       await expect(page.get_by_placeholder('Inspection report')).to_have_value('Confirmed report from this assigned visit.')
       await submit.click()
       await expect(page.get_by_role('heading',name='Inspections',exact=True)).to_be_visible()
       calls=await page.evaluate('window.__inspection.calls')
       writes=[call for call in calls if call['name']=='update_inspection_status']
       assert len(writes)==2 and writes[0]['args']==writes[1]['args'],calls
       assert not errors,errors
       result['passed']=True
      except Exception as error:
       result['error']=str(error);result['page_errors']=errors
       await page.screenshot(path=str(OUT/f'FAIL-inspection-{source}-{theme}-{width}.png'),full_page=True)
      finally:
       results.append(result);print(json.dumps(result),flush=True);await context.close()
  finally:await browser.close()
 (OUT/'inspection-workspace-results.json').write_text(json.dumps(results,indent=2))
 assert all(result['passed'] for result in results)
if __name__=='__main__':asyncio.run(main())
