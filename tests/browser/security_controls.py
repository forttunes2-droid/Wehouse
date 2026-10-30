"""Actual Admin recovery and signed-out review contact; isolated transport only."""
import asyncio,json
from pathlib import Path
from playwright.async_api import async_playwright,expect
BASE='http://127.0.0.1:4173';OUT=Path('test-results/security-controls');OUT.mkdir(parents=True,exist_ok=True)
CASE='b8110000-2000-4000-8000-000000000001';STAMP='2026-10-27T12:00:00.123456Z'
async def main():
 results=[]
 async with async_playwright() as p:
  browser=await p.chromium.launch(args=['--no-sandbox'])
  for theme,width in [('light',390),('dark',1440)]:
   context=await browser.new_context(viewport={'width':width,'height':900},service_workers='block');page=await context.new_page();calls=[];errors=[]
   state={'read_fail':True,'resolved':False,'support_fail':True,'contact':True}
   page.on('pageerror',lambda e:errors.append(str(e)))
   async def route(handler):
    req=handler.request
    if req.url.startswith(BASE):return await handler.continue_()
    if not req.url.startswith('http://127.0.0.1:54321/'):return await handler.abort()
    headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'}
    if req.method=='OPTIONS':return await handler.fulfill(status=204,headers=headers)
    name=req.url.split('/')[-1];args=req.post_data_json or {};calls.append({'name':name,'args':args});data={};status=200
    if name=='get_my_admin_security_cases':
     if state['read_fail']:status=503;data={'message':'Synthetic private queue error'}
     else:data={'cases':[] if state['resolved'] else [{'operational_case_id':CASE,'case_number':25,'reason_code':'account_compromise','reason_label':'Account misconduct','subject_type':'account','subject_id':'person','subject_name':'Sample account','target_user_id':'person','status':'decision_ready','priority':'normal','updated_at':STAMP}]}
    elif name=='admin_security_case_decision_v2':state['resolved']=True;status=503;data={'message':'Synthetic response lost after decision'}
    elif name=='get_public_account_support':
     if state['support_fail']:status=503;data={'message':'Synthetic support outage'}
     else:data={'email':'review@example.invalid' if state['contact'] else None}
    return await handler.fulfill(status=status,content_type='application/json',body=json.dumps(data),headers=headers)
   await context.add_init_script('''(()=>{const now=Math.floor(Date.now()/1000),enc=o=>btoa(JSON.stringify(o)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');const id='b8220000-1111-4111-8111-000000000001';const jwt=enc({alg:'HS256',typ:'JWT'})+'.'+enc({sub:id,role:'authenticated',aud:'authenticated',aal:'aal2',session_id:id,amr:[{method:'totp',timestamp:now}],iat:now,exp:now+3600})+'.c3ludGhldGlj';localStorage.setItem('sb-127-auth-token',JSON.stringify({access_token:jwt,refresh_token:'synthetic-refresh',expires_at:now+3600,expires_in:3600,token_type:'bearer',user:{id,aud:'authenticated',role:'authenticated',email:'admin@example.invalid',factors:[{id,status:'verified',factor_type:'totp'}]}}));})()''')
   await page.route('**/*',route)
   await page.goto(BASE+f'/tests/browser/rent-terms.html?mode=security-cases&theme={theme}')
   await expect(page.get_by_role('alert')).to_contain_text('could not be loaded');await expect(page.get_by_text('No open Security Operations',exact=False)).to_have_count(0)
   state['read_fail']=False;await page.get_by_role('button',name='Refresh security cases',exact=True).click()
   await page.get_by_role('button').filter(has_text='Account misconduct').click()
   await page.get_by_role('button').filter(has_text='Temporarily suspend account').click()
   await expect(page.get_by_role('button',name='Confirm decision',exact=True)).to_be_disabled()
   await page.get_by_placeholder('Required decision reason…').fill('Reviewed misconduct; temporary account restriction')
   await page.screenshot(path=str(OUT/f'admin-{theme}.png'),full_page=True)
   await page.get_by_role('button',name='Confirm decision',exact=True).click()
   await expect(page.get_by_role('alert')).to_contain_text('could not be confirmed')
   await page.get_by_role('button',name='Refresh security cases',exact=True).click()
   await expect(page.get_by_text('No open Security Operations cases need Admin attention.',exact=True)).to_be_visible()
   decisions=[c for c in calls if c['name']=='admin_security_case_decision_v2'];assert len(decisions)==1 and decisions[0]['args']['p_expected_updated_at']==STAMP and decisions[0]['args']['p_decision']=='suspend'
   await page.goto(BASE+f'/tests/browser/rent-terms.html?mode=account-help&theme={theme}');await page.get_by_text('Account access or suspension help',exact=True).click()
   await expect(page.get_by_role('alert')).to_contain_text('could not be loaded')
   state['support_fail']=False;await page.get_by_role('button',name='Refresh support contact',exact=True).click()
   link=page.get_by_role('link',name='Email WeHouse about account access',exact=True);await expect(link).to_have_attribute('href','mailto:review@example.invalid?subject=WeHouse%20account%20access%20review')
   assert all(c['args']=={} for c in calls if c['name']=='get_public_account_support')
   await page.get_by_role('button',name='Prepare an account review request',exact=True).click()
   await expect(page.get_by_role('button',name='Open review request in email',exact=True)).to_be_disabled()
   await page.get_by_role('textbox',name='Username',exact=False).fill('sample.person')
   await page.get_by_label('Restriction or booking reference (optional)',exact=True).fill('CASE-123')
   await page.get_by_role('textbox',name='Why should WeHouse review this restriction?',exact=False).fill('The restriction appears to refer to another booking. Please review the reference.')
   draft=page.get_by_role('link',name='Open review request in email',exact=True)
   href=await draft.get_attribute('href')
   from urllib.parse import urlparse,parse_qs
   prepared=parse_qs(urlparse(href).query)['body'][0]
   assert 'sample.person' in prepared and 'CASE-123' in prepared and 'another booking' in prepared
   await expect(page.get_by_text('This prepares an email on your device.',exact=False)).to_be_visible()
   await expect(page.get_by_text('A review request does not automatically restore access.',exact=False)).to_be_visible()
   await page.screenshot(path=str(OUT/f'account-review-{theme}.png'),full_page=True)
   state['contact']=False;await page.reload();await page.get_by_text('Account access or suspension help',exact=True).click();await expect(page.get_by_text('The public support address has not been published yet.',exact=True)).to_be_visible();await expect(link).to_have_count(0)
   assert not errors,errors;assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
   results.append({'theme':theme,'width':width,'queue_error_not_empty':True,'lost_decision_recovery':True,'case_version_sent':True,'published_contact_only':True,'passed':True});await context.close()
  await browser.close()
 (OUT/'results.json').write_text(json.dumps(results,indent=2));print(json.dumps(results))
asyncio.run(main())
