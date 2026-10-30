"""Existing Sponsored UI and activity discovery; isolated APIs, no real charge."""
import asyncio,json
from pathlib import Path
from playwright.async_api import async_playwright,expect
from experience_commerce import Scenario,A,P,BASE,DETAILS
OUT=Path('test-results/experience-sponsored');OUT.mkdir(parents=True,exist_ok=True)
async def main():
 results=[]
 async with async_playwright() as pw:
  browser=await pw.chromium.launch(args=['--no-sandbox'])
  for theme,width in [('light',390),('dark',1280)]:
   for mode in ('sponsored','promoted'):
    ctx=await browser.new_context(viewport={'width':width,'height':1000},service_workers='block');page=await ctx.new_page();s=Scenario(mode);errors=[];failed=True;changed=False
    page.on('pageerror',lambda error:errors.append(str(error)))
    # Localhost-only synthetic session. API routes remain intercepted below.
    await page.add_init_script('''(()=>{const now=Math.floor(Date.now()/1000),enc=o=>btoa(JSON.stringify(o)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');const id='b8220000-1111-4111-8111-000000000001';const jwt=enc({alg:'HS256',typ:'JWT'})+'.'+enc({sub:id,role:'authenticated',aud:'authenticated',iat:now,exp:now+3600})+'.c3ludGhldGlj';localStorage.setItem('sb-127-auth-token',JSON.stringify({access_token:jwt,refresh_token:'synthetic-refresh',expires_at:now+3600,expires_in:3600,token_type:'bearer',user:{id,aud:'authenticated',role:'authenticated',email:'promotion@example.invalid'}}));})()''')
    await page.add_init_script("document.addEventListener('DOMContentLoaded',()=>{document.documentElement.dataset.whTheme="+json.dumps(theme)+";document.documentElement.classList.toggle('dark',"+json.dumps(theme=='dark')+");});")
    async def route(handler):
     nonlocal failed,changed
     request=handler.request;name=request.url.split('?')[0].split('/')[-1]
     if '127.0.0.1:54321' in request.url and name in ('get_my_sponsored_resources','get_my_sponsored_campaigns','get_my_sponsored_offer','quote_my_sponsored_campaign','prepare_my_sponsored_campaign','sponsored-payment-init','get_sponsored_discovery','record_my_sponsored_impression','record_my_sponsored_open'):
      args=request.post_data_json if request.post_data else {};s.calls.append({'name':name,'args':args});status=200;data=[]
      if name=='get_my_sponsored_resources':
       if failed:status=503;data={'message':'Temporary promotion read failure'}
       else:data=[{'resource_type':'experience','resource_id':A,'label':DETAILS['title']}]
      elif name=='get_my_sponsored_offer':data={'available':True,'daily_price_ngn':100,'durations':[7,14],'slot_count':2,'market':'Lafia, Nasarawa'}
      elif name in ('quote_my_sponsored_campaign','prepare_my_sponsored_campaign'):data={'campaign_id':P,'resource_type':'experience','resource_id':A,'duration_days':args['p_duration_days'],'amount_ngn':(200 if changed else 100)*args['p_duration_days']}
      elif name=='sponsored-payment-init':data={'authorization_url':BASE+'/tests/browser/experience-commerce.html?mode=sponsored&payment=synthetic'}
      elif name=='get_sponsored_discovery':data=[{'campaign_id':P,'resource_id':A},{'campaign_id':A,'resource_id':'not-an-ordinary-result'}]
      elif name=='record_my_sponsored_impression':data=P
      return await handler.fulfill(status=status,content_type='application/json',body=json.dumps(data),headers={'access-control-allow-origin':'*'})
     await s.route(handler)
    await page.route('**/*',route);await page.goto(BASE+'/tests/browser/experience-commerce.html?mode='+mode)
    if mode=='sponsored':
     await expect(page.get_by_role('alert')).to_contain_text('could not be loaded');failed=False
     await page.get_by_role('button',name='Retry Sponsored options',exact=True).click()
     await expect(page.get_by_role('button',name='Promote',exact=True)).to_contain_text('Activity · '+DETAILS['title'])
     await expect(page.get_by_role('button',name='Continue to Paystack · ₦700.00',exact=True)).to_be_disabled()
     await page.get_by_role('button',name='Duration',exact=True).click()
     await page.get_by_role('dialog',name='Duration',exact=True).get_by_role('button',name='14 days',exact=True).click()
     await page.get_by_role('checkbox').check();changed=True
     await page.get_by_role('button',name='Continue to Paystack · ₦1,400.00',exact=True).click()
     await expect(page.get_by_text('The offer changed.',exact=False)).to_be_visible()
     assert not any(c['name'] in ('prepare_my_sponsored_campaign','sponsored-payment-init') for c in s.calls),'changed quote reached checkout'
     changed=False
     await expect(page.get_by_role('checkbox')).not_to_be_checked();await page.get_by_role('checkbox').check()
     await page.get_by_role('button',name='Continue to Paystack · ₦700.00',exact=True).dblclick()
     await page.wait_for_url('**payment=synthetic')
     assert len([c for c in s.calls if c['name']=='prepare_my_sponsored_campaign'])==1
     assert len([c for c in s.calls if c['name']=='sponsored-payment-init'])==1
     init=next(c['args'] for c in s.calls if c['name']=='sponsored-payment-init')
     assert init=={'campaign_id':P,'expected_amount_ngn':700}
    else:
     ad=page.get_by_role('region',name='Sponsored activities',exact=True)
     await expect(ad.get_by_role('button',name='View activity and dates',exact=False)).to_have_count(1)
     await expect(page.get_by_role('button',name='View activity and dates',exact=False)).to_have_count(2)
     await ad.scroll_into_view_if_needed();await page.wait_for_timeout(1200)
     await ad.get_by_role('button',name='View activity and dates',exact=False).click()
     await expect(page.get_by_role('heading',name='Choose a date',exact=True)).to_be_visible()
     assert any(c['name']=='record_my_sponsored_impression' and c['args'].get('p_context')=='experience_discovery' for c in s.calls)
     assert any(c['name']=='record_my_sponsored_open' and c['args'].get('p_campaign_id')==P for c in s.calls)
     assert not any(c['name'].startswith(('hold_','create_experience_checkout')) for c in s.calls),'ad click reserved or paid for activity'
    assert not errors,errors
    assert not await page.evaluate('document.documentElement.scrollWidth>innerWidth')
    await page.screenshot(path=str(OUT/f'{mode}-{theme}.png'),full_page=True)
    results.append(mode+' '+theme);await ctx.close()
  await browser.close()
 (OUT/'results.json').write_text(json.dumps(results,indent=2));print('Experience Sponsored browser journeys passed:',len(results))
if __name__=='__main__':asyncio.run(main())
