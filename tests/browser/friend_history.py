"""Actual bounded-history UI; isolated API fixtures, not encryption or hosted capacity proof."""
import asyncio,json,os
from pathlib import Path
from playwright.async_api import async_playwright,expect
BASE=os.environ.get('QA_BASE_URL','http://127.0.0.1:4173')
OUT=Path('test-results/friend-history')
def mid(n):return f'95200000-0000-4000-8000-{n:012d}'
ROWS=[{'id':mid(n),'sender_id':'history-peer','ciphertext':'ZmFrZQ==','encryption_iv':'aXY=','encryption_version':1,'encrypted_attachments':[{'path':'e2ee/friend/sample.bin'}] if n==85 else [],'reply_to_id':None,'created_at':'2026-10-25T12:00:00+00:00','reactions':{}} for n in range(85,-1,-1)]
async def main():
 OUT.mkdir(parents=True,exist_ok=True);results=[]
 async with async_playwright() as p:
  browser=await p.chromium.launch(args=['--no-sandbox'])
  try:
   for theme,width in [('light',390),('dark',1280)]:
    context=await browser.new_context(viewport={'width':width,'height':900},service_workers='block')
    await context.add_init_script("sessionStorage.setItem('wehouse:e2ee:private-key:history-me','{}')")
    page=await context.new_page();errors=[];requests=[];fail={'page':False}
    page.on('pageerror',lambda error:errors.append(str(error)))
    async def route(handler):
     request=handler.request
     if request.url.startswith(BASE):return await handler.continue_()
     if not request.url.startswith('http://127.0.0.1:54321/'):return await handler.abort()
     headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'}
     if request.method=='OPTIONS':return await handler.fulfill(status=204,headers=headers)
     name=request.url.split('?')[0].split('/')[-1];args=json.loads(request.post_data or '{}');requests.append((name,args));data=[]
     if name=='current_profile_user_id':data='history-me'
     elif name=='user_encryption_identities':data={'user_id':'history-me'}
     elif name=='conversation_key_envelopes':data={'recipient_user_id':'history-me'}
     elif name=='get_message_pins':data=[{'message_id':mid(1)}]
     elif name=='get_friend_encrypted_messages_page':
      assert args['p_limit']==51
      if fail['page']:
       fail['page']=False
       return await handler.fulfill(status=503,headers=headers,content_type='application/json',body=json.dumps({'message':'Temporary history failure'}))
      data=[row for row in ROWS if not args['p_before_id'] or row['id']<args['p_before_id']][:51]
     elif name=='get_friend_message_history_cursor':data={'before':{'at':ROWS[0]['created_at'],'id':mid(2)}}
     else:raise AssertionError('Unexpected API '+name)
     return await handler.fulfill(status=200,headers=headers,content_type='application/json',body=json.dumps(data))
    await page.route('**/*',route)
    try:
     await page.goto(BASE+'/tests/browser/friend-history.html?theme='+theme)
     bubbles=page.locator('[data-message-id]')
     await expect(bubbles).to_have_count(50)
     await expect(page.get_by_role('button',name='Load 1 attachment',exact=True)).to_be_visible()
     assert not any('storage' in name or 'get_friend_encrypted_messages'==name for name,args in requests)
     await page.get_by_role('button',name='Earlier messages',exact=True).click()
     await expect(bubbles).to_have_count(36)
     await expect(page.locator(f'[data-message-id="{mid(0)}"]')).to_have_count(1)
     await page.get_by_role('button',name='Return to latest',exact=True).click()
     await expect(bubbles).to_have_count(50)
     await page.get_by_role('button',name='Open pinned message in history',exact=True).click()
     await expect(bubbles).to_have_count(2)
     await expect(page.locator(f'[data-message-id="{mid(1)}"]')).to_have_count(1)
     fail['page']=True
     await page.get_by_role('button',name='Return to latest',exact=True).click()
     await expect(page.get_by_role('alert')).to_contain_text('Messages could not be loaded')
     await page.get_by_role('button',name='Try again',exact=True).click()
     await expect(bubbles).to_have_count(50)
     assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
     assert not errors,errors
     await page.screenshot(path=str(OUT/f'history-{theme}.png'))
     results.append({'theme':theme,'width':width,'passed':True,'checks':['50-row latest page','all earlier messages reachable','return to latest','older pinned message lookup','failed page and retry','no attachment download while reading']})
    finally:await context.close()
  finally:await browser.close()
 (OUT/'results.json').write_text(json.dumps(results,indent=2));print(json.dumps(results))
if __name__=='__main__':asyncio.run(main())
