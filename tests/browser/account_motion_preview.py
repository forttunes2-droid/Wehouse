"""Phone captures and tab scroll behavior using real Account and Workspace components."""
import asyncio,base64,subprocess,re
from pathlib import Path
from playwright.async_api import async_playwright,expect

OUT=Path('test-results/experience');BUNDLE=Path('test-results/account-motion-offline')
async def main():
 subprocess.run(['node','tests/browser/build-account-motion-preview.mjs'],check=True)
 OUT.mkdir(parents=True,exist_ok=True)
 async with async_playwright() as p:
  browser=await p.chromium.launch(headless=True,args=['--no-sandbox'])
  page=await browser.new_page(viewport={'width':390,'height':844},device_scale_factor=1)
  errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  fixture_html='<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#090B10"><div id="root"></div></body></html>'
  await page.route('http://wehouse.test/**',lambda route:route.fulfill(status=200,content_type='text/html',body=fixture_html))
  await page.goto('http://wehouse.test/theme-fixture')
  await page.add_style_tag(path=str(BUNDLE/'fixture.css'));await page.add_script_tag(path=str(BUNDLE/'fixture.js'))
  for name in ('Account','Notifications','Workspaces'):
   if name!='Account':
    if name=='Workspaces':await page.get_by_role('button',name='Back').click()
    await page.get_by_role('button',name='Notifications' if name=='Notifications' else 'Switch workspace').click()
   await expect(page.get_by_role('heading',name='Account' if name=='Account' else 'WeHouse' if name=='Workspaces' else 'Notifications',exact=True)).to_be_visible()
   if name=='Notifications':
    assert await page.get_by_role('switch',name='In-app alerts').count()==1
    assert await page.get_by_role('switch',name='In-app alerts').get_attribute('aria-checked')=='true'
   await page.screenshot(path=str(OUT/f'account-{name.lower()}-390.png'),full_page=True)
   print(f'WEHOUSE_PREVIEW_ACCOUNT_{name.upper()}='+base64.b64encode(await page.screenshot(type='jpeg',quality=48)).decode(),flush=True)
  await page.get_by_role('button',name='Back').click()
  await page.get_by_role('button',name='Appearance',exact=False).click()
  await expect(page.get_by_role('heading',name='Appearance')).to_be_visible()
  await page.get_by_role('button',name=re.compile(r'^Light\b')).click()
  await expect(page.locator('html')).to_have_attribute('data-wh-theme','light')
  await expect(page.get_by_role('button',name=re.compile(r'^Light\b'))).to_have_attribute('aria-pressed','true')
  assert await page.evaluate('localStorage.getItem("wehouse:appearance")')=='light'
  await page.screenshot(path=str(OUT/'account-appearance-light-390.png'),full_page=True)
  await page.get_by_role('button',name='Back').click()
  await expect(page.get_by_role('heading',name='Account',exact=True)).to_be_visible()
  await page.screenshot(path=str(OUT/'account-light-390.png'),full_page=True)
  light_bg=await page.locator('main').evaluate('(node)=>getComputedStyle(node.parentElement).backgroundColor')
  assert light_bg=='rgb(247, 248, 251)',light_bg
  await page.get_by_role('button',name='Notifications').click()
  await expect(page.get_by_role('heading',name='Notifications',exact=True)).to_be_visible()
  await page.wait_for_timeout(140)
  await page.screenshot(path=str(OUT/'account-notifications-light-390.png'),full_page=True)
  await page.get_by_role('button',name='Back').click()
  await page.get_by_role('button',name='Switch workspace').click()
  await expect(page.get_by_role('heading',name='WeHouse',exact=True)).to_be_visible()
  await page.screenshot(path=str(OUT/'account-workspaces-light-390.png'),full_page=True)
  await page.get_by_role('button',name='Back').click()
  await page.get_by_role('button',name='Appearance',exact=False).click()
  await expect(page.locator('html')).to_have_attribute('data-wh-theme','light')
  await expect(page.locator('html')).to_have_attribute('data-wh-theme','dark')
  await page.get_by_role('button',name=re.compile(r'^Dark\b')).click()
  await expect(page.locator('html')).to_have_attribute('data-wh-theme','dark')
  assert await page.evaluate('localStorage.getItem("wehouse:appearance")')=='dark'
  print('APPEARANCE_ACCOUNT_LIGHT_DARK=passed',flush=True)
  await page.evaluate('window.__showWorkspaceFixture()')
  await page.screenshot(path=str(OUT/'workspace-partner-dark-390.png'))
  await page.evaluate('window.localStorage.setItem("wehouse:appearance","light"); window.dispatchEvent(new StorageEvent("storage",{key:"wehouse:appearance"}))')
  await page.screenshot(path=str(OUT/'workspace-partner-light-390.png'))
  assert await page.locator('[data-workspace-frame="v2"]').evaluate('(node)=>getComputedStyle(node).backgroundColor')=='rgb(247, 248, 251)'
  surface=page.locator('[data-test-scroll]')
  tabs=page.locator('nav.fixed')
  await expect(page.get_by_role('heading',name='Overview',exact=True).last).to_be_visible()
  await surface.evaluate('(node)=>node.scrollTop=620')
  print('BOUNDED_BEFORE='+str(await surface.evaluate('(node)=>node.scrollTop')),flush=True)
  await tabs.get_by_role('button',name='Properties').evaluate('(node)=>node.click()')
  await expect(page.locator('[data-test-stage="properties"]')).to_be_visible()
  print('BOUNDED_PROPERTIES='+str(await surface.evaluate('(node)=>node.scrollTop')),flush=True)
  assert await surface.evaluate('(node)=>node.scrollTop')==0
  await surface.evaluate('(node)=>node.scrollTop=320')
  print('BOUNDED_SECOND='+str(await surface.evaluate('(node)=>node.scrollTop')),flush=True)
  await tabs.get_by_role('button',name='Overview').evaluate('(node)=>node.click()')
  await expect(page.locator('[data-test-stage="overview"]')).to_be_visible()
  print('BOUNDED_RESTORED='+str(await surface.evaluate('(node)=>node.scrollTop')),flush=True)
  assert await surface.evaluate('(node)=>node.scrollTop')==620
  await tabs.get_by_role('button',name='Overview').evaluate('(node)=>node.click()')
  assert await surface.evaluate('(node)=>node.scrollTop')==0
  await page.evaluate('window.__showDocumentWorkspaceFixture()')
  await expect(page.locator('[data-test-stage="overview"]')).to_be_visible()
  await page.evaluate('window.scrollTo(0,620)')
  assert await page.evaluate('document.scrollingElement.scrollTop')==620
  await tabs.get_by_role('button',name='Properties').evaluate('(node)=>node.click()')
  assert await page.evaluate('document.scrollingElement.scrollTop')==0
  await page.evaluate('window.scrollTo(0,320)')
  await tabs.get_by_role('button',name='Overview').evaluate('(node)=>node.click()')
  assert await page.evaluate('document.scrollingElement.scrollTop')==620
  assert not errors,errors
  await browser.close()
if __name__=='__main__':asyncio.run(main())
