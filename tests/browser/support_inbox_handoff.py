"""Existing Help, support composer and Inbox rows together with isolated RPC data.
Not a real-account transport or production authorisation acceptance test.
"""
import asyncio,json,os,subprocess
from pathlib import Path
from playwright.async_api import async_playwright,expect
OUT=Path('test-results/experience');BUNDLE=Path('test-results/support-inbox-offline')
async def main():
 subprocess.run(['node','tests/browser/build-support-inbox.mjs'],check=True);OUT.mkdir(parents=True,exist_ok=True);results=[]
 async with async_playwright() as p:
  options={'headless':True,'args':['--no-sandbox']}
  if os.getenv('CHROMIUM_PATH'):options['executable_path']=os.environ['CHROMIUM_PATH']
  browser=await p.chromium.launch(**options)
  for width in [390,768,1440]:
   for role in ['user','worker','property_partner','hotel_staff']:
    context=await browser.new_context(viewport={'width':width,'height':844},service_workers='block');page=await context.new_page();page.set_default_timeout(5000)
    errors=[];page.on('pageerror',lambda e:errors.append(str(e)));row={'width':width,'role':role,'passed':False,'page_errors':errors}
    await page.route('**/*',lambda route:route.abort())
    try:
     await page.set_content('<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0"><div id="root"></div></body></html>')
     await page.evaluate('(role)=>window.__supportRole=role',role)
     await page.add_style_tag(path=str(BUNDLE/'fixture.css'));await page.add_script_tag(path=str(BUNDLE/'fixture.js'))
     await page.get_by_role('button',name='Using WeHouse',exact=True).click()
     dialog=page.get_by_role('dialog',name='WeHouse conversation',exact=True)
     await expect(dialog).to_be_visible();await expect(dialog.get_by_role('button',name='Send',exact=True)).to_be_disabled()
     assert await page.locator('main[data-screen]').get_attribute('data-screen')=='inbox'
     assert not any(c['name'].startswith(('send_','create_')) for c in await page.evaluate('window.__supportInbox.calls'))
     assert await page.evaluate('document.getElementById("root").inert')
     await dialog.locator('textarea').fill('Please help me with my account.')
     await page.evaluate('window.__supportInbox.holdSend=true')
     await dialog.get_by_role('button',name='Send',exact=True).click()
     await page.wait_for_function('!!window.__supportInbox.releaseSend')
     # Back while the first send is in flight must not trap the app or lose the
     # delivered conversation; its successful acknowledgement refreshes Inbox.
     await page.go_back();await expect(dialog).to_have_count(0)
     assert not await page.evaluate('document.getElementById("root").inert')
     await page.evaluate('window.__supportInbox.releaseSend()')
     inbox=page.locator('main[data-screen=inbox]')
     await expect(inbox.get_by_role('button',name='My account',exact=False)).to_be_visible()
     assert await page.evaluate('window.__supportInbox.firstSends')==1
     await inbox.get_by_role('button',name='My account',exact=False).click()
     await expect(dialog.get_by_text('Please help me with my account.',exact=True)).to_be_visible()
     await dialog.locator('textarea').fill('Here is my follow-up.')
     await dialog.get_by_role('button',name='Send',exact=True).click()
     await expect(dialog.get_by_text('Here is my follow-up.',exact=True)).to_be_visible()
     await dialog.get_by_role('button',name='Back',exact=True).click();await expect(dialog).to_have_count(0)
     await inbox.get_by_role('button',name='Open Help',exact=True).click()
     await page.get_by_role('button',name='Using WeHouse',exact=True).click()
     await expect(dialog.get_by_text('Here is my follow-up.',exact=True)).to_be_visible()
     assert await page.evaluate('window.__supportInbox.firstSends')==1
     assert await dialog.locator('textarea').input_value()==''
     workspace='personal' if role=='user' else 'hotel' if role=='hotel_staff' else role
     queries=await page.evaluate('window.__supportInbox.calls.filter(c=>c.name==="get_my_workspace_inbox").map(c=>c.args.p_workspace)')
     assert queries and set(queries)=={workspace},queries
     await page.screenshot(path=str(OUT/f'help-inbox-conversation-{role}-{width}.png'))
     await page.keyboard.press('Escape');await expect(dialog).to_have_count(0)
     await page.evaluate('window.__supportInbox.failInbox=true;window.dispatchEvent(new Event("wehouse:unread-changed"))')
     await expect(inbox.get_by_role('alert')).to_contain_text('could not be refreshed')
     await expect(inbox.get_by_text('No WeHouse conversations yet',exact=True)).to_have_count(0)
     await page.evaluate('window.__supportInbox.failInbox=false')
     await inbox.get_by_role('button',name='Try again',exact=True).click()
     await expect(inbox.get_by_role('button',name='My account',exact=False)).to_be_visible()
     assert not errors,errors
     row['passed']=True;row['checks']=['no send on open','Help hands off to Inbox','native Back during send','acknowledgement refresh','one thread on reentry','follow-up preserved','workspace alias and scope','retry is not empty']
    except Exception as e:
     row['error']=str(e);await page.screenshot(path=str(OUT/f'FAIL-support-inbox-{role}-{width}.png'))
    finally:results.append(row);print(json.dumps(row),flush=True);await context.close()
  await browser.close()
 (OUT/'support-inbox-handoff-results.json').write_text(json.dumps(results,indent=2));assert all(r['passed'] for r in results)
if __name__ == '__main__':
 asyncio.run(main())
