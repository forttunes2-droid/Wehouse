"""Shared real components and canonical selectors, with isolated fixture APIs.
This does not claim a real two-account encrypted send; that remains a separate gate.
"""
import asyncio,base64,io,json,os,subprocess,wave
from pathlib import Path
from playwright.async_api import async_playwright,expect
OUT=Path('test-results/experience');BUNDLE=Path('test-results/attachment-offline')
IMAGE_BODY='<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><rect width="800" height="500" fill="#eee7dc"/><rect y="360" width="800" height="140" fill="#b8ac99"/><path d="M145 350V195L400 65l255 130v155Z" fill="#faf6ee"/><path d="M115 195L400 45l285 150" fill="none" stroke="#554337" stroke-width="22"/><rect x="350" y="235" width="100" height="125" fill="#8c7964"/><g fill="#b9ccd2" stroke="#554337" stroke-width="10"><rect x="210" y="220" width="90" height="80"/><rect x="500" y="220" width="90" height="80"/></g></svg>'
def audio_fixture():
 stream=io.BytesIO()
 with wave.open(stream,'wb') as audio:
  audio.setnchannels(1);audio.setsampwidth(2);audio.setframerate(8000);audio.writeframes(bytes(8000*2*2))
 return stream.getvalue()
AUDIO_BODY=audio_fixture()
class Scenario:
 def __init__(self):self.errors=[];self.calls=[]
 async def route(self,handler):
  if handler.request.url.startswith('https://assets.wehouse.test/home.svg'):
   return await handler.fulfill(status=200,content_type='image/svg+xml',body=IMAGE_BODY)
  if handler.request.url=='https://assets.wehouse.test/test-voice.wav':
   start=int(handler.request.headers.get('range','bytes=0-').split('=')[1].split('-')[0] or '0')
   body=AUDIO_BODY[start:]
   return await handler.fulfill(status=206,content_type='audio/wav',headers={'accept-ranges':'bytes','content-range':f'bytes {start}-{len(AUDIO_BODY)-1}/{len(AUDIO_BODY)}','content-length':str(len(body))},body=body)
  return await handler.abort()

async def open_fixture(browser,mode,width):
 scenario=Scenario()
 context=await browser.new_context(viewport={'width':width,'height':844},service_workers='block',has_touch=True)
 page=await context.new_page();page.on('pageerror',lambda error:scenario.errors.append(str(error)))
 await page.route('**/*',scenario.route)
 await page.set_content('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><div id="root"></div></body></html>')
 await page.evaluate('(mode)=>{window.__attachmentMode=mode}',mode)
 await page.add_style_tag(path=str(BUNDLE/'fixture.css'));await page.add_script_tag(path=str(BUNDLE/'fixture.js'))
 return context,page,scenario
async def swipe(page, target, dx, dy=0):
 await target.scroll_into_view_if_needed()
 box=await target.bounding_box();assert box
 x=box['x']+box['width']/2;y=box['y']+box['height']/2
 session=await page.context.new_cdp_session(page)
 await session.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':x,'y':y}]})
 for i in range(1,9):
  await session.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':[{'x':x+dx*i/8,'y':y+dy*i/8}]})
 await session.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
 await page.wait_for_timeout(150);await session.detach()

async def fits(page):
 assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
 for button in await page.locator('.wh-attachment-remove').all():
  box=await button.bounding_box();assert box and box['width']>=44 and box['height']>=44
