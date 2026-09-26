"""Actual Login and guest entry with controlled pending Auth responses.
No credentials/provider/network request leaves the test; no auth policy is changed.
"""
import asyncio,json,os,subprocess
from pathlib import Path
from playwright.async_api import async_playwright,expect
OUT=Path('test-results/experience');B=Path('test-results/auth-pending-offline')
async def main():
 subprocess.run(['node','tests/browser/build-auth-pending.mjs'],check=True);OUT.mkdir(parents=True,exist_ok=True);results=[]
 async with async_playwright() as p:
  opts={'args':['--no-sandbox']}
  if os.getenv('CHROMIUM_PATH'):opts['executable_path']=os.environ['CHROMIUM_PATH']
  browser=await p.chromium.launch(**opts)
  for width in [320,390,768,1440]:
   for mode in ['success-device','success-account-error','password-error','google-pending','signup-confirmation']:
    context=await browser.new_context(viewport={'width':width,'height':844},service_workers='block');page=await context.new_page();page.set_default_timeout(3000);errors=[];page.on('pageerror',lambda e:errors.append(str(e)));row={'width':width,'case':mode,'passed':False}
    await page.route('**/*',lambda route:route.abort())
    try:
     await page.set_content('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>')
     # about:blank has no persistent storage. Use an isolated in-memory adapter;
     # the real Google-transaction implementation still reads/writes its keys.
     await page.evaluate("""() => { window.__authTest={calls:[]};for(const name of ['sessionStorage','localStorage']){const data=new Map();Object.defineProperty(window,name,{value:{getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,String(value)),removeItem:key=>data.delete(key),clear:()=>data.clear()}})}}""")
     await page.add_style_tag(path=str(B/'fixture.css'));await page.add_script_tag(path=str(B/'fixture.js'))
     await page.get_by_role('button',name='Sign in',exact=True).click()
     if mode=='google-pending':
      await page.get_by_role('button',name='Continue with Google',exact=True).click()
      await expect(page.get_by_role('button',name='Opening Google…',exact=True)).to_be_disabled()
      for label in ['Continue with email','Create account','Back to places']:
       await expect(page.get_by_role('button',name=label,exact=True)).to_be_disabled()
      await page.get_by_role('button',name='Opening Google…',exact=True).evaluate('(e)=>{e.dispatchEvent(new MouseEvent("click",{bubbles:true}));e.dispatchEvent(new MouseEvent("click",{bubbles:true}));}')
      assert len(await page.evaluate('window.__authTest.calls'))==1
      # Native Back is not a dead-end. The same pending operation may not be
      # submitted again from the landing masthead while its outcome is unknown.
      await page.go_back();await expect(page.get_by_role('button',name='Signing in…',exact=True)).to_be_disabled()
      await page.evaluate('window.__authTest.resolve({error:{message:"Network error"}})')
      await expect(page.get_by_role('button',name='Sign in',exact=True)).to_be_enabled()
     else:
      signup=mode=='signup-confirmation'
      await page.get_by_role('button',name='Create account' if signup else 'Continue with email',exact=True).click()
      await page.get_by_label('Email' if signup else 'Username or email',exact=True).fill('test@example.invalid')
      await page.locator('input[autocomplete="new-password"]' if signup else 'input[autocomplete="current-password"]').fill('not-a-real-password')
      await page.get_by_role('button',name='Create account' if signup else 'Sign in',exact=True).click()
      await expect(page.get_by_role('button',name='Creating account…' if signup else 'Signing in…',exact=True)).to_be_disabled()
      await expect(page.get_by_label('Email' if signup else 'Username or email',exact=True)).to_be_disabled()
      await page.locator('form').evaluate('(e)=>{e.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));e.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));}')
      assert len(await page.evaluate('window.__authTest.calls'))==1
      if mode=='password-error':
       await page.evaluate('window.__authTest.resolve({data:{session:null},error:{message:"Invalid login credentials"}})')
       await expect(page.get_by_role('button',name='Sign in',exact=True)).to_be_enabled()
       await expect(page.get_by_label('Username or email',exact=True)).to_have_value('test@example.invalid')
       await page.get_by_role('button',name='Sign in',exact=True).click()
       assert len(await page.evaluate('window.__authTest.calls'))==2
      elif signup:
       await page.evaluate('window.__authTest.resolve({data:{user:{id:"test-user"}},error:null})')
       await expect(page.get_by_role('heading',name='Confirm your email',exact=True)).to_be_visible()
       await expect(page.get_by_role('button',name='Verify with Google',exact=True)).to_be_enabled()
       await page.get_by_role('button',name='Verify with Google',exact=True).click()
       assert (await page.evaluate('window.__authTest.calls'))[-1]=={'name':'google','args':['test@example.invalid','signup']}
      else:
       await page.evaluate('window.__authTest.resolve({data:{session:{user:{id:"test-user"}}},error:null})')
       await expect(page.get_by_role('button',name='Signing in…',exact=True)).to_be_disabled()
       await page.locator('form').evaluate('(e)=>e.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}))')
       assert len(await page.evaluate('window.__authTest.calls'))==1
       if mode=='success-device':
        await page.screenshot(path=str(OUT/f'signin-pending-{width}.png'))
        await page.evaluate('window.__pendingDevice()')
        await expect(page.get_by_role('heading',name='Confirm this device',exact=True)).to_be_visible()
        await expect(page.get_by_role('button',name='Verify with Google',exact=True)).to_be_enabled()
       else:
        await page.evaluate('window.__accountError()')
        await expect(page.get_by_role('button',name='Sign in',exact=True)).to_be_enabled()
     assert not errors,errors;assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth+1');row['passed']=True
    except Exception as e:
     row['error']=str(e);row['page_errors']=errors;await page.screenshot(path=str(OUT/f'auth-pending-FAIL-{mode}-{width}.png'))
    finally:results.append(row);print(json.dumps(row),flush=True);await context.close()
  await browser.close()
 (OUT/'auth-pending-results.json').write_text(json.dumps(results,indent=2));assert all(r['passed'] for r in results)
asyncio.run(main())
