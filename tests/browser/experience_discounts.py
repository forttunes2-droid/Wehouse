"""Host/Creator controls and immutable discounted customer quotes; local fixtures."""
import asyncio,json
from pathlib import Path
from playwright.async_api import async_playwright,expect
from experience_commerce import Scenario,A,S,P,BASE
OUT=Path('test-results/experience-discounts');OUT.mkdir(parents=True,exist_ok=True)
async def main():
 results=[]
 async with async_playwright() as pw:
  browser=await pw.chromium.launch(args=['--no-sandbox'])
  for theme,width in [('light',390),('dark',1280)]:
   for mode in ('discount-host','discount-creator','discount-customer'):
    ctx=await browser.new_context(viewport={'width':width,'height':1000},service_workers='block');page=await ctx.new_page();s=Scenario(mode);errors=[];saved={'revision':0,'percent':0,'ends_on':None};lost=True
    page.on('pageerror',lambda error:errors.append(str(error)))
    await page.add_init_script("document.addEventListener('DOMContentLoaded',()=>{document.documentElement.dataset.whTheme="+json.dumps(theme)+";document.documentElement.classList.toggle('dark',"+json.dumps(theme=='dark')+");});")
    async def route(handler):
     nonlocal lost,saved
     request=handler.request;name=request.url.split('?')[0].split('/')[-1]
     if '127.0.0.1:54321' in request.url and name in ('platform_countries','get_my_experience_sessions','creator_experience_discount_targets','get_my_experience_session_discount','set_my_experience_session_discount','creator_get_experience_discount','creator_set_experience_discount'):
      args=request.post_data_json if request.post_data else {};s.calls.append({'name':name,'args':args});status=200
      if name=='platform_countries':data={'currency_code':'NGN'}
      elif name=='get_my_experience_sessions':data=[{'id':S,'activity_id':A,'revision':1,'activity_revision':2,'starts_at':s.q['starts_at'],'ends_at':s.q['ends_at'],'timezone':'Africa/Lagos','capacity':8,'price_minor':250000,'currency':'NGN','status':'draft'}]
      elif name=='creator_experience_discount_targets':data={'activities':[{'id':A,'title':'Campus guided walk','state':'Nasarawa'}],'states':['Nasarawa']}
      else:
       if name.startswith(('set_','creator_set_')):
        saved.update(revision=saved['revision']+1,percent=args['p_percent'],ends_on=args['p_ends_on'])
        if mode=='discount-host' and lost:lost=False;status=503
       data={**saved,'session_id':S,'base_price_minor':250000,'currency':'NGN'} if mode=='discount-host' else {**saved,'version':saved['revision'],'kind':args['p_kind'],'target':args['p_target'],'commission_percent':2}
       if mode=='discount-host':
        base=round(250000*(1-saved['percent']/100));fund=round(base*0.05);fee=round(base*0.1)
        data['pricing']={'original_price_per_participant_minor':250000,'total_minor':base-fund,'host_discount_minor':250000-base,'wehouse_discount_minor':fund,'commission_base_minor':base,'commission_gross_minor':fee,'commission_minor':fee-fund,'host_receives_minor':base-fee}
       if status==503:data={'message':'Synthetic lost discount response'}
      return await handler.fulfill(status=status,content_type='application/json',body=json.dumps(data),headers={'access-control-allow-origin':'*'})
     await s.route(handler)
    await page.route('**/*',route);await page.goto(BASE+'/tests/browser/experience-commerce.html?mode='+mode)
    if mode=='discount-customer':
     await page.get_by_role('button',name='View activity and dates',exact=False).click()
     await expect(page.locator('del').first).to_have_text('₦2,500.00')
     await page.get_by_role('button',name='per participant',exact=False).click();await page.get_by_label('Participants',exact=True).fill('2');await page.get_by_role('button',name='Book an activity',exact=True).click()
     breakdown=page.get_by_label('Activity price breakdown',exact=True)
     await expect(breakdown).to_contain_text('₦5,000.00');await expect(breakdown).to_contain_text('−₦500.00');await expect(breakdown).to_contain_text('−₦225.00');await expect(breakdown).to_contain_text('₦4,275.00')
     await page.get_by_role('button',name='Agree and continue to payment',exact=True).click();await expect(page.get_by_role('button',name='Pay ₦4,275.00',exact=True)).to_be_visible();await expect(page.get_by_label('Activity price breakdown',exact=True)).to_contain_text('−₦225.00')
    else:
     if mode=='discount-host':
      await page.get_by_role('button',name='Manage session discount',exact=True).click()
      preview=page.get_by_label('Current host price preview',exact=True)
      await expect(preview).to_contain_text('WeHouse-funded discount');await expect(preview).to_contain_text('₦125.00');await expect(preview).to_contain_text('₦2,250.00')
     else:
      await page.get_by_role('button',name='Activity Choose an offer scope',exact=True).click();await page.get_by_role('option',name='Campus guided walk',exact=False).click()
     await page.get_by_label('Discount (%)',exact=True).fill('1' if mode=='discount-creator' else '10')
     if mode=='discount-creator':
      await page.get_by_label('Reason for offer',exact=True).fill('Fund the activity offer from the agreed platform commission.')
      await expect(page.get_by_role('combobox',name='Offer covers',exact=True)).to_be_disabled()
      await page.get_by_role('button',name='Confirm funded discount',exact=True).click();await page.get_by_label('Creator security password',exact=False).fill('synthetic-test-password');await page.get_by_role('button',name='Confirm and continue',exact=True).click()
      await expect(page.get_by_text('Discount saved for new bookings.',exact=True)).to_be_visible()
      call=next(c['args'] for c in s.calls if c['name']=='creator_set_experience_discount');assert call['p_creator_elevation_id']==P and call['p_expected_version']==0 and call['p_kind']=='activity' and call['p_target']==A and call['p_percent']==1
     else:
      await expect(page.get_by_role('button',name='Close session discount',exact=True)).to_be_disabled()
      await page.get_by_role('button',name='Save discount',exact=True).click();await expect(page.get_by_role('alert')).to_contain_text('Synthetic lost discount response')
      await page.get_by_role('button',name='Refresh discount',exact=True).click();await expect(page.get_by_text('Saved offer: 10%',exact=False)).to_be_visible()
      assert len([c for c in s.calls if c['name']=='set_my_experience_session_discount'])==1
      await page.get_by_label('Discount (%)',exact=True).fill('0');await page.get_by_role('button',name='Save discount',exact=True).click();await expect(page.get_by_text('Discount removed for new bookings.',exact=True)).to_be_visible()
      assert [c['args']['p_expected_revision'] for c in s.calls if c['name']=='set_my_experience_session_discount']==[0,1]
    assert not errors,errors;assert not await page.evaluate('document.documentElement.scrollWidth>innerWidth')
    await page.screenshot(path=str(OUT/f'{mode}-{theme}.png'),full_page=True);results.append(mode+' '+theme);await ctx.close()
  await browser.close()
 (OUT/'results.json').write_text(json.dumps(results,indent=2));print('Experience discount browser journeys passed:',len(results))
if __name__=='__main__':asyncio.run(main())
