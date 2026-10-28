"""Real useAuth and authenticator gate; isolated transport, no provider secrets."""
import asyncio,json,subprocess,os
from pathlib import Path
from playwright.async_api import async_playwright,expect
OUT=Path('test-results/account-authenticator')
async def main():
 subprocess.run(['node','tests/browser/build-account-authenticator.mjs'],check=True)
 rows=[]
 async with async_playwright() as p:
  options={'args':['--no-sandbox']}
  if os.getenv('CHROMIUM_PATH'):options['executable_path']=os.environ['CHROMIUM_PATH']
  browser=await p.chromium.launch(**options)
  for case in ['setup','personal-factor','incorrect-code','cancel','outage','recovery','event','explicit-login']:
   for theme,width in [('light',390),('dark',1280)]:
    context=await browser.new_context(viewport={'width':width,'height':900},service_workers='block');page=await context.new_page();page.set_default_timeout(8000);errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    await page.route('**/*',lambda route:route.fulfill(status=200,content_type='text/html',body='<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>'))
    row={'case':case,'theme':theme,'passed':False}
    try:
     await page.goto('http://mfa.test/'+('?auth=recovery' if case=='recovery' else ''))
     await page.evaluate("([mode,theme])=>{document.documentElement.className=theme;document.documentElement.setAttribute('data-theme',theme);window.__mfaTest={required:mode==='setup',enrolled:mode!=='setup',aal:'aal1',signed:mode!=='explicit-login',calls:[],fail:mode==='outage',emit:mode==='event'};localStorage.setItem('wh_profile_snapshot_v2:auth-a',JSON.stringify({saved_at:Date.now(),profile:{auth_id:'auth-a',user_id:'person-a',role:'creator'}}));}",[case,theme])
     await page.add_style_tag(path=str(OUT/'fixture.css'));await page.add_script_tag(path=str(OUT/'fixture.js'))
     if case=='explicit-login':
      await expect(page.get_by_text('Signed out',exact=True)).to_be_visible();await page.evaluate("window.__mfaTest.signed=true;window.__authContinue('auth-a','mfa@example.invalid')")
     if case=='outage':
      await expect(page.get_by_text('We couldn’t restore your session. Please sign in again.',exact=True)).to_be_visible()
     else:
      setup=case=='setup';await expect(page.get_by_role('heading',name='Set up your authenticator' if setup else 'Enter your authenticator code',exact=True)).to_be_visible()
      assert not any(n in ['profile','device'] for n in await page.evaluate('window.__mfaTest.calls'))
      if case=='cancel':
       await page.get_by_role('button',name='Sign out',exact=True).click();await expect(page.get_by_text('Signed out',exact=True)).to_be_visible()
      else:
       if setup:await page.get_by_role('button',name='Set up authenticator',exact=True).click()
       field=page.get_by_label('6-digit authenticator code',exact=True)
       if case=='incorrect-code':
        await field.fill('654321');await page.get_by_role('button',name='Continue securely',exact=True).click();await expect(page.get_by_role('alert')).to_contain_text('not accepted');assert 'profile' not in await page.evaluate('window.__mfaTest.calls')
       if case=='personal-factor':
        await page.get_by_text('Lost access to your authenticator?',exact=True).click();await page.get_by_role('button',name='Get recovery support contact',exact=True).click();await expect(page.get_by_role('link',name='Email WeHouse about authenticator recovery',exact=True)).to_have_attribute('href','mailto:support@example.invalid?subject=WeHouse%20authenticator%20recovery')
       await field.fill('123456');await page.screenshot(path=str(OUT/f'{case}-{theme}.png'));await page.get_by_role('button',name='Verify and continue' if setup else 'Continue securely',exact=True).click()
       await expect(page.get_by_text('Signed out' if case=='recovery' else 'Verified workspace',exact=True)).to_be_visible()
       calls=await page.evaluate('window.__mfaTest.calls');assert calls.count('enroll')==(1 if setup else 0)
       assert calls.index('verify')<calls.index('profile') if case!='recovery' else 'profile' not in calls
     assert not errors,errors
     assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
     assert 'TEST-ONLY-SECRET' not in await page.evaluate('JSON.stringify(localStorage)+JSON.stringify(sessionStorage)')
     row['passed']=True
    except Exception as e:
     row['error']=str(e);row['page_errors']=errors;await page.screenshot(path=str(OUT/f'FAIL-{case}-{theme}.png'))
    rows.append(row);print(json.dumps(row),flush=True);await context.close()
  await browser.close()
 (OUT/'results.json').write_text(json.dumps(rows,indent=2));assert all(row['passed'] for row in rows)
asyncio.run(main())
