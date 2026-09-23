"""Production components with an offline synthetic transport.
No production data, accounts, payment providers or network requests are used.
Exercises the actual DOM lock cleanup, workspace hook and hotel message loader.
"""
import asyncio, json, os, subprocess
from pathlib import Path
from playwright.async_api import async_playwright, expect
OUT=Path('test-results/experience'); BUNDLE=Path('test-results/repair-offline')
async def mount(browser, mode, width=390):
 context=await browser.new_context(viewport={'width':width,'height':844},service_workers='block')
 page=await context.new_page(); errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 await page.route('**/*',lambda route:route.abort())
 await page.set_content('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="background:#090B10"><div id="preserved" inert></div><div id="root"></div></body></html>')
 await page.evaluate('mode=>{window.__mode=mode; if(!crypto.randomUUID)crypto.randomUUID=()=>"test-"+Math.random().toString(16).slice(2)}',mode)
 await page.add_style_tag(path=str(BUNDLE/'fixture.css'));await page.add_script_tag(path=str(BUNDLE/'fixture.js'))
 return context,page,errors
async def unlocked(page):
 await expect(page.get_by_role('dialog')).to_have_count(0)
 assert await page.evaluate('!document.getElementById("root").inert && document.body.style.overflow!=="hidden"')
 assert await page.evaluate('document.getElementById("preserved").inert')
