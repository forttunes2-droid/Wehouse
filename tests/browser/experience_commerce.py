"""Real Experience UI with isolated API/provider responses; no hosted charge."""
import asyncio,copy,json,uuid
from datetime import datetime,timedelta,timezone
from pathlib import Path
from playwright.async_api import async_playwright,expect
BASE='http://127.0.0.1:4173'
OUT=Path('test-results/experience-commerce');OUT.mkdir(parents=True,exist_ok=True)
A='91000000-0000-4000-8000-000000000001';S='91000000-0000-4000-8000-000000000002';B='91000000-0000-4000-8000-000000000003';P='91000000-0000-4000-8000-000000000004';P2='91000000-0000-4000-8000-000000000005'
DETAILS={'title':'Campus guided walk','category':'culture_tours','what_to_expect':'Walk through local landmarks and learn the stories, practical routes and meeting places with an experienced local guide.','host_expertise':'I lead local orientation walks and know the planned route and its landmarks.','country_code':'NG','state':'Nasarawa','local_area':'Lafia','city':'Lafia','meeting_area':'Public library entrance','timezone':'Africa/Lagos','participation_requirements':'Comfortable shoes. Adults able to walk the route.','accessibility_information':'Step-free route. Ask about assistance before joining.','duration_minutes':60,'max_group_size':8,'inclusions':['Guided route'],'exclusions':['Transport']}
def iso(dt):return dt.isoformat().replace('+00:00','Z')
def contract(quantity=2,past=False):
 start=datetime.now(timezone.utc).replace(microsecond=0)+(timedelta(days=-3) if past else timedelta(days=7));total=250000*quantity
 return {'activity_id':A,'activity_revision':3,'session_id':S,'session_revision':1,'host_user_id':'host','title':DETAILS['title'],'activity_details':DETAILS,'starts_at':iso(start),'ends_at':iso(start+timedelta(hours=1)),'timezone':'Africa/Lagos','participants':quantity,'price_per_participant_minor':250000,'total_minor':total,'currency':'NGN','commission_policy_version_id':P,'commission_percent':10,'commission_minor':total//10,'host_receives_minor':total-total//10,'cancellation_policy':'experience_standard_24h_v1','cancellation_deadline':iso(start-timedelta(hours=24)),'customer_cancellation_before_deadline':'full_refund','customer_late_cancellation':'review_required','host_cancellation':'full_refund'}
class Scenario:
 def __init__(self,mode):
  self.mode=mode;self.calls=[];self.fail=False;self.decided=False;self.lose_decision=False;self.published=False;self.q=contract(past=mode in ('customer-complete','host-ready','customer-late'))
  paid=mode in ('customer-paid','customer-complete','customer-late','host-ready','host-list','bookings','finance')
  self.booking={'id':B,'activity_id':A,'session_id':S,'customer_user_id':'customer','host_user_id':'host','participants':2,'status':'confirmed' if paid else 'pending_payment','expires_at':iso(datetime.now(timezone.utc)+timedelta(minutes=15)),'created_at':iso(datetime.now(timezone.utc)),'contract':self.q,'payment_id':P if paid else None,'payment_protection_id':P if paid else None,'customer_name':'Sample customer','host_name':'Sample local guide','money':{'reference':'WHEX_'+B.replace('-',''),'payment_status':'paid' if paid else None,'protection_state':'protected' if paid else None,'total':5000 if paid else None,'released':0,'refunded':0,'currency':'NGN'}}
  if mode=='customer-complete':self.booking.update(attendance_confirmed_at=self.q['starts_at'],host_finished_at=self.q['ends_at'])
 async def route(self,route):
  req=route.request
  if req.url.startswith(BASE):return await route.continue_()
  if not req.url.startswith('http://127.0.0.1:54321/'):return await route.abort()
  name=req.url.split('/')[-1].split('?')[0];args=req.post_data_json if req.post_data else {};self.calls.append({'name':name,'args':args});data=[];status=200
  if '/storage/v1/object/sign/' in req.url and req.method=='GET':return await route.fulfill(status=200,content_type='image/jpeg',body=Path('public/hero-city.jpg').read_bytes())
  if '/storage/v1/object/sign/' in req.url:
   data=[{'path':p,'signedURL':'/object/sign/experience-photos/'+p+'?token=synthetic'+str(len(self.calls))} for p in args.get('paths',[])]
  elif '/storage/v1/object/sign/' in req.url and req.method=='GET':return await route.fulfill(status=404)
  elif name=='get_experience_categories':data=[{'code':'culture_tours','name':'Culture and tours','description':'Guided local activities','examples':['Orientation walks']}]
  elif name=='search_experiences':
   if self.fail:status=503;data={'message':'Synthetic discovery failure'}
   else:
    d={k:v for k,v in DETAILS.items() if k!='host_expertise'}
    data={'items':[{'id':A,'revision':3,'details':d,'host_expertise':DETAILS['host_expertise'],'host_user_id':'host','category_name':'Culture and tours','cursor_at':'2026-10-26T10:00:00Z','photos':[{'id':photo,'object_path':A+'/'+photo+'.jpg','caption':'Synthetic activity photo'} for photo in (P,P2)],'next_session':{'id':S,'starts_at':self.q['starts_at'],'ends_at':self.q['ends_at'],'timezone':'Africa/Lagos','price_minor':250000,'currency':'NGN','remaining':8}}],'has_more':False}
  elif name=='get_published_experience':data={'id':A,'revision':3,'details':{k:v for k,v in DETAILS.items() if k!='host_expertise'},'host_expertise':DETAILS['host_expertise'],'host_user_id':'host','category_name':'Culture and tours','photos':[{'id':photo,'object_path':A+'/'+photo+'.jpg','caption':'Synthetic activity photo'} for photo in (P,P2)],'next_session':None}
  elif name=='get_published_experience_sessions':data=[{'id':S,'activity_id':A,'revision':1,'starts_at':self.q['starts_at'],'ends_at':self.q['ends_at'],'timezone':'Africa/Lagos','capacity':8,'remaining':8,'price_minor':250000,'currency':'NGN'}]
  elif name=='get_experience_booking_quote':self.q=contract(args['p_participants']);data={'contract':self.q,'contract_hash':'a'*64,'remaining':8}
  elif name=='hold_experience_booking':self.booking.update(id=args['p_booking_id'],participants=args['p_participants'],contract=self.q);data=self.booking
  elif name=='get_my_experience_booking':data=self.booking
  elif name=='get_my_experience_bookings':data=[self.booking] if self.mode in ('bookings','host-list') else []
  elif name=='cancel_experience_booking':
   self.booking.update(status='cancelled' if self.booking['status']=='pending_payment' else 'review_pending' if self.mode=='customer-late' else 'refund_pending');data=self.booking
  elif name=='request_experience_booking_review':self.booking['status']='review_pending';data=self.booking
  elif name=='progress_experience_booking':
   if args['p_action']=='host_finished':self.booking['host_finished_at']=iso(datetime.now(timezone.utc))
   elif args['p_action']=='complete':self.booking.update(status='completed',customer_completed_at=iso(datetime.now(timezone.utc)))
   else:self.booking['attendance_confirmed_at']=iso(datetime.now(timezone.utc))
   data=self.booking
  elif name=='get_my_experience_publication' or name=='set_my_experience_publication':
   if name.startswith('set_'):self.published=args['p_published']
   data={'activity_id':A,'activity_revision':3,'revision':1 if self.published else 0,'published':self.published,'visible':self.published,'can_publish':True,'checks':{k:True for k in ['approved','account','details','provider_access','identity','evidence','photos','sessions','commission']}}
  elif name=='creator-step-up':data={'success':True,'creator_elevation_id':P,'expires_in_seconds':600}
  elif name=='get_experience_finance_reviews':data=[{'id':B,'contract':self.q,'status':'refund_pending' if self.decided else 'review_pending','refund_decision':{'percent':100} if self.decided else None,'review_kind':'late_cancellation','review_case_id':P,'case_number':42,'updated_at':'2026-10-26T10:00:00Z','customer_reason':'Customer requests a review of the late cancellation.','resolution_summary':'Reviewed the accepted terms and evidence.' if self.decided else None,'amount_total':5000,'refunded_amount':0,'released_amount':0}]
  elif name=='decide_experience_booking_review':
   self.decided=True;data={'id':B,'refund_decision':{'percent':args['p_refund_percent'],'reason':args['p_reason']}}
   if self.lose_decision:status=503;data={'message':'Synthetic lost decision response'}
  elif name=='get_my_payment_receipts':data=[]
  await route.fulfill(status=status,content_type='application/json',body=json.dumps(data),headers={'access-control-allow-origin':'*'})
async def page_for(browser,mode,theme='light',width=390):
 s=Scenario(mode);ctx=await browser.new_context(viewport={'width':width,'height':844},service_workers='block');p=await ctx.new_page();errors=[];p.on('pageerror',lambda e:errors.append(str(e)))
 await p.add_init_script("document.addEventListener('DOMContentLoaded',()=>{document.documentElement.dataset.whTheme="+json.dumps(theme)+";document.documentElement.classList.toggle('dark',"+json.dumps(theme=='dark')+");});")
 await p.route('**/*',s.route);await p.goto(BASE+'/tests/browser/experience-commerce.html?mode='+mode)
 return s,ctx,p,errors
async def main():
 results=[]
 async with async_playwright() as pw:
  browser=await pw.chromium.launch(headless=True,args=['--no-sandbox'])
  for theme in ('light','dark'):
   for width in (320,390,768,1440):
    s,ctx,p,errors=await page_for(browser,'discovery',theme,width)
    await p.get_by_role('button',name='View activity and dates',exact=False).click();await p.get_by_role('heading',name='Choose a date',exact=True).wait_for()
    await p.get_by_role('button',name='per participant',exact=False).click();await p.get_by_label('Participants',exact=True).fill('2');await p.get_by_role('button',name='Review booking',exact=True).click();await expect(p.get_by_role('heading',name='Review your booking',exact=True)).to_be_visible()
    await p.locator('section[aria-label$=" media"] img').first.wait_for()
    await p.wait_for_function("Array.from(document.querySelectorAll('section[aria-label$=\" media\"] img')).some(i=>i.complete&&i.naturalWidth>0)")
    await p.screenshot(path=str(OUT/f'quote-{width}-{theme}.png'),full_page=True)
    await p.get_by_role('button',name='Agree and continue to payment',exact=True).click();await expect(p.get_by_role('heading',name=DETAILS['title'],exact=True)).to_be_visible();await expect(p.get_by_role('button',name='Pay ₦5,000.00',exact=True)).to_be_visible()
    assert not await p.evaluate('document.documentElement.scrollWidth>innerWidth'),(width,theme)
    assert not errors,errors;results.append(f'discovery to accepted hold {width} {theme}');await ctx.close()
   for mode in ('customer-paid','customer-late','customer-complete','host-ready','publication','host-list','bookings'):
    s,ctx,p,errors=await page_for(browser,mode,theme)
    if mode in ('customer-paid','customer-late'):
     await p.get_by_role('button',name='Cancel booking',exact=True).click();await p.get_by_label('Reason',exact=True).fill('Plans changed and I need to cancel this activity.');await p.get_by_role('button',name='Confirm cancellation' if mode=='customer-paid' else 'Request cancellation review',exact=True).click();await expect(p.get_by_text('Experience · '+('Refund pending' if mode=='customer-paid' else 'WeHouse review'),exact=True)).to_be_visible()
    elif mode=='customer-complete':await p.get_by_role('button',name='Confirm completion and release payment',exact=True).click();await expect(p.get_by_text('Experience · Completed',exact=True)).to_be_visible()
    elif mode=='host-ready':await p.get_by_role('button',name='Mark session finished',exact=True).click();await expect(p.get_by_role('button',name='Mark session finished',exact=True)).to_have_count(0)
    elif mode=='publication':await p.get_by_role('button',name='Publish activity and dates',exact=True).click();await expect(p.get_by_text('Published · Customers can view dates',exact=True)).to_be_visible()
    elif mode=='host-list':await p.get_by_role('button',name=DETAILS['title'],exact=False).click();await expect(p.get_by_text('Your accepted net earnings',exact=True)).to_be_visible()
    else:await p.get_by_role('button',name='Experiences',exact=True).click();await p.get_by_role('button',name='Open Experience booking for '+DETAILS['title'],exact=True).click();await expect(p.get_by_role('heading',name=DETAILS['title'],exact=True)).to_be_visible()
    await p.screenshot(path=str(OUT/f'{mode}-{theme}.png'),full_page=True);assert not errors,errors;results.append(mode+' '+theme);await ctx.close()
  s,ctx,p,errors=await page_for(browser,'discovery')
  await p.get_by_role('button',name='View activity and dates',exact=False).click()
  gallery=p.get_by_role('region',name=DETAILS['title']+' media',exact=True)
  await gallery.get_by_role('button',name='Go to image 2',exact=True).click()
  await expect(gallery.get_by_text('2 / 2',exact=True)).to_be_visible()
  await gallery.get_by_role('button',name='View image 2 of 2 full screen',exact=True).click()
  await expect(p.get_by_role('dialog')).to_be_visible()
  await p.get_by_role('button',name='Back from media viewer',exact=True).click()
  await expect(gallery.get_by_text('2 / 2',exact=True)).to_be_visible()
  count=sum(1 for c in s.calls if c['args'].get('paths'))
  await p.evaluate('Date.now=(()=>{const original=Date.now;return()=>original()+100000;})();window.dispatchEvent(new Event("focus"));')
  for _ in range(30):
   if sum(1 for c in s.calls if c['args'].get('paths'))>count:break
   await asyncio.sleep(.1)
  assert sum(1 for c in s.calls if c['args'].get('paths'))>count,'visible-page media renewal missing'
  await expect(gallery.get_by_text('2 / 2',exact=True)).to_be_visible()
  assert not errors,errors;results.append('Photo renewal and full-screen Back retain gallery position');await ctx.close()
  s,ctx,p,errors=await page_for(browser,'finance');s.lose_decision=True
  await p.get_by_role('button',name='Confirm access and load reviews',exact=True).click();await p.get_by_label('Creator security password',exact=False).fill('synthetic-test-password');await p.get_by_role('button',name='Confirm and continue',exact=True).click();await p.get_by_label('Refund percentage',exact=True).fill('100');await p.get_by_label('Decision basis',exact=True).fill('Reviewed the accepted cancellation terms and customer evidence.');await p.get_by_role('button',name='Review and record financial decision',exact=True).click();await expect(p.get_by_role('alert')).to_contain_text('Synthetic lost decision response');await p.get_by_role('button',name='Refresh reviews',exact=True).click();await expect(p.get_by_text('A decision is recorded.',exact=False)).to_be_visible();assert len([c for c in s.calls if c['name']=='decide_experience_booking_review'])==1;assert not errors,errors;results.append('Finance lost-response read recovery');await ctx.close()
  await browser.close()
 (OUT/'results.json').write_text(json.dumps(results,indent=2));print('Experience commerce browser journeys passed:',len(results))
if __name__=='__main__':asyncio.run(main())
