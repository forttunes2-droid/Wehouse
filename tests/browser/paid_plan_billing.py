"""Owner billing uses actual UI and isolated APIs; no cancellation or charge is sent."""
import asyncio,json,os
from pathlib import Path
from playwright.async_api import async_playwright,expect
BASE=os.environ.get('QA_BASE_URL','http://127.0.0.1:4173');OUT=Path('test-results/paid-plan-billing')
WORK={'kind':'worker','name':'Work tools plan','status':'active','provider':'paystack','period_end':'2027-01-01T10:00:00Z','billing_period':'monthly','price':4200,'currency':'NGN','auto_renews':True,'cancel_at_period_end':False,'last_verified_at':'2026-10-29T10:00:00Z','can_manage':True,'workspace_access':False}
PROPERTY={**WORK,'kind':'property_partner','name':'Property tools plan','provider':'prepaid','billing_period':None,'price':None,'currency':None,'auto_renews':False,'last_verified_at':None,'can_manage':False,'workspace_access':True}
class Scenario:
 def __init__(self):self.calls=[];self.fail_read=False;self.fail_manage=False;self.untrusted=False;self.empty=False;self.cancelled=False
 async def route(self,route):
  request=route.request
  if request.url.startswith('https://paystack.com/manage/subscriptions/'):
   return await route.fulfill(content_type='text/html',body='<h1>Controlled subscription management</h1>')
  if '127.0.0.1:54321' not in request.url:return await route.continue_()
  if request.method=='OPTIONS':return await route.fulfill(status=204,headers={'access-control-allow-origin':'*','access-control-allow-headers':'*'})
  name=request.url.split('?')[0].split('/')[-1];self.calls.append(name);data=None;status=200
  if name=='get_my_paid_plan_billing':
   data={'user_id':'experience-creator','plans':[] if self.empty else [{**WORK,'cancel_at_period_end':self.cancelled},PROPERTY]}
   if self.fail_read:status=503;data={'message':'Synthetic billing read unavailable'}
  elif name=='worker-pro-manage':
   data={'success':True,'url':'https://untrusted.invalid/manage' if self.untrusted else 'https://paystack.com/manage/subscriptions/fixture?subscription_token=synthetic'}
   if self.fail_manage:status=503;data={'success':False,'error':'Synthetic subscription management unavailable'}
  else:raise AssertionError('Unexpected billing API '+name)
  await route.fulfill(status=status,content_type='application/json',body=json.dumps(data),headers={'access-control-allow-origin':'*'})
async def open_page(browser,s=None,theme='light',width=390):
 s=s or Scenario();ctx=await browser.new_context(viewport={'width':width,'height':844},service_workers='block');page=await ctx.new_page();errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
 await page.add_init_script("document.addEventListener('DOMContentLoaded',()=>{document.documentElement.dataset.whTheme="+json.dumps(theme)+";document.documentElement.classList.toggle('dark',"+json.dumps(theme=='dark')+");});")
 await page.route('**/*',s.route);await page.goto(BASE+'/tests/browser/personal-data-review.html?mode=billing');return s,ctx,page,errors
async def main():
 OUT.mkdir(parents=True,exist_ok=True);results=[]
 async with async_playwright() as pw:
  browser=await pw.chromium.launch(headless=True)
  for theme in ('light','dark'):
   for width in (320,768):
    s,ctx,p,errors=await open_page(browser,theme=theme,width=width)
    await expect(p.get_by_text('This workspace is unavailable.',exact=False)).to_be_visible();await expect(p.get_by_text('Does not renew automatically',exact=True)).to_be_visible()
    button=p.get_by_role('button',name='Manage or cancel subscription',exact=True);await expect(button).to_have_count(1);assert (await button.bounding_box())['height']>=44
    await p.get_by_role('button',name='Get billing help',exact=True).click();context=await p.evaluate('window.__personalDataContext');assert context['contextSnapshot']=={'reason_code':'paid_plan_billing','subject_type':'account','source_id':'experience-creator','requester_workspace':'personal'}
    assert s.calls==['get_my_paid_plan_billing'];assert await p.evaluate('document.documentElement.scrollWidth<=innerWidth+1');await p.screenshot(path=str(OUT/f'billing-{width}-{theme}.png'),full_page=True)
    await button.evaluate('(button)=>{button.click();button.click();}');await expect(p.get_by_role('heading',name='Controlled subscription management',exact=True)).to_be_visible();assert s.calls.count('worker-pro-manage')==1;assert not errors,errors;results.append(f'Owner plan, restriction, prepaid contract, Help and single management action {width} {theme}');await ctx.close()
  for failure in ('fail_read','fail_manage','untrusted'):
   s=Scenario();setattr(s,failure,True);s,ctx,p,errors=await open_page(browser,s)
   if failure!='fail_read':await p.get_by_role('button',name='Manage or cancel subscription',exact=True).click()
   await expect(p.get_by_role('alert')).to_be_visible();assert p.url.startswith(BASE)
   setattr(s,failure,False)
   if failure=='fail_read':await p.get_by_role('button',name='Refresh billing',exact=True).click();await expect(p.get_by_text('Work tools plan',exact=True)).to_be_visible()
   else:await expect(p.get_by_role('button',name='Manage or cancel subscription',exact=True)).to_be_enabled()
   assert not errors,errors;results.append('Recoverable '+failure);await ctx.close()
  s=Scenario();s.empty=True;s,ctx,p,errors=await open_page(browser,s);await expect(p.get_by_text('No paid plans are recorded for this account.',exact=True)).to_be_visible();await expect(p.get_by_role('button',name='Manage or cancel subscription',exact=True)).to_have_count(0);assert not errors,errors;results.append('No plan is neither a fake plan nor a loading error');await ctx.close()
  s=Scenario();s.cancelled=True;s,ctx,p,errors=await open_page(browser,s);await expect(p.get_by_text('Cancellation at period end',exact=True)).to_be_visible();assert not errors,errors;results.append('Recorded renewal cancellation preserves paid-period disclosure');await ctx.close();await browser.close()
 (OUT/'results.json').write_text(json.dumps(results,indent=2));print('Owner billing browser journeys passed:',len(results))
if __name__=='__main__':asyncio.run(main())