async def main():
 subprocess.run(['node','tests/browser/build-repair-fixture.mjs'],check=True)
 OUT.mkdir(parents=True,exist_ok=True); results=[]
 async with async_playwright() as p:
  opts={'headless':True}
  if os.environ.get('CHROMIUM_PATH'):opts['executable_path']=os.environ['CHROMIUM_PATH']
  browser=await p.chromium.launch(**opts)
  try:
   for width in [390,768,1440]:
    context,page,errors=await mount(browser,'workspace',width)
    try:
     await expect(page.get_by_test_id('access-state')).to_have_text('ready')
     # Explicit choice must survive a late refresh even when storage is unavailable.
     await page.get_by_role('button',name='Select Partner',exact=True).click()
     await page.evaluate('window.__transport.holdAccess=true')
     await page.get_by_role('button',name='Refresh workspaces',exact=True).click()
     await page.get_by_role('button',name='Select Personal',exact=True).click()
     await page.evaluate('window.__transport.releaseAccess()')
     await expect(page.get_by_test_id('active-workspace')).to_have_text('personal')
     # The original bug: parent and child close together and restore in the wrong order.
     for n in range(3):
      await page.get_by_role('button',name='Open profile',exact=True).click()
      await page.get_by_role('button',name='Open nested profile',exact=True).click()
      assert await page.evaluate('document.getElementById("root").inert')
      await page.get_by_role('button',name='Switch workspace',exact=True).click()
      await unlocked(page)
      await page.get_by_role('button',name='Personal details',exact=True).click()
      await expect(page.locator('output')).to_have_text(str(n+1))
     # Custom select must sit above the profile, never behind an inert layer.
     await page.get_by_role('button',name='Open profile',exact=True).click()
     await page.get_by_label('Profile filter').click()
     await expect(page.get_by_role('dialog',name='Profile filter',exact=True)).to_be_visible()
     await page.get_by_role('button',name='Homes',exact=True).click()
     await expect(page.get_by_label('Profile filter')).to_have_value('Homes')
     await page.keyboard.press('Escape');await unlocked(page)
     # Revocation is still authoritative; client choice does not create permissions.
     await page.get_by_role('button',name='Select Partner',exact=True).click()
     await page.evaluate('window.__transport.access.privileged_workspaces=[]')
     await page.get_by_role('button',name='Refresh workspaces',exact=True).click()
     await expect(page.get_by_test_id('active-workspace')).to_have_text('personal')
     assert not errors,errors
     await page.screenshot(path=str(OUT/f'account-after-workspace-switch-{width}.png'))
     results.append({'test':'workspace-lock-and-access','width':width,'passed':True,'page_errors':errors})
    finally:await context.close()
    context,page,errors=await mount(browser,'chat',width)
    try:
     dialog=page.get_by_role('dialog',name='Guest Example',exact=True)
     await expect(dialog).to_be_visible()
     await expect(page.get_by_text('Arriving after six',exact=True)).to_be_visible()
     await expect(page.get_by_text('Loading attachment…',exact=True)).to_be_visible()
     assert await page.evaluate('window.__transport.holdMedia')
     await page.locator('summary').filter(has_text='Special request').click()
     await expect(page.get_by_text('Please arrange a quiet room.\nI may arrive at 6 pm.',exact=True)).to_be_visible()
     await page.screenshot(path=str(OUT/f'hotel-special-request-in-conversation-{width}.png'))
     colleague=page.get_by_text('We have noted your quiet-room request.',exact=True)
     assert await colleague.evaluate('(el)=>Boolean(el.closest(".justify-end"))')
     await expect(page.get_by_text('Reception A',exact=True)).to_be_visible()
     before=await page.evaluate('window.__transport.calls.filter(c=>c.name==="get_my_hotel_conversation_bundle").length')
     await page.evaluate('window.__rerender()')
     await page.wait_for_timeout(50)
     assert await page.evaluate('window.__transport.calls.filter(c=>c.name==="get_my_hotel_conversation_bundle").length')==before
     # A pending send remains present through another server snapshot.
     await page.get_by_placeholder('Message',exact=True).fill('We have noted your arrival time.')
     await page.get_by_role('button',name='Send message',exact=True).click()
     await expect(page.get_by_text('We have noted your arrival time.',exact=True)).to_have_count(1)
     await page.evaluate('window.__transport.fire()')
     await expect(page.get_by_text('We have noted your arrival time.',exact=True)).to_have_count(1)
     await page.evaluate('window.__transport.releaseSend()')
     await expect(page.get_by_text('We have noted your arrival time.',exact=True)).to_have_count(1)
     await expect(page.get_by_text('Sending…',exact=False)).to_have_count(0)
     # A failed old send cannot replace a new draft.
     await page.get_by_placeholder('Message',exact=True).fill('Old unsent note')
     await page.get_by_role('button',name='Send message',exact=True).click()
     await page.get_by_placeholder('Message',exact=True).fill('New draft must survive')
     await page.evaluate('window.__transport.releaseSend(true)')
     await expect(page.get_by_placeholder('Message',exact=True)).to_have_value('New draft must survive')
     await expect(page.get_by_text('Not sent',exact=False)).to_have_count(1)
     await page.evaluate('window.__transport.releaseMedia()')
     # Old in-flight reads must not paint a different guest booking.
     await page.evaluate('window.__transport.holdMessages=true;window.__transport.fire();window.__otherBooking()')
     await page.evaluate('window.__transport.releaseMessages()')
     await expect(page.get_by_role('dialog',name='Other guest',exact=True)).to_be_visible()
     await expect(page.get_by_text('Other booking only',exact=True)).to_be_visible()
     await expect(page.get_by_text('Arriving after six',exact=True)).to_have_count(0)
     await expect(page.get_by_text('Special request',exact=True)).to_have_count(0)
     await page.get_by_role('button',name='Back to Inbox',exact=True).click()
     await unlocked(page)
     await page.get_by_role('button',name='Open chat',exact=True).click()
     await expect(page.get_by_text('Other booking only',exact=True)).to_be_visible()
     assert not errors,errors
     results.append({'test':'hotel-request-and-delivery','width':width,'passed':True,'page_errors':errors})
    finally:await context.close()
    context,page,errors=await mount(browser,'guest-chat',width)
    try:
     await expect(page.get_by_role('dialog',name='Garden Lodge',exact=True)).to_be_visible()
     reply=page.get_by_text('We have noted your quiet-room request.',exact=True)
     await expect(reply).to_be_visible()
     assert await reply.evaluate('(el)=>Boolean(el.closest(".justify-start"))')
     await page.locator('summary').filter(has_text='Special request').click()
     await expect(page.get_by_text('Please arrange a quiet room.\nI may arrive at 6 pm.',exact=True)).to_be_visible()
     await page.get_by_placeholder('Message',exact=True).fill('Thank you. Is parking available?')
     await page.get_by_role('button',name='Send message',exact=True).click()
     followup=page.get_by_text('Thank you. Is parking available?',exact=True)
     await expect(followup).to_have_count(1)
     assert await followup.evaluate('(el)=>Boolean(el.closest(".justify-end"))')
     await page.evaluate('window.__transport.releaseSend()')
     await expect(page.get_by_text('Sending…',exact=False)).to_have_count(0)
     assert await page.evaluate('window.__transport.calls.filter(c=>c.name==="send_hotel_booking_message").every(c=>c.args.p_conversation_id==="alpha")')
     assert await page.evaluate('window.__transport.calls.filter(c=>c.name==="open_my_hotel_booking_conversation").length')==0
     await page.screenshot(path=str(OUT/f'hotel-guest-request-reply-followup-{width}.png'))
     # A live revocation removes old context, messages and the composer together.
     await page.evaluate('window.__transport.denyContext=true;window.__transport.fire()')
     await expect(page.get_by_text('Messages could not be refreshed. Please try again.',exact=True)).to_be_visible()
     await expect(page.get_by_text('We have noted your quiet-room request.',exact=True)).to_have_count(0)
     await expect(page.get_by_placeholder('Message',exact=True)).to_have_count(0)
     await expect(page.get_by_text('Special request',exact=True)).to_have_count(0)
     assert not errors,errors
     results.append({'test':'guest-hotel-reply-and-followup','width':width,'passed':True,'page_errors':errors})
    finally:await context.close()
    context,page,errors=await mount(browser,'bill',width)
    try:
     await expect(page.get_by_text('Stay charge',exact=True)).to_be_visible()
     await expect(page.get_by_text('₦240,000',exact=True)).to_be_visible()
     await expect(page.get_by_text('₦50,000',exact=True)).to_be_visible()
     await expect(page.get_by_text('₦290,000',exact=True)).to_be_visible()
     assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
     await page.screenshot(path=str(OUT/f'short-let-post-reservation-review-{width}.png'))
     results.append({'test':'short-let-itemized-review','width':width,'passed':not errors,'page_errors':errors})
    finally:await context.close()
  finally:
   (OUT/'workspace-repair-results.json').write_text(json.dumps(results,indent=2));await browser.close()
 print(json.dumps(results,indent=2))
if __name__=='__main__':asyncio.run(main())
