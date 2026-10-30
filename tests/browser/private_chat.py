"""Actual encryption component + IndexedDB/WebCrypto; synthetic Auth/RPC/PRF.
No real account, provider, passkey registration or external request is used.
"""
import asyncio,json,threading
from pathlib import Path
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from functools import partial
from playwright.async_api import async_playwright,expect
OUT=Path('test-results/private-chat-browser').resolve()
class Quiet(SimpleHTTPRequestHandler):
 def log_message(self,*args):pass
INIT="""({theme,state})=>{
 const persisted=localStorage.getItem('fixture:identity');if(persisted)state.identity=JSON.parse(persisted);window.__chatState=state;
 const credential=()=>({id:'c3ludGhldGljLWtleQ',rawId:Uint8Array.from(atob('c3ludGhldGljLWtleQ'),c=>c.charCodeAt(0)).buffer,type:'public-key',response:{clientDataJSON:new Uint8Array([1]).buffer,attestationObject:new Uint8Array([2]).buffer,getTransports:()=>['internal']},getClientExtensionResults:()=>state.prf?{prf:{enabled:true,results:{first:new Uint8Array(32).fill(9).buffer}},credProps:{rk:true}}:{prf:{}}});
 Object.defineProperty(navigator,'credentials',{value:{create:async()=>{if(state.cancel)throw new DOMException('Cancelled','NotAllowedError');return credential();},get:async()=>{if(state.cancel)throw new DOMException('Cancelled','NotAllowedError');return credential();}}});
 document.addEventListener('DOMContentLoaded',()=>{document.documentElement.dataset.whTheme=theme;document.documentElement.classList.toggle('dark',theme==='dark');});
}"""
async def open_page(browser,url,theme,width,state):
 ctx=await browser.new_context(viewport={'width':width,'height':900},service_workers='block');p=await ctx.new_page();errors=[];p.on('pageerror',lambda e:errors.append(str(e)))
 await p.route('**/*',lambda r:r.continue_() if r.request.url.startswith(url) else r.abort())
 await p.add_init_script('('+INIT+')('+json.dumps({'theme':theme,'state':state})+')');await p.goto(url);return ctx,p,errors
async def fits(p):assert await p.evaluate('document.documentElement.scrollWidth<=innerWidth'),'horizontal overflow'
async def main():
 server=ThreadingHTTPServer(('127.0.0.1',0),partial(Quiet,directory=str(OUT)));thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start();url='http://127.0.0.1:'+str(server.server_port)+'/'
 results=[]
 try:
  async with async_playwright() as pw:
   browser=await pw.chromium.launch(headless=True)
   for theme in ['light','dark']:
    for width in [320,768]:
     state={'identity':None,'calls':[],'passkeys':[],'prf':True,'cancel':False,'loseSave':False}
     ctx,p,errors=await open_page(browser,url,theme,width,state)
     await expect(p.get_by_text('Device ready',exact=True)).to_be_visible();assert await p.locator('input').count()==0;await fits(p)
     await p.evaluate('window.__chatState.cancel=true');await p.get_by_role('button',name='Create a passkey for backup',exact=True).click();await expect(p.get_by_role('alert')).to_contain_text('not completed');assert await p.evaluate('window.__chatState.identity.backup_scheme')=='device_only'
     await p.evaluate('window.__chatState.cancel=false;window.__chatState.prf=false');await p.get_by_role('button',name='Create a passkey for backup',exact=True).click();await expect(p.get_by_role('alert')).to_contain_text('no backup has been saved');assert await p.evaluate('window.__chatState.identity.backup_scheme')=='device_only'
     await p.evaluate('window.__chatState.prf=true');await p.get_by_role('button',name='Use existing passkey',exact=True).click();await expect(p.get_by_text('Passkey backup is on.',exact=False)).to_be_visible();identity=await p.evaluate('window.__chatState.identity')
     await p.reload();await expect(p.get_by_text('Device ready',exact=True)).to_be_visible();await expect(p.get_by_text('Passkey backup is on.',exact=False)).to_be_visible();await fits(p);await p.screenshot(path=str(OUT/(theme+'-'+str(width)+'.png')),full_page=True)
     assert not errors,errors;await ctx.close();results.append(theme+'-'+str(width)+' automatic / cancelled / unsupported / backup / reload')
     # New browser storage has no key; restoring preserves the same identity.
     other,p,errors=await open_page(browser,url,theme,width,{**state,'identity':identity,'prf':True})
     await expect(p.get_by_text('Recovery needed',exact=True)).to_be_visible();await p.get_by_role('button',name='Restore with passkey',exact=True).click();await expect(p.get_by_text('Device ready',exact=True)).to_be_visible();assert await p.evaluate('window.__chatState.identity.key_version')==1;await fits(p);assert not errors,errors;await other.close();results.append(theme+'-'+str(width)+' new-device restore')
    # Explicit loss confirmation can be dismissed without rotating a key.
    ctx,p,errors=await open_page(browser,url,theme,390,{**state,'identity':{**identity,'backup_scheme':'device_only'}})
    await expect(p.get_by_text('Recovery needed',exact=True)).to_be_visible();await p.get_by_role('button',name='Continue without previous history',exact=True).click();await expect(p.get_by_role('alertdialog')).to_contain_text('previous history');await p.get_by_role('button',name='Go back',exact=True).click();assert await p.evaluate('window.__chatState.identity.key_version')==1
    await p.get_by_role('button',name='Continue without previous history',exact=True).click();await p.get_by_role('button',name='Start new chats',exact=True).click();await expect(p.get_by_text('Device ready',exact=True)).to_be_visible();assert await p.evaluate('window.__chatState.identity.key_version')==2;assert not errors,errors;await ctx.close();results.append(theme+' explicit restart')
   await browser.close()
 finally:server.shutdown();server.server_close()
 (OUT/'results.json').write_text(json.dumps({'passed':len(results),'journeys':results,'scope':'Synthetic UI/IndexedDB/WebCrypto, not physical passkey or hosted Auth verification'},indent=2),encoding='utf-8');print(json.dumps({'passed':len(results)}))
asyncio.run(main())
