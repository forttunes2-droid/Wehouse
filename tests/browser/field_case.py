"""Actual assigned-field conversation UI; isolated transport, no hosted accounts."""
import asyncio,json,os,re,subprocess
from pathlib import Path
from playwright.async_api import async_playwright,expect
OUT=Path('test-results/experience');BUNDLE=Path('test-results/field-case-offline')
async def main():
 subprocess.run(['node','tests/browser/build-support-inbox.mjs','--field-case'],check=True)
 OUT.mkdir(parents=True,exist_ok=True);results=[]
 async with async_playwright() as p:
  options={'headless':True}
  if os.getenv('CHROMIUM_PATH'):options['executable_path']=os.environ['CHROMIUM_PATH']
  browser=await p.chromium.launch(**options)
  try:
   for theme in ['light','dark']:
    for width in [320,768,1440]:
     context=await browser.new_context(viewport={'width':width,'height':900},service_workers='block');page=await context.new_page();page.set_default_timeout(8000)
     errors=[];page.on('pageerror',lambda error:errors.append(str(error)));result={'theme':theme,'width':width,'passed':False}
     try:
      await page.route('**/*',lambda route:route.abort())
      await page.route('https://wehouse.test/**',lambda route:route.fulfill(content_type='text/html',body='<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0"><div id="root"></div></body></html>'))
      await page.goto('https://wehouse.test/')
      await page.evaluate('(theme)=>document.documentElement.setAttribute("data-wh-theme",theme)',theme)
      await page.add_style_tag(path=str(BUNDLE/'fixture.css'));await page.add_script_tag(path=str(BUNDLE/'fixture.js'))
      await expect(page.get_by_text('You are the assigned Field Operations Staff member',exact=True)).to_be_visible()
      await expect(page.get_by_text('You can contribute to this case. Property Operations retains ownership and case decisions.',exact=True)).to_be_visible()
      await expect(page.get_by_text('Please coordinate the assigned inspection.',exact=True)).to_be_visible()
      await expect(page.get_by_text('Customer reply from Assigned inspector · Field Operations · WeHouse',exact=True)).to_be_visible()
      await expect(page.get_by_role('button',name=re.compile('^Take (request|assignment)$'))).to_have_count(0)
      await expect(page.get_by_role('button',name=re.compile('^(Start work|Resolve|Close request|Escalate)$'))).to_have_count(0)
      await page.locator('textarea').fill('The assigned visit is being coordinated.')
      await expect(page.get_by_role('button',name='Send message',exact=True)).to_be_enabled()
      await page.get_by_role('button',name='Send message',exact=True).click()
      await expect(page.locator('p').filter(has_text='The assigned visit is being coordinated.')).to_have_count(1)
      await expect(page.locator('textarea')).to_have_value('')
      calls=await page.evaluate('window.__fieldCase.calls')
      assert len([call for call in calls if call['name']=='send_support_message_v2'])==1,calls
      assert not any(call['name'] in ['claim_my_communication_case','transition_my_support_case'] for call in calls),calls
      assert not errors,errors
      assert await page.evaluate('document.documentElement.scrollWidth<=window.innerWidth+1')
      await page.screenshot(path=str(OUT/f'field-case-{theme}-{width}.png'))
      result['passed']=True
     except Exception as error:
      result['error']=str(error);result['page_errors']=errors
      await page.screenshot(path=str(OUT/f'FAIL-field-case-{theme}-{width}.png'))
     finally:
      results.append(result);print(json.dumps(result),flush=True);await context.close()
  finally:await browser.close()
 (OUT/'field-case-results.json').write_text(json.dumps(results,indent=2))
 assert all(result['passed'] for result in results)
if __name__=='__main__':asyncio.run(main())
