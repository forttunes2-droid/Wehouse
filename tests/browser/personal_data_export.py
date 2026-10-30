"""Actual reviewer/customer components and browser downloads; synthetic APIs only."""
import asyncio,json,os
from pathlib import Path
from playwright.async_api import async_playwright,expect
from personal_data_review import Scenario,open_page,fits,CONVERSATION,CASE,REVISION
OUT=Path('test-results/personal-data-export')
class ExportScenario(Scenario):
 def __init__(self,reviewer=False):
  super().__init__();self.reviewer=reviewer;self.decision=None if reviewer else CASE;self.allowed=not reviewer;self.lose_decision=False;self.fail_page=False;self.forge_page=False
 def receipt(self):
  r=super().receipt();r.update(reason_code='personal_data_access',can_respond=self.reviewer)
  r['export']={'decision_id':self.decision,'approval_id':self.decision if self.allowed else None,'can_download':self.allowed and not self.reviewer,'sections':['account','services'],'prepared_sections':[],'scope_note':'Account records; original media and supplementary records remain under review.'};return r
 async def route(self,route):
  req=route.request;name=req.url.split('?')[0].split('/')[-1]
  if '127.0.0.1:54321' not in req.url or req.method=='OPTIONS' or name not in ['set_personal_data_export_access','get_my_personal_data_export_page']:return await super().route(route)
  args=req.post_data_json or {};self.calls.append((name,args));status=200
  if name=='set_personal_data_export_access':
   self.decision=args['p_request_id'];self.allowed=args['p_allowed'];data=self.receipt()
   if self.lose_decision:status=503;data={'message':'Synthetic approval receipt lost'}
  else:
   data={'conversation_id':'wrong' if self.forge_page else CONVERSATION,'approval_id':CASE,'section':args['p_section'],'cursor':args['p_cursor'],'next_cursor':'25' if args['p_section']=='services' and args['p_cursor'] is None else None,'records':[{'id':n,'description':'Synthetic private record'} for n in (range(25) if args['p_section']=='services' and args['p_cursor'] is None else [25])],'prepared_at':REVISION}
   if self.fail_page:status=503;data={'message':'Synthetic unavailable export'}
  await route.fulfill(status=status,content_type='application/json',body=json.dumps(data),headers={'access-control-allow-origin':'*'})
async def approve(p):
 await p.get_by_role('button',name='Approve account-record download',exact=True).click()
 await p.get_by_label('Creator security password',exact=False).fill('synthetic-test-password')
 await p.get_by_role('button',name='Confirm and continue',exact=True).click()
async def main():
 OUT.mkdir(parents=True,exist_ok=True);results=[]
 async with async_playwright() as pw:
  browser=await pw.chromium.launch(headless=True)
  for theme in ['light','dark']:
   for width in [320,768]:
    s=ExportScenario(True);s,ctx,p,errors=await open_page(browser,'review',theme,width,s)
    await expect(p.get_by_role('button',name='Approve account-record download',exact=True)).to_be_visible();await fits(p);await approve(p)
    await expect(p.get_by_role('button',name='Withdraw download access',exact=True)).to_be_visible();assert len([x for x in s.calls if x[0]=='set_personal_data_export_access'])==1
    assert not any(n=='get_my_personal_data_export_page' for n,a in s.calls);assert not errors,errors;results.append(f'Independent reviewer approval {width} {theme}');await ctx.close()
    s=ExportScenario();s,ctx,p,errors=await open_page(browser,'export',theme,width,s)
    await p.get_by_role('combobox',name='Records to download',exact=True).select_option('services')
    async with p.expect_download() as event:await p.get_by_role('button',name='Download records',exact=True).click()
    d=await event.value;target=OUT/f'services-{width}-{theme}.jsonl';await d.save_as(target);rows=[json.loads(x) for x in target.read_text(encoding='utf8').splitlines()]
    assert len([x for x in rows if 'record' in x])==26;assert rows[-1]['record_count']==26 and rows[-1]['next_cursor'] is None
    assert [a['p_cursor'] for n,a in s.calls if n=='get_my_personal_data_export_page']==[None,'25'];assert not any(n=='set_personal_data_export_access' for n,a in s.calls)
    await expect(p.get_by_role('status')).to_contain_text('26 records prepared');await fits(p);await p.screenshot(path=str(OUT/f'export-{width}-{theme}.png'));assert not errors,errors;results.append(f'Customer actual paged download {width} {theme}');await ctx.close()
  s=ExportScenario(True);s.lose_decision=True;s,ctx,p,errors=await open_page(browser,'review',s=s);await approve(p);await expect(p.get_by_role('alert')).to_contain_text('Synthetic approval receipt lost')
  await p.get_by_role('button',name='Refresh review',exact=True).click();await expect(p.get_by_role('button',name='Withdraw download access',exact=True)).to_be_visible();assert len([x for x in s.calls if x[0]=='set_personal_data_export_access'])==1;assert not errors,errors;results.append('Lost approval result recovered without a second write');await ctx.close()
  s=ExportScenario();s.fail_page=True;s,ctx,p,errors=await open_page(browser,'export',s=s);await p.get_by_role('button',name='Download records',exact=True).click();await expect(p.get_by_role('alert')).to_contain_text('Synthetic unavailable export');s.fail_page=False
  async with p.expect_download() as event:await p.get_by_role('button',name='Download records',exact=True).click()
  await (await event.value).save_as(OUT/'retried-account.jsonl');assert not errors,errors;results.append('Page failure remains retryable without false success');await ctx.close()
  s=ExportScenario();s.forge_page=True;s,ctx,p,errors=await open_page(browser,'export',s=s);await p.get_by_role('button',name='Download records',exact=True).click();await expect(p.get_by_role('alert')).to_contain_text('data page could not be confirmed');assert not errors,errors;results.append('Mismatched-account receipt rejected before download');await ctx.close()
  await browser.close()
 (OUT/'results.json').write_text(json.dumps(results,indent=2));print('Reviewed data-export browser journeys passed:',len(results))
if __name__=='__main__':asyncio.run(main())