async def main():
 subprocess.run(['node','tests/browser/build-attachment-fixture.mjs'],check=True)
 OUT.mkdir(parents=True,exist_ok=True);results=[]
 async with async_playwright() as p:
  opts={'headless':True,'args':['--no-sandbox']}
  if os.getenv('CHROMIUM_PATH'):opts['executable_path']=os.environ['CHROMIUM_PATH']
  browser=await p.chromium.launch(**opts)
  try:
   for width in [320,390,768,1440]:
    for mode in ['shared','picker','gallery','request','unavailable','error','hotel','policy','swipe-property','swipe-own-property','swipe-photo']:
     context,page,scenario=await open_fixture(browser,{'swipe-property':'shared','swipe-own-property':'own-shared','swipe-photo':'gallery'}.get(mode,mode),width)
     try:
      if mode.startswith('swipe-'):
       is_photo=mode=='swipe-photo';is_own=mode=='swipe-own-property'
       target=page.get_by_role('button',name='Open photo 1 of 5' if is_photo else 'View Courtyard Long Let',exact=True)
       await expect(target).to_be_visible();direction=-1 if is_own else 1
       await swipe(page,target,-direction*94)
       assert await page.evaluate('window.__replies||0')==0
       assert await page.evaluate('!window.__opened')
       await swipe(page,target,0,35)
       assert await page.evaluate('window.__replies||0')==0
       await swipe(page,target,direction*94)
       assert await page.evaluate('window.__replies')==1
       assert await page.evaluate('!window.__opened')
       await expect(page.get_by_role('dialog',name='Shared media',exact=True)).to_have_count(0)
       await expect(page.get_by_label('Reply selected',exact=True)).to_be_visible()
       await page.get_by_placeholder('Message').fill('This works for me')
       await page.get_by_role('button',name='Send message',exact=True).click()
       assert await page.evaluate('window.__replyIds[0]')=='message'
       await expect(page.get_by_text('This works for me',exact=True)).to_be_visible()
       await expect(page.get_by_label('Reply selected',exact=True)).to_have_count(0)
       await fits(page);await page.screenshot(path=str(OUT/f'wehouse-{mode}-{width}.png'))
       await target.click()
       if is_photo:
        await expect(page.get_by_role('dialog',name='Shared media',exact=True)).to_be_visible()
        await page.keyboard.press('Escape')
       else:
        assert await page.evaluate('window.__opened.id')=='long-home'
      elif mode=='shared':
       card=page.get_by_role('button',name='View Courtyard Long Let',exact=True)
       await expect(card).to_be_visible();await fits(page)
       await page.screenshot(path=str(OUT/f'wehouse-shared-property-message-{width}.png'))
       await card.click();assert await page.evaluate('window.__opened.page')=='detail'
       assert await page.evaluate('window.__opened.id')=='long-home'
       assert await page.evaluate('(window.__actions||0)+(window.__replies||0)')==0
      elif mode=='picker':
       await expect(page.get_by_role('dialog',name='Share property',exact=True)).to_be_visible()
       await expect(page.get_by_placeholder('Search name or username')).not_to_be_focused()
       await expect(page.get_by_role('button',name='Ada Example @ada-example')).to_be_visible()
       await expect(page.get_by_text('Blocked Example',exact=True)).to_have_count(0)
       await expect(page.get_by_text('Pending Example',exact=True)).to_have_count(0)
       await page.screenshot(path=str(OUT/f'wehouse-send-property-picker-{width}.png'))
       await page.get_by_role('button',name='Ada Example @ada-example').click()
       assert await page.evaluate('window.__conversation')=='chat-ada'
       assert await page.evaluate('(window.__sent||[]).length')==0
       draft=page.get_by_label('Property ready to send',exact=True)
       await expect(draft).to_be_visible();await expect(draft.locator('.wh-property-title')).to_have_text('Courtyard Long Let')
       box=await draft.bounding_box();assert box['height']<=130
       await expect(draft.get_by_role('button',name='View Courtyard Long Let')).to_have_count(0)
       await page.get_by_placeholder('Message').fill('Would this work for us?')
       await fits(page);await page.screenshot(path=str(OUT/f'wehouse-property-draft-{width}.png'))
       await page.get_by_role('button',name='Remove property from message').click()
       await expect(page.get_by_placeholder('Message')).to_have_value('Would this work for us?')
       await expect(draft).to_have_count(0)
       # Reopen to prove the attachment plus caption becomes one explicit send.
       await page.evaluate('window.__reopenPicker()')
       await page.get_by_role('button',name='Ada Example @ada-example').click()
       await page.get_by_placeholder('Message').fill('Please check this place')
       await page.get_by_role('button',name='Send message',exact=True).click()
       assert await page.evaluate('window.__sent.length')==1
       assert await page.evaluate('window.__sent[0]')=='Please check this place\n\nhttps://wehouse.com.ng/#place/listing/long-home'
       await expect(page.get_by_role('button',name='View Courtyard Long Let',exact=True)).to_be_visible()
       assert await page.evaluate('window.__attachmentTransport.calls.every(call=>!(/payment|reservation|shared_housing/.test(call.name)))')
      elif mode=='gallery':
       await expect(page.get_by_role('button',name='Open photo 1 of 5',exact=True)).to_be_visible()
       await expect(page.get_by_text('+1',exact=True)).to_be_visible()
       assert await page.locator('a[href^="javascript:"]').count()==0
       await expect(page.get_by_text('Documents are not supported in chat.',exact=True)).to_be_visible()
       assert await page.locator('a[download],a[href*="lease.pdf"]').count()==0
       await expect(page.get_by_label('Voice note position',exact=True)).to_be_enabled()
       await page.get_by_role('button',name='Playback speed 1 times',exact=True).click()
       await expect(page.get_by_role('button',name='Playback speed 1.5 times',exact=True)).to_be_visible()
       await page.get_by_role('button',name='Play voice note',exact=True).click()
       await expect(page.get_by_role('button',name='Pause voice note',exact=True)).to_be_visible()
       await page.get_by_role('button',name='Pause voice note',exact=True).click()
       await page.get_by_label('Voice note position',exact=True).fill('1')
       assert await page.locator('audio').evaluate('audio => audio.currentTime')>=.9
       await page.screenshot(path=str(OUT/f'wehouse-message-media-{width}.png'))
       await page.locator('audio').evaluate("audio => { audio.play=()=>Promise.reject(new DOMException('Synthetic blocked playback','NotAllowedError')); }")
       await page.get_by_role('button',name='Play voice note',exact=True).click()
       await expect(page.get_by_role('button',name='Retry voice note',exact=True)).to_be_visible()
       await expect(page.get_by_text('Voice note unavailable. Tap to retry.',exact=True)).to_be_visible()
       await page.get_by_role('button',name='Open photo 1 of 5',exact=True).click()
       await expect(page.get_by_role('dialog',name='Shared media',exact=True)).to_be_visible()
       assert await page.evaluate('document.getElementById("root").inert')
       await page.keyboard.press('ArrowRight');await page.keyboard.press('Escape')
       await expect(page.get_by_role('dialog')).to_have_count(0)
       assert await page.evaluate('!document.getElementById("root").inert')
       assert await page.evaluate('(window.__actions||0)+(window.__replies||0)')==0
       await page.evaluate('window.__files()')
       await expect(page.get_by_role('button',name='Remove room-photo.png',exact=True)).to_be_visible()
       await page.get_by_role('button',name='Remove room-photo.png',exact=True).click()
       await expect(page.get_by_role('button',name='Remove room-photo.png',exact=True)).to_have_count(0)
       await expect(page.get_by_role('button',name='Remove Voice note',exact=True)).to_be_visible()
      elif mode=='policy':
       await expect(page.get_by_role('button',name='Add photo or video',exact=True)).to_be_visible()
       picker=page.locator('input[type=file]');accept=await picker.get_attribute('accept')
       assert 'video/mp4' in accept and all(value not in accept for value in ['audio','application','text','*'])
       await page.get_by_placeholder('Message').fill('Keep this message while I choose a photo')
       for name,mime,body in [('lease.pdf','application/pdf',b'%PDF-1.7'),('renamed.png','image/png',b'%PDF-1.7'),('voice.webm','audio/webm',b'not-from-recorder')]:
        await picker.set_input_files({'name':name,'mimeType':mime,'buffer':body})
        await expect(page.get_by_role('alert')).to_be_visible()
        await expect(page.locator('.wh-attachment-remove')).to_have_count(0)
        await expect(page.get_by_placeholder('Message')).to_have_value('Keep this message while I choose a photo')
       photo=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR0sAAAAASUVORK5CYII=')
       await picker.set_input_files({'name':'room.png','mimeType':'image/png','buffer':photo})
       await expect(page.get_by_role('alert')).to_have_count(0)
       await expect(page.get_by_role('button',name='Remove room.png',exact=True)).to_be_visible()
       await page.get_by_role('button',name='Remove room.png',exact=True).click()
       await expect(page.get_by_placeholder('Message')).to_have_value('Keep this message while I choose a photo')
       await page.screenshot(path=str(OUT/f'wehouse-media-only-policy-{width}.png'))
      elif mode=='request':
       summary=page.locator('summary');await expect(summary).to_be_visible()
       box=await summary.bounding_box();assert box['height']<=80
       await expect(page.get_by_text('Please arrange a quiet room.\nI may arrive at 6 pm.',exact=True)).not_to_be_visible()
       await page.screenshot(path=str(OUT/f'wehouse-booking-note-collapsed-{width}.png'))
       await summary.click();await expect(page.get_by_text('Please arrange a quiet room.\nI may arrive at 6 pm.',exact=True)).to_be_visible()
       await page.screenshot(path=str(OUT/f'wehouse-booking-note-expanded-{width}.png'))
       await page.get_by_placeholder('Message').fill('Thank you')
       await summary.click();await expect(page.get_by_placeholder('Message')).to_have_value('Thank you')
      elif mode=='unavailable':
       await expect(page.get_by_text('This shared property is no longer available.',exact=True)).to_be_visible()
       await expect(page.locator('main').get_by_role('button')).to_have_count(0)
      elif mode=='error':
       await expect(page.get_by_text('Property preview could not be loaded.',exact=True)).to_be_visible()
       await page.evaluate('window.__attachmentTransport.failProperty=false')
       await page.get_by_role('button',name='Try again',exact=True).click()
       await expect(page.get_by_role('button',name='View Courtyard Long Let',exact=True)).to_be_visible()
      elif mode=='hotel':
       await page.get_by_role('button',name='View Garden Lodge',exact=True).click()
       assert await page.evaluate('window.__opened.page')=='hotel_detail'
       assert await page.evaluate('window.__opened.id')=='7'
      await fits(page);assert not scenario.errors,scenario.errors
      results.append({'case':mode,'width':width,'passed':True,'page_errors':scenario.errors})
     finally:await context.close()
  finally:
   (OUT/'message-attachments-results.json').write_text(json.dumps(results,indent=2));await browser.close()
 print(json.dumps(results,indent=2))
if __name__=='__main__':asyncio.run(main())
