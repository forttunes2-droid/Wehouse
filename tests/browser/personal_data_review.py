"""Actual account/request/licence/reviewer components; synthetic APIs, no erasure."""
import asyncio,json,os
from pathlib import Path
from playwright.async_api import async_playwright,expect
BASE=os.environ.get('QA_BASE_URL','http://127.0.0.1:4173');OUT=Path('test-results/personal-data-review')
CONVERSATION='99700000-1000-4000-8000-000000000001';CASE='99700000-2000-4000-8000-000000000001';REVISION='2026-10-29T10:00:00Z'
LIBRARY_COUNT=len(json.loads(Path('dist/third-party-licences.json').read_text(encoding='utf8'))['packages'])
class Scenario:
 def __init__(self):self.calls=[];self.response=None;self.lose=False;self.fail_read=False;self.reject_stale=False;self.licence_fail=False
 def receipt(self):return {'conversation_id':CONVERSATION,'case_id':CASE,'case_number':123,'reason_code':'personal_data_deletion','status':'resolved' if self.response else 'investigating','revision':REVISION,'can_respond':not bool(self.response),'response':self.response}
 async def route(self,route):
  req=route.request
  if req.url.split('?')[0].endswith('/third-party-licences.json'):
   if self.licence_fail:return await route.fulfill(status=503,body='Unavailable')
   return await route.fulfill(content_type='application/json',body=Path('dist/third-party-licences.json').read_text(encoding='utf8'))
  if '127.0.0.1:54321' not in req.url:return await route.continue_()
  if req.method=='OPTIONS':return await route.fulfill(status=204,headers={'access-control-allow-origin':'*','access-control-allow-headers':'*'})
  name=req.url.split('?')[0].split('/')[-1];args=req.post_data_json or {};self.calls.append((name,args));data=None;status=200
  if name=='get_my_workspace_access':data={'identity':{'user_id':'experience-creator'},'personal_workspace':True,'privileged_workspaces':[]}
  elif name=='get_personal_data_case_review':
   if self.fail_read:status=503;data={'message':'Synthetic unavailable review'}
   else:data=self.receipt()
  elif name=='creator-step-up':data={'success':True,'creator_elevation_id':CASE,'expires_in_seconds':600}
  elif name=='delete_user_account':status=400;data={'message':'Synthetic active booking prevents account closure'}
  elif name=='respond_to_personal_data_case':
   if self.reject_stale:status=400;data={'code':'40001','message':'Refresh the request before recording its review response'}
   else:
    self.response={'request_id':args['p_request_id'],'outcome':args['p_outcome'],'completed':args['p_completed'],'retained':args['p_retained'],'responded_at':REVISION};data=self.receipt()
    if self.lose:status=503;data={'message':'Synthetic lost response'}
  await route.fulfill(status=status,content_type='application/json',body=json.dumps(data),headers={'access-control-allow-origin':'*'})
async def open_page(browser,mode,theme='light',width=390,s=None):
 s=s or Scenario();ctx=await browser.new_context(viewport={'width':width,'height':844},service_workers='block');p=await ctx.new_page();errors=[];p.on('pageerror',lambda e:errors.append(str(e)))
 await p.add_init_script("document.addEventListener('DOMContentLoaded',()=>{document.documentElement.dataset.whTheme="+json.dumps(theme)+";document.documentElement.classList.toggle('dark',"+json.dumps(theme=='dark')+");});")
 await p.route('**/*',s.route);await p.goto(BASE+'/tests/browser/personal-data-review.html?mode='+mode);return s,ctx,p,errors
async def fill_review(p):
 await p.get_by_label('Work completed and checked',exact=True).fill('Synthetic checked work only; no personal data erased.')
 await p.get_by_label('Information retained or work not completed, and why',exact=True).fill('Synthetic booking record retained because a payment claim remains unresolved.')
async def confirm(p):
 await p.get_by_role('button',name='Confirm and record review response',exact=True).click()
 await p.get_by_label('Creator security password',exact=False).fill('synthetic-test-password')
 await p.get_by_role('button',name='Confirm and continue',exact=True).click()
