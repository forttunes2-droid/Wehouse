"""Actual Creator control: whole-account wording, lost response and saved-state proof."""
import asyncio,json,subprocess
from pathlib import Path
from playwright.async_api import async_playwright,expect
OUT=Path('test-results/security-controls');BUNDLE=Path('test-results/profile-refinement-offline')
async def main():
 subprocess.run(['node','tests/browser/build-profile-refinement.mjs'],check=True);OUT.mkdir(parents=True,exist_ok=True);results=[]
 async with async_playwright() as p:
  browser=await p.chromium.launch(args=['--no-sandbox'])
  for theme,width in [('light',390),('dark',1440)]:
   context=await browser.new_context(viewport={'width':width,'height':900},service_workers='block');page=await context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   await page.route('**/*',lambda r:r.abort());await page.set_content('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><div id="root"></div></body></html>')
   await page.evaluate('theme=>{window.__refinementMode="creator-list";window.__refinementTheme=theme}',theme)
   await page.add_style_tag(path=str(BUNDLE/'fixture.css'));await page.add_script_tag(path=str(BUNDLE/'fixture.js'))
   await page.get_by_role('button').filter(has_text='Sani Example').first.click()
   await expect(page.get_by_text('This suspends the person’s access across all WeHouse workspaces,',exact=False)).to_be_visible()
   suspend=page.get_by_role('button',name='Suspend account across WeHouse',exact=True);await expect(suspend).to_be_disabled()
   await page.get_by_label('Reason for changing account access',exact=True).fill('Reviewed misconduct; temporary account suspension')
   await suspend.click();await expect(page.get_by_text('Account access could not be confirmed.',exact=False)).to_be_visible();await expect(page.get_by_text('Account access suspended across WeHouse',exact=True)).to_have_count(0)
   await expect(suspend).to_be_disabled()
   # The saved account status must be read before another access command.
   await page.get_by_role('button',name='Refresh account access',exact=True).click()
   restore=page.get_by_role('button',name='Restore account access',exact=True);await expect(restore).to_be_disabled()
   await page.get_by_label('Reason for changing account access',exact=True).fill('Account review accepted; restore access')
   await page.screenshot(path=str(OUT/f'creator-account-{theme}.png'),full_page=True)
   await page.evaluate('window.__fixtureState.loseAccessResponse=false');await restore.click()
   await expect(page.get_by_text('Account access restored',exact=True)).to_be_visible()
   commands=await page.evaluate('window.__fixtureState.calls.filter(c=>c.name==="creator_set_account_suspension")')
   assert len(commands)==2 and commands[0]['args']['p_suspended'] is True and commands[1]['args']['p_suspended'] is False
   assert all(c['args']['p_creator_elevation_id']=='test-elevation' and c['args']['p_reason'] for c in commands)
   assert not errors,errors;assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
   results.append({'theme':theme,'width':width,'account_scope_visible':True,'lost_response_not_success':True,'restore_read_back':True,'passed':True});await context.close()
  await browser.close()
 (OUT/'creator-results.json').write_text(json.dumps(results,indent=2));print(json.dumps(results))
asyncio.run(main())