async def fits(p):assert await p.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
async def main():
 OUT.mkdir(parents=True,exist_ok=True);results=[]
 async with async_playwright() as pw:
  browser=await pw.chromium.launch(headless=True)
  for theme in ['light','dark']:
   for width in [320,768]:
    s,ctx,p,errors=await open_page(browser,'privacy',theme,width)
    for kind,label in [('access','Get a copy of my data'),('correction','Correct personal information'),('deletion','Request data deletion')]:
     await p.get_by_role('button',name=label,exact=False).click();context=await p.evaluate('window.__personalDataContext');assert context['contextType']=='contextual_help' and context['contextSnapshot']['reason_code']=='personal_data_'+kind and context['contextSnapshot']['source_id']=='experience-creator'
    assert not any('send' in n or 'create' in n for n,a in s.calls),'Opening a request submitted it without sending';await fits(p);assert not errors,errors;results.append(f'Account review intake {width} {theme}');await ctx.close()
    s,ctx,p,errors=await open_page(browser,'review',theme,width);await fill_review(p);await fits(p);await p.screenshot(path=str(OUT/f'review-{width}-{theme}.png'));await confirm(p)
    await expect(p.get_by_text('Review response recorded · partly completed',exact=True)).to_be_visible();assert await p.evaluate('window.__reviewResolved');assert len([a for n,a in s.calls if n=='respond_to_personal_data_case'])==1;assert not errors,errors;results.append(f'Review confirmed {width} {theme}');await ctx.close()
   s,ctx,p,errors=await open_page(browser,'licences',theme);await expect(p.get_by_text(f'{LIBRARY_COUNT} libraries',exact=True)).to_be_visible();await p.get_by_role('button',name='Show more libraries',exact=True).click();await p.get_by_label('Find a library or licence',exact=True).fill('@capgo/native-purchases');await p.get_by_role('button',name='@capgo/native-purchases',exact=False).click();await expect(p.get_by_text('Mozilla Public License',exact=False)).to_be_visible();await fits(p);await p.screenshot(path=str(OUT/f'licences-{theme}.png'));await p.get_by_role('button',name='Back',exact=True).click();await expect(p.get_by_label('Find a library or licence',exact=True)).to_be_visible();assert not errors,errors;results.append('Licence pagination, local search, original notice and Back '+theme);await ctx.close()
   s,ctx,p,errors=await open_page(browser,'close',theme);await expect(p.get_by_text('It does not erase all personal information.',exact=False)).to_be_visible();await p.get_by_role('textbox',name='Type CLOSE to confirm',exact=True).fill('CLOSE');await p.get_by_role('button',name='Close account',exact=True).click();await expect(p.get_by_text('Synthetic active booking prevents account closure',exact=False)).to_be_visible();await expect(p.get_by_role('button',name='Close account',exact=True)).to_be_enabled();assert len([a for n,a in s.calls if n=='delete_user_account'])==1;await fits(p);assert not errors,errors;results.append('Closure is distinct from erasure and recovers denied obligations '+theme);await ctx.close()
  s=Scenario();s.lose=True;s,ctx,p,errors=await open_page(browser,'review',s=s);await fill_review(p);await confirm(p);await expect(p.get_by_role('alert')).to_contain_text('Synthetic lost response');await p.get_by_role('button',name='Refresh review',exact=True).click();await expect(p.get_by_text('Review response recorded · partly completed',exact=True)).to_be_visible();assert len([a for n,a in s.calls if n=='respond_to_personal_data_case'])==1;assert not errors,errors;results.append('Unknown response recovered by receipt without second write');await ctx.close()
  s=Scenario();s.reject_stale=True;s,ctx,p,errors=await open_page(browser,'review',s=s);await fill_review(p);await confirm(p);await expect(p.get_by_role('alert')).to_contain_text('Refresh the request');await expect(p.get_by_role('textbox',name='Work completed and checked',exact=True)).to_be_enabled();assert not errors,errors;results.append('Stale rejection unlocks edits without fake completion');await ctx.close()
  s=Scenario();s.fail_read=True;s,ctx,p,errors=await open_page(browser,'review',s=s);await expect(p.get_by_role('alert')).to_be_visible();s.fail_read=False;await p.get_by_role('button',name='Refresh review',exact=True).click();await expect(p.get_by_role('combobox',name='Review outcome',exact=True)).to_be_visible();assert not errors,errors;results.append('Review read failure and retry');await ctx.close()
  s=Scenario();s.licence_fail=True;s,ctx,p,errors=await open_page(browser,'licences',s=s);await expect(p.get_by_role('alert')).to_be_visible();s.licence_fail=False;await p.get_by_role('button',name='Retry notices',exact=True).click();await expect(p.get_by_label('Find a library or licence',exact=True)).to_be_visible();assert not errors,errors;results.append('Licence failure and retry');await ctx.close();await browser.close()
 (OUT/'results.json').write_text(json.dumps(results,indent=2),encoding='utf8');print('Account review and library notice browser journeys passed:',len(results))
if __name__=='__main__':asyncio.run(main())
