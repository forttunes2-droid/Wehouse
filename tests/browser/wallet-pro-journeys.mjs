import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';

const output = 'test-results/wallet-pro-journeys';
fs.mkdirSync(output, { recursive: true });
// Concurrent suites must not overwrite one another's JS or generated Tailwind CSS.
const assets = process.argv.includes('--build-only') ? output : fs.mkdtempSync(path.join(output, 'run-'));
const client = path.resolve('tests/browser/walletProClientFixture.ts');
const fixtureBuild=await build({ entryPoints: ['tests/browser/wallet-pro-journeys.tsx'], bundle: true, format: 'iife', jsx: 'automatic', metafile:true,loader:{'.png':'dataurl'},
  outfile: `${assets}/fixture.js`, plugins: [{ name: 'isolated-wallet-client', setup(api) {
    api.onResolve({ filter: /.*/ }, args => {
      if(args.importer.endsWith('PhoneNotificationSettings.tsx')&&args.path==='@/lib/nativePush')return{path:args.path,namespace:'phone-settings-adapter'};
      if(args.importer.endsWith('AccountCenter.tsx')&&['@/pages/PrivacySecuritySettings','@/components/AccountHelpCenter'].includes(args.path))return{path:args.path,namespace:'account-peripheral'};
      if (['@/lib/supabase', '@/lib/supabase/client', '@/hooks/useCreatorAuth', '@/hooks/useDiscoveryLocation'].includes(args.path)
        || args.path.startsWith('.') && path.resolve(args.resolveDir,args.path).replace(/\.ts$/, '') === path.resolve('src/lib/supabase/client')) return { path: client };
      if (args.path.startsWith('@/')) return api.resolve(path.resolve('src', args.path.slice(2)), { resolveDir: process.cwd(), kind: args.kind });
    });
    api.onLoad({filter:/.*/,namespace:'account-peripheral'},()=>({loader:'jsx',contents:'export default function Peripheral(){return null;}'}));
    api.onLoad({filter:/.*/,namespace:'phone-settings-adapter'},()=>({loader:'js',contents:`
      const mode=new URLSearchParams(location.search).get('mode')||'';let enabled=false;
      export const nativePushPlatform=()=>mode.startsWith('phone-')?'android':null;
      export const phonePushStatus=async()=>({available:mode.startsWith('phone-')&&mode!=='phone-unavailable',enabled,permission:mode==='phone-denied'?'denied':'granted'});
      export const setPhonePush=async(_user,value)=>{if(mode==='phone-missing')throw new Error('Notification settings could not be confirmed. Refresh before retrying.');if(mode==='phone-denied')throw new Error('Allow notifications in your phone settings, then try again.');enabled=value;};
    `}));
  } }], define: { 'import.meta.env.DEV': 'false', 'import.meta.env.PROD': 'false', 'import.meta.env.VITE_NATIVE_BILLING_ENABLED': '"false"' } });
assert.ok(!Object.keys(fixtureBuild.metafile.inputs).some(file=>file.replaceAll('\\','/').endsWith('src/lib/supabase/client.ts')),
  'Isolated browser journeys must never load the real Supabase client');
const css = await postcss([tailwindcss(), autoprefixer()]).process(fs.readFileSync('src/index.css', 'utf8')+'\n'+fs.readFileSync('src/pages/login.css','utf8'), { from: 'src/index.css' });
fs.writeFileSync(`${assets}/fixture.css`, css.css);
// Reuse the actual component bundle for the local, sample-data product preview.
if (process.argv.includes('--build-only')) process.exit(0);
const server = http.createServer((req, res) => {
  if(['/brand-mark-light.svg','/brand-mark-dark.svg','/brand/v4/micro-purple.svg','/brand/v4/micro-purple-white.svg','/brand/v4/wehouse-lockup-light.svg','/brand/v4/wehouse-lockup-dark.svg'].includes(req.url)){
    res.setHeader('Content-Type','image/svg+xml');res.end(fs.readFileSync('public'+req.url));return;
  }
  const file = req.url === '/fixture.js' ? 'fixture.js' : req.url === '/fixture.css' ? 'fixture.css' : null;
  res.setHeader('Content-Type', file?.endsWith('.js') ? 'application/javascript' : file ? 'text/css' : 'text/html');
  res.end(file ? fs.readFileSync(`${assets}/${file}`) : '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
const results = [];
async function dismissToast(page,{clocked=false}={}){
  for(let count=0;count<10;count++){
    // Sonner keeps covered toasts mounted. Only the front toast is actionable;
    // selecting an older close button races its expiry beneath the new toast.
    const close=page.locator('[data-sonner-toast][data-front="true"]:not([data-removed="true"])').getByRole('button',{name:'Close toast',exact:true});
    if(!await close.count())return;
    try {await close.first().click({timeout:1000});}
    catch {
      // A new toast can replace the front item during its entrance. Leaving
      // the stack resumes Sonner's expiry timer; never force a covered click.
      const size=page.viewportSize()||{width:800,height:600};await page.mouse.move(size.width-2,size.height-2);
      if(clocked)await page.clock.runFor(4000);
      await page.locator('[data-sonner-toast]:not([data-removed="true"]):not([data-visible="false"])').first().waitFor({state:'hidden',timeout:10000});
    }
  }
  throw new Error('Toast queue did not dismiss');
}
try {
  browser = await chromium.launch({ headless: true });
  if(process.argv.includes('--viewing-journeys-only')){
    for(const theme of ['light','dark'])for(const state of ['reserved','scheduled','completed','cancelled','unprotected']){
      const page=await browser.newPage({viewport:{width:390,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/?mode=viewing-journey-'+state);await page.evaluate(theme=>{document.documentElement.dataset.whTheme=theme;document.documentElement.classList.toggle('dark',theme==='dark');},theme);
      await page.getByText('Reservation fee',{exact:true}).last().waitFor();
      assert.equal(await page.getByRole('button',{name:'Request a viewing',exact:true}).count(),state==='reserved'?1:0);
      assert.equal(await page.getByRole('button',{name:'Review rental agreement and payment',exact:true}).count(),['reserved','completed'].includes(state)?1:0);
      if(state==='scheduled')await page.getByText('Viewing scheduled: 1 Nov 2026',{exact:true}).waitFor();
      if(state==='unprotected')await page.getByRole('heading',{name:'Payment needs WeHouse review'}).waitFor();
      if(state==='reserved'){await page.getByRole('button',{name:'Request a viewing',exact:true}).click();assert.equal(await page.evaluate(()=>window.__viewingAction),'viewing');}
      if(state==='completed'){await page.getByRole('button',{name:'Review rental agreement and payment',exact:true}).click();assert.equal(await page.evaluate(()=>window.__viewingAction),'booking');}
      assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:output+'/viewing-'+state+'-'+theme+'.png',fullPage:true});results.push(state+' '+theme);await page.close();
    }
  }else if(process.argv.includes('--share-journeys-only')){
    for(const theme of ['light','dark'])for(const kind of ['home','hotel','service'])for(const audience of ['roommate','friend']){
      const page=await browser.newPage({viewport:{width:390,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/?mode=share-journey-'+kind);
      await page.evaluate(theme=>{document.documentElement.dataset.whTheme=theme;document.documentElement.classList.toggle('dark',theme==='dark');},theme);
      await page.getByRole('button',{name:'Roommates',exact:true}).click();
      if(audience==='friend')await page.getByRole('button',{name:'Friends',exact:true}).click();
      assert.equal(await page.getByRole('button',{name:'Blocked Friend',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'Pending Friend',exact:true}).count(),0);
      await page.getByRole('button',{name:audience==='friend'?/Accepted Friend/:/Accepted Roommate/}).click();await page.getByText('Ready in selected chat').waitFor({timeout:10000}).catch(async error=>{console.error({kind,audience,theme,errors,result:await page.evaluate(()=>window.__shareResult),body:(await page.locator('body').innerText()).slice(0,1600)});throw error;});
      const result=await page.evaluate(()=>window.__shareResult);assert.equal(result.audience,audience);assert.equal(result.id,audience+'-chat');assert.equal(result.queued.id,kind==='hotel'?'42':kind==='home'?'shared-home':'10100000-0000-4000-8000-000000000055');
      if(kind!=='service'){await page.getByRole('button',{name:kind==='hotel'?'View Shared hotel':'View Shared home',exact:true}).click();assert.deepEqual(await page.evaluate(()=>window.__shareOpened),{page:kind==='hotel'?'hotel_detail':'detail',id:kind==='hotel'?'42':'shared-home'});}
      assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);results.push(kind+' '+audience+' '+theme);await page.close();
    }
  }else if(process.argv.includes('--service-activity-only')){
    for(const theme of ['light','dark'])for(const mode of ['service-activity-success','service-activity-missing','service-activity-error']){
      const page=await browser.newPage({viewport:{width:390,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/?mode='+mode);
      await page.evaluate(theme=>{document.documentElement.dataset.whTheme=theme;document.documentElement.classList.toggle('dark',theme==='dark');},theme);
      if(!mode.endsWith('success')){await page.getByRole('alert').waitFor();assert.equal(await page.getByText('Linked plumbing visit',{exact:true}).count(),0);await page.evaluate(()=>window.__walletPro.recover=true);await page.getByRole('button',{name:'Refresh',exact:true}).click();}
      await page.getByText('Linked plumbing visit',{exact:true}).waitFor();assert.equal(await page.getByText('Unrelated booking',{exact:true}).count(),0);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
      await page.screenshot({path:output+'/'+mode+'-'+theme+'.png',fullPage:true});results.push(mode+' '+theme);await page.close();
    }
  }else if(process.argv.includes('--property-reviews-only')){
    for(const theme of ['light','dark'])for(const mode of ['property-review-tenant','property-review-short','property-review-ineligible','property-review-read-error','property-review-wrong-receipt']){
      const page=await browser.newPage({viewport:{width:390,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/?mode='+mode);await page.evaluate(theme=>{document.documentElement.dataset.whTheme=theme;document.documentElement.classList.toggle('dark',theme==='dark');},theme);
      if(mode.endsWith('read-error')){await page.getByRole('alert').waitFor();await page.evaluate(()=>window.__walletPro.recover=true);await page.getByRole('button',{name:'Refresh review'}).click();}
      if(mode.endsWith('ineligible')){await page.getByText(/You do not need to wait until your tenancy ends/).waitFor();assert.equal(await page.getByRole('button',{name:'Submit review'}).count(),0);}
      else{await page.getByLabel('Your review (optional)',{exact:true}).fill('The home matched the description.');await page.getByLabel('Your rating',{exact:true}).selectOption('4');await page.getByRole('button',{name:'Submit review'}).click();if(mode.endsWith('wrong-receipt')){await page.getByRole('alert').waitFor();assert.equal(await page.getByText(/Your review is saved/).count(),0);await page.evaluate(()=>window.__walletPro.recover=true);await page.getByRole('button',{name:'Submit review'}).click();}await page.getByText(/Your review is saved/).waitFor();}
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);await page.screenshot({path:output+'/'+mode+'-'+theme+'.png',fullPage:true});results.push(mode+' '+theme);await page.close();
    }
  }else if(process.argv.includes('--experience-sessions-only')){
    for(const theme of ['light','dark'])for(const mode of ['experience-sessions-success','experience-sessions-read-error','experience-sessions-wrong-receipt','experience-sessions-archive-error']){
      const page=await browser.newPage({viewport:{width:390,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/?mode='+mode);await page.evaluate(theme=>{document.documentElement.dataset.whTheme=theme;document.documentElement.classList.toggle('dark',theme==='dark');},theme);
      if(mode.endsWith('read-error')){await page.getByRole('alert').waitFor();await page.evaluate(()=>window.__walletPro.recover=true);await page.getByRole('button',{name:'Refresh sessions'}).click();}
      await page.getByLabel('Start date and time').fill('2040-01-01T11:00');await page.getByLabel('Session capacity').fill('8');await page.getByLabel('Price per participant (NGN)',{exact:true}).fill('2500.25');await page.getByRole('button',{name:'Save prepared session'}).click();
      if(mode.endsWith('wrong-receipt')){await page.getByRole('alert').waitFor();assert.equal(await page.getByRole('button',{name:'Edit session'}).count(),0);await page.evaluate(()=>window.__walletPro.recover=true);await page.getByRole('button',{name:'Save prepared session'}).click();}
      await page.getByRole('button',{name:'Edit session'}).waitFor();assert.equal(await page.evaluate(()=>window.__walletPro.rpcCalls.filter(c=>c.name==='save_my_experience_session').at(-1).args.p_price_minor),250025);
      await page.getByRole('button',{name:'Edit session'}).click();await page.getByLabel('Session capacity').fill('7');await page.getByRole('button',{name:'Save session changes'}).click();await page.getByText(/Capacity 7/).waitFor();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:output+'/'+mode+'-'+theme+'.png',fullPage:true});
      await page.getByRole('button',{name:'Archive prepared session'}).click();if(mode.endsWith('archive-error')){await page.getByRole('alert').waitFor();await page.evaluate(()=>window.__walletPro.recover=true);await page.getByRole('button',{name:'Archive prepared session'}).click();}await page.getByText('No prepared sessions yet.',{exact:true}).waitFor();assert.deepEqual(errors,[]);results.push(mode+' '+theme);await page.close();
    }
    for(const theme of ['light','dark']){
      const page=await browser.newPage({viewport:{width:390,height:900}});await page.goto(base+'/?mode=experience-applications-sessions');await page.evaluate(theme=>{document.documentElement.dataset.whTheme=theme;document.documentElement.classList.toggle('dark',theme==='dark');},theme);
      await page.getByRole('button',{name:/Campus orientation walk/}).click();await page.getByLabel('Start date and time').fill('2040-02-01T11:00');await page.getByLabel('Session capacity').fill('5');await page.getByLabel('Price per participant (NGN)',{exact:true}).fill('3000');
      assert.equal(await page.getByRole('button',{name:'Submit for review',exact:true}).isDisabled(),true);assert.equal(await page.getByRole('button',{name:'Save draft',exact:true}).isDisabled(),true);assert.equal(await page.getByRole('button',{name:'Archive activity',exact:true}).isDisabled(),true);
      await page.getByRole('button',{name:'Back to activities',exact:true}).click();
      await page.getByRole('dialog',{name:'Discard unsaved changes?'}).waitFor();
      await page.getByRole('button',{name:'Keep editing',exact:true}).click();
      assert.equal(await page.getByLabel('Session capacity').inputValue(),'5');
      await page.getByRole('button',{name:'Save prepared session'}).click();
      await page.getByRole('button',{name:'Edit session'}).waitFor();
      // The saved row renders before the parent clears its dirty/busy guard.
      // Wait for real button actionability; do not click or bypass the guard.
      await page.getByRole('button',{name:'Submit for review',exact:true}).click({trial:true});
      assert.equal(await page.getByRole('button',{name:'Submit for review',exact:true}).isEnabled(),true);
      await page.getByRole('button',{name:'Back to activities'}).click();await page.getByRole('button',{name:/Campus orientation walk/}).click();await page.getByText(/Capacity 5/).waitFor();results.push('session application continuity '+theme);await page.close();
    }
  }else if(process.argv.includes('--site-offers-only')){
    for(const theme of ['light','dark'])for(const mode of ['site-offers-success','site-offers-error','site-offers-malformed','site-offers-empty','site-offers-ungrouped','site-offers-paging']){
      const page=await browser.newPage({viewport:{width:320,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/?mode='+mode);await page.evaluate(theme=>{document.documentElement.dataset.whTheme=theme;document.documentElement.classList.toggle('dark',theme==='dark');},theme);
      if(mode==='site-offers-error'||mode==='site-offers-malformed'){await page.getByRole('alert').waitFor();await page.evaluate(()=>window.__walletPro.recover=true);await page.getByRole('button',{name:'Retry other homes'}).click();}
      if(mode==='site-offers-empty')await page.getByText('No other published offers match this selection.',{exact:true}).waitFor();
      else if(mode==='site-offers-ungrouped'){await page.waitForFunction(()=>window.__walletPro.rpcCalls.some(c=>c.name==='get_property_site_offers'));await page.waitForFunction(()=>!document.querySelector('[aria-label="Other homes at this property"]'));}
      else {
       await page.getByRole('button',{name:/Flat A/}).waitFor();
       if(mode==='site-offers-paging'){await page.getByRole('button',{name:'More homes at this property',exact:true}).click();await page.getByRole('button',{name:/Flat B/}).waitFor();}
       await page.getByRole('button',{name:/Flat A/}).click();assert.equal(await page.evaluate(()=>window.__siteOpened),'site-flat-a');
       assert.equal(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('wh_browse_v1:listing:site-flat-a')).choices.checkIn),'2040-04-01');
       await page.getByLabel('Rental type',{exact:true}).selectOption('long_stay');await page.getByRole('button',{name:/Flat A.*Long Let/}).waitFor();
      }
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);results.push(mode+' '+theme);await page.screenshot({path:output+'/'+mode+'-'+theme+'.png',fullPage:true});await page.close();
    }
  }else if(process.argv.includes('--hosting-controls-only')){
    for(const theme of ['light','dark'])for(const mode of ['hosting-controls-success','hosting-controls-usd','hosting-controls-read-error','hosting-controls-write-error','hosting-controls-wrong-receipt']){
      const page=await browser.newPage({viewport:{width:320,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.goto(base+'/?mode='+mode);await page.evaluate(theme=>{document.documentElement.dataset.whTheme=theme;document.documentElement.classList.toggle('dark',theme==='dark');},theme);
      if(mode.endsWith('read-error')){await page.getByRole('alert').waitFor();await page.evaluate(()=>window.__walletPro.recover=true);await page.getByRole('button',{name:'Retry hosting controls'}).click();}
      await page.getByText(mode==='hosting-controls-usd'?/Booking currency: USD/:/Booking currency: NGN/).waitFor();
      await page.getByRole('heading',{name:'Discount (optional)',exact:true}).waitFor();
      await page.getByRole('button',{name:'Pause bookings',exact:true}).click();
      if(mode.endsWith('write-error')||mode.endsWith('wrong-receipt')){
        await page.getByRole('alert').waitFor();assert.equal(await page.getByRole('button',{name:'Open bookings',exact:true}).count(),0);
        await page.evaluate(()=>window.__walletPro.recover=true);await page.getByRole('button',{name:'Refresh controls',exact:true}).click();
      }else await page.getByRole('button',{name:'Open bookings',exact:true}).waitFor();
      await page.getByRole('textbox',{name:'Nightly price',exact:true}).waitFor();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
      await page.screenshot({path:output+'/'+mode+'-'+theme+'.png',fullPage:true});results.push(mode+' '+theme);await page.close();
    }
    for(const theme of ['light','dark'])for(const mode of ['building-schedule-records','building-schedule-empty','building-schedule-error','building-schedule-paging']){
      const page=await browser.newPage({viewport:{width:320,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.goto(base+'/?mode='+mode);await page.evaluate(theme=>{document.documentElement.dataset.whTheme=theme;document.documentElement.classList.toggle('dark',theme==='dark');},theme);
      await page.getByRole('button',{name:'View building schedule',exact:true}).click();
      if(mode.endsWith('error')){await page.getByRole('alert').waitFor();await page.evaluate(()=>window.__walletPro.recover=true);await page.getByRole('button',{name:'Retry schedule'}).click();}
      if(mode.endsWith('empty'))await page.getByText('No published listings are available in this schedule.').waitFor();
      else await page.getByRole('heading',{name:'Flat A',exact:true}).waitFor();
      if(mode.endsWith('paging')){await page.getByRole('button',{name:'Load more homes',exact:true}).click();await page.getByRole('heading',{name:'Flat B',exact:true}).waitFor();await page.getByText(/Dates not recorded/).waitFor();}
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);await page.screenshot({path:output+'/'+mode+'-'+theme+'.png',fullPage:true});results.push(mode+' '+theme);await page.close();
    }
    for(const theme of ['light','dark'])for(const mode of ['hotel-discount-success','hotel-discount-read-error','hotel-discount-write-error']){
      const page=await browser.newPage({viewport:{width:320,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/?mode='+mode);await page.evaluate(theme=>{document.documentElement.dataset.whTheme=theme;document.documentElement.classList.toggle('dark',theme==='dark');},theme);
      if(mode.endsWith('read-error')){await page.getByRole('alert').waitFor();assert.equal(await page.getByText('No active discounts.',{exact:true}).count(),0);await page.evaluate(()=>window.__walletPro.recover=true);await page.getByRole('button',{name:'Refresh discounts',exact:true}).click();}
      await page.getByText('No active discounts.',{exact:true}).waitFor();await page.getByRole('spinbutton').fill('15');await page.getByRole('button',{name:'Save discount',exact:true}).click();
      if(mode.endsWith('write-error')){await page.getByRole('alert').waitFor();await page.evaluate(()=>window.__walletPro.recover=true);await page.getByRole('button',{name:'Refresh discounts',exact:true}).click();await page.getByText('No active discounts.',{exact:true}).waitFor();await page.getByRole('button',{name:'Save discount',exact:true}).click();}
      await page.getByRole('button',{name:'Remove',exact:true}).click();await page.getByText('No active discounts.',{exact:true}).waitFor();assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);results.push(mode+' '+theme);await page.close();
    }
  }else if(process.argv.includes('--space-review-only')){
    for(const theme of ['light','dark'])for(const width of [320,1440])for(const mode of ['space-review-field','space-review-operations-short','space-review-operations-long']){
      const page=await browser.newPage({viewport:{width,height:1000}});const errors=[];page.on('pageerror',error=>errors.push(error.message));
      await page.goto(base+'/?mode='+mode);await page.evaluate(theme=>{document.documentElement.dataset.whTheme=theme;document.documentElement.classList.toggle('dark',theme==='dark');},theme);
      if(mode.endsWith('field'))await page.getByRole('button').filter({hasText:'12 Test Road'}).click();
      const scope=page.getByRole('region',{name:'Bookable space',exact:true});await scope.waitFor();await scope.getByText('Shared areas: Kitchen, Entrance',{exact:true}).waitFor();await scope.getByText(/Private room.*Home B/).waitFor();
      if(mode.includes('operations')){await page.getByText(mode.endsWith('short')?'Nightly price':'Annual rent',{exact:true}).waitFor();assert.equal(await page.getByText(mode.endsWith('short')?'Annual rent':'Nightly price',{exact:true}).count(),0);}
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false);assert.deepEqual(errors,[]);await page.screenshot({path:output+'/'+mode+'-'+theme+'-'+width+'.png',fullPage:true});results.push(mode+' '+theme+' '+width+'px');await page.close();
    }
  }else if(process.argv.includes('--partner-history-only')){
    for(const theme of ['light','dark'])for(const width of [320,1440])for(const mode of ['partner-stays-history','partner-stays-history-error','partner-stays-history-linked']){
      const page=await browser.newPage({viewport:{width,height:1000}});const errors=[];page.on('pageerror',error=>errors.push(error.message));
      await page.goto(base+'/?mode='+mode);await page.evaluate(theme=>{document.documentElement.dataset.whTheme=theme;document.documentElement.classList.toggle('dark',theme==='dark');},theme);
      await page.getByText(mode.endsWith('linked')?'51 loaded':'50 loaded',{exact:true}).waitFor();
      if(mode.endsWith('linked')){await page.locator('#partner-stay-old-stay').waitFor();assert.equal(await page.evaluate(()=>window.__walletPro.rpcCalls.some(call=>call.args.p_reservation_id==='old-stay')),true);}
      await page.getByRole('button',{name:'Load older reservations',exact:true}).click();
      if(mode.endsWith('error')){
        await page.getByRole('alert').filter({hasText:'Older reservations could not be loaded'}).waitFor();await page.getByText('50 loaded',{exact:true}).waitFor();
        await page.evaluate(()=>{window.__walletPro.recover=true;});await page.getByRole('button',{name:'Retry older reservations',exact:true}).click();
      }
      const count=page.getByText('52 loaded',{exact:true});await count.waitFor();await count.scrollIntoViewIfNeeded();
      assert.equal(await page.getByRole('button',{name:'Load older reservations',exact:true}).count(),0);assert.equal(await page.locator('#partner-stay-old-stay').count(),1);
      assert.equal(await page.evaluate(()=>window.__walletPro.rpcCalls.filter(call=>call.args.p_before_id).every(call=>call.args.p_before_id==='stay-2'&&call.args.p_before_created_at==='2026-01-01T10:00:00.123456+00:00')),true);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false);assert.deepEqual(errors,[]);await page.screenshot({path:output+'/'+mode+'-'+theme+'-'+width+'.png'});
      results.push(mode+' '+theme+' '+width+'px');await page.close();
    }
  }else if(process.argv.includes('--hotel-cancellation-only')){
    for(const theme of ['light','dark'])for(const width of [320,768,1440])for(const mode of ['hotel-cancel-success','hotel-cancel-lost','hotel-cancel-review','hotel-cancel-read-error','hotel-cancel-malformed','hotel-cancel-write-error']){
      const page=await browser.newPage({viewport:{width,height:1000}});const errors=[];page.on('pageerror',error=>errors.push(error.message));
      await page.goto(base+'/?mode='+mode);await page.evaluate(theme=>{document.documentElement.dataset.whTheme=theme;document.documentElement.classList.toggle('dark',theme==='dark');},theme);
      await page.getByRole('button',{name:'Review cancellation',exact:true}).click();
      if(mode.endsWith('review')){
        await page.getByText('This booking requires WeHouse cancellation review',{exact:true}).waitFor();
        assert.equal(await page.getByRole('button',{name:'Cancel stay and request refund',exact:true}).count(),0);
        await page.getByRole('button',{name:'Contact WeHouse',exact:true}).click();assert.equal(await page.evaluate(()=>window.__hotelReview),true);
      }else{
        if(mode.endsWith('read-error')||mode.endsWith('malformed')){
          await page.getByRole('alert').waitFor();assert.equal(await page.getByRole('button',{name:'Cancel stay and request refund',exact:true}).count(),0);
          await page.evaluate(()=>{window.__walletPro.recover=true;});await page.getByRole('button',{name:'Refresh cancellation status',exact:true}).click();
        }
        const confirm=page.getByRole('button',{name:'Cancel stay and request refund',exact:true});await confirm.waitFor();
        await page.getByText('Refund to original payment method',{exact:true}).waitFor();await page.getByText(/Africa\/Lagos/).waitFor();
        assert.equal(await page.evaluate(()=>window.__walletPro.rpcCalls.filter(call=>call.name==='cancel_my_hotel_booking').length),0);
        await confirm.click();
        if(mode.endsWith('write-error')){
          await page.getByRole('alert').filter({hasText:'Cancellation was not confirmed'}).waitFor();assert.equal(await page.getByText('This booking is cancelled',{exact:true}).count(),0);
          await page.evaluate(()=>{window.__walletPro.recover=true;});await confirm.click();
        }
        await page.getByText('This booking is cancelled',{exact:true}).waitFor();await page.getByText('The refund is requested; provider confirmation is pending.',{exact:true}).waitFor();
        assert.equal(await page.evaluate(()=>window.__hotelChanged),true);
        assert.equal(await page.evaluate(()=>window.__walletPro.rpcCalls.filter(call=>call.name==='cancel_my_hotel_booking').length),mode.endsWith('write-error')?2:1);
      }
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false);assert.deepEqual(errors,[]);
      await page.screenshot({path:output+'/'+mode+'-'+theme+'-'+width+'.png',fullPage:true});results.push(mode+' '+theme+' '+width+'px');await page.close();
    }
  }else if(process.argv.includes('--partner-assets-only')){
    for(const theme of ['light','dark'])for(const width of [320,768,1440]){
      const page=await browser.newPage({viewport:{width,height:1000}});const errors=[];page.on('pageerror',error=>errors.push(error.message));
      await page.goto(base+'/?mode=partner-assets-grouped',{waitUntil:'domcontentloaded'});await page.evaluate(theme=>{document.documentElement.dataset.whTheme=theme;document.documentElement.classList.toggle('dark',theme==='dark');},theme);
      const compound=page.getByRole('region',{name:'Lafia compound',exact:true});await compound.waitFor();
      assert.equal(await compound.locator(':scope > div.grid > button').count(),3);
      await compound.getByRole('button',{name:'View building schedule',exact:true}).waitFor();
      assert.equal(await compound.getByText('Long Let · per year',{exact:true}).count(),2);
      assert.equal(await compound.getByText('Short Let · per night',{exact:true}).count(),1);
      assert.equal(await compound.getByText('Separate home',{exact:true}).count(),0);
      await compound.getByText(/3 listings loaded/).waitFor();
      assert.equal(await page.getByText('Separate home',{exact:true}).count(),1);
      await page.screenshot({path:output+'/partner-grouped-'+theme+'-'+width+'.png',fullPage:true});
      await compound.getByRole('button').filter({hasText:'Home B'}).click();
      await page.getByRole('button',{name:'Back to properties',exact:true}).waitFor();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false);assert.deepEqual(errors,[]);
      results.push('Partner grouped homes '+theme+' '+width+'px');await page.close();
    }
    for(const theme of ['light','dark'])for(const width of [320,1440])for(const mode of ['partner-assets-error','partner-assets-malformed','partner-assets-bad-row','partner-stays-error','partner-stays-malformed']){
      const page=await browser.newPage({viewport:{width,height:1000}});const errors=[];page.on('pageerror',error=>errors.push(error.message));
      await page.goto(base+'/?mode='+mode);await page.evaluate(theme=>{document.documentElement.dataset.whTheme=theme;document.documentElement.classList.toggle('dark',theme==='dark');},theme);
      const assets=mode.startsWith('partner-assets');
      await page.getByRole('alert').filter({hasText:assets?'Your properties could not be loaded':'Reservations could not be loaded'}).waitFor();
      assert.equal(await page.getByText(assets?'Nothing published yet':'No reservations yet',{exact:true}).count(),0);
      await page.evaluate(()=>{window.__walletPro.recover=true;});await page.getByRole('button',{name:assets?'Retry properties':'Retry reservations',exact:true}).click();
      if(assets){await page.getByText(/Lafia compound.*Home A \/ Room 1/).waitFor();await page.getByText('Private room',{exact:true}).waitFor();}
      else await page.getByText('No reservations yet',{exact:true}).waitFor();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false);assert.deepEqual(errors,[]);
      await page.screenshot({path:output+'/'+mode+'-'+theme+'-'+width+'.png',fullPage:true});results.push(mode+' recovery '+theme+' '+width+'px');await page.close();
    }
    for(const theme of ['light','dark'])for(const width of [320,1440])for(const mode of ['partner-assets-price-unavailable','partner-assets-currency']){
      const page=await browser.newPage({viewport:{width,height:1000}});await page.goto(base+'/?mode='+mode);await page.evaluate(theme=>{document.documentElement.dataset.whTheme=theme;document.documentElement.classList.toggle('dark',theme==='dark');},theme);
      await page.getByText('Compound home',{exact:true}).waitFor();if(mode.endsWith('unavailable'))await page.getByText('Price unavailable',{exact:true}).waitFor();else assert.ok((await page.locator('main').innerText()).includes('$600,000'));
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false);results.push(mode+' '+theme+' '+width+'px');await page.close();
    }
  }else if(process.argv.includes('--property-spaces-only')){
    for(const theme of ['light','dark'])for(const width of [320,768,1440])for(const mode of ['property-spaces-new','property-spaces-saved']){
      const page=await browser.newPage({viewport:{width,height:1000}});const errors=[];page.on('pageerror',error=>errors.push(error.message));
      await page.goto(base+'/?mode='+mode);
      await page.evaluate(theme=>{document.documentElement.dataset.whTheme=theme;document.documentElement.classList.toggle('dark',theme==='dark');},theme);
      await page.getByRole('button',{name:'Add property',exact:true}).click();
      await page.getByRole('button',{name:'Compound or building',exact:false}).click();
      if(mode.endsWith('saved')){
        await page.getByRole('button',{name:'Choose compound or building',exact:true}).click();
        await page.getByRole('button',{name:'Saved compound',exact:true}).click();
        assert.equal(await page.getByLabel('Street address *',{exact:true}).inputValue(),'12 Test Road');
        await page.getByRole('button',{name:'Choose home or unit',exact:true}).click();
        await page.getByRole('button',{name:'Home A',exact:true}).click();
        assert.equal(await page.getByLabel('Unit label (for example Flat A or House 1) *',{exact:true}).isDisabled(),true);
        assert.equal(await page.getByLabel('Layout description (optional)',{exact:true}).inputValue(),'Bungalow');
        await page.getByRole('button',{name:'What will the customer rent?',exact:true}).click();await page.getByRole('button',{name:/^Private bedroom/}).click();
        await page.getByRole('button',{name:'Choose private room',exact:true}).click();await page.getByRole('button',{name:'Room 1',exact:true}).click();
        assert.equal(await page.getByLabel('Room label *',{exact:true}).isDisabled(),true);
        assert.equal(await page.getByLabel('Shared areas (separate with commas) *',{exact:true}).inputValue(),'Kitchen, Entrance');
      }else{
        await page.getByLabel('Compound or building name *',{exact:true}).fill('Lafia compound');
        await page.getByLabel('Unit label (for example Flat A or House 1) *',{exact:true}).fill('Home A');
        await page.getByLabel('Layout description (optional)',{exact:true}).fill('Self-contained');
        await page.getByLabel('Bedrooms (0 for a studio)',{exact:true}).fill('0');
        await page.getByRole('button',{name:'Add another unit',exact:true}).click();
        assert.equal(await page.getByLabel('Compound or building name *',{exact:true}).inputValue(),'Lafia compound');
        assert.equal(await page.getByLabel('Unit label (for example Flat A or House 1) *',{exact:true}).inputValue(),'');
        assert.equal(await page.getByLabel('Bedrooms (0 for a studio)',{exact:true}).inputValue(),'0');
        await page.getByLabel('Unit label (for example Flat A or House 1) *',{exact:true}).fill('Home B');
        await page.getByRole('button',{name:'What will the customer rent?',exact:true}).click();
        await page.getByRole('button',{name:/^Private bedroom/}).click();
        await page.getByLabel('Room label *',{exact:true}).fill('Room 1');
        await page.getByLabel('Shared areas (separate with commas) *',{exact:true}).fill('Kitchen, Entrance');
        await page.getByRole('button',{name:'Add another bedroom',exact:true}).click();
        assert.equal(await page.getByLabel('Room label *',{exact:true}).inputValue(),'');
        assert.equal(await page.getByLabel('Unit label (for example Flat A or House 1) *',{exact:true}).inputValue(),'Home B');
        assert.equal(await page.getByLabel('Shared areas (separate with commas) *',{exact:true}).inputValue(),'Kitchen, Entrance');
      }
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false);
      assert.deepEqual(errors,[]);await page.screenshot({path:output+'/'+mode+'-'+theme+'-'+width+'.png',fullPage:true});
      results.push(mode+' '+theme+' '+width+'px');await page.close();
    }
    const page=await browser.newPage();await page.goto(base+'/?mode=property-spaces-recovery');
    await page.getByRole('button',{name:'Add property',exact:true}).click();await page.getByRole('button',{name:'Compound or building',exact:false}).click();
    await page.getByRole('button',{name:'Retry saved properties',exact:true}).waitFor();await page.evaluate(()=>{window.__walletPro.recover=true;});
    await page.getByRole('button',{name:'Retry saved properties',exact:true}).click();await page.getByRole('button',{name:'Choose compound or building',exact:true}).waitFor();
    results.push('Saved compounds recover after a failed read');await page.close();
  }else if(process.argv.includes('--private-calls-only')){
    for(const theme of ['light','dark'])for(const width of [320,768,1440])for(const mode of ['private-call-incoming','private-call-media']){
      const page=await browser.newPage({viewport:{width,height:1000}});const errors=[];page.on('pageerror',error=>errors.push(error.message));
      await page.addInitScript(()=>Object.defineProperty(navigator,'mediaDevices',{value:{getUserMedia:async()=>{throw new DOMException('Permission denied','NotAllowedError');}}}));
      await page.goto(`${base}/?mode=${mode}`);
      await page.evaluate(theme=>{document.documentElement.dataset.whTheme=theme;document.documentElement.classList.toggle('dark',theme==='dark');},theme);
      const button=page.getByRole('button',{name:mode.endsWith('incoming')?'Decline':'End call',exact:true});await button.waitFor();
      if(mode.endsWith('media')){await page.getByText('Allow microphone access to make this call.',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:/Speaker|Earpiece/}).count(),0);}
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false);
      await page.screenshot({path:`${output}/${mode}-${theme}-${width}.png`,fullPage:true});
      await button.click();await button.waitFor({state:'hidden'});
      assert.deepEqual(errors,[]);results.push(`${mode} ${theme} ${width}px`);await page.close();
    }
  }else if(process.argv.includes('--wallet-snapshots-only')){
    for(const theme of ['light','dark'])for(const width of [320,1440])for(const kind of ['worker','partner']){
      const page=await browser.newPage({viewport:{width,height:1000}});const errors=[];page.on('pageerror',error=>errors.push(error.message));
      await page.goto(`${base}/?mode=${kind}-wallet-malformed`);
      await page.evaluate(theme=>{document.documentElement.dataset.whTheme=theme;document.documentElement.classList.toggle('dark',theme==='dark');},theme);
      await page.getByRole('alert').filter({hasText:'Your wallet could not be loaded'}).waitFor();
      assert.equal(await page.getByText('Available balance',{exact:true}).count(),0);
      await page.evaluate(()=>{window.__walletPro.recover=true;});
      await page.getByRole('button',{name:'Try again',exact:true}).click();
      await page.getByText('Available balance',{exact:true}).waitFor();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false);
      assert.deepEqual(errors,[]);await page.screenshot({path:`${output}/wallet-snapshot-${kind}-${theme}-${width}.png`,fullPage:true});
      results.push(`${kind} malformed wallet snapshot recovery ${theme} ${width}px`);await page.close();
    }
  }else if(process.argv.includes('--finance-summary-only')){
    for(const theme of ['light','dark'])for(const width of [320,768,1440]){
      const page=await browser.newPage({viewport:{width,height:1000}});const errors=[];page.on('pageerror',error=>errors.push(error.message));
      await page.goto(`${base}/?mode=finance-summary`);
      await page.evaluate(theme=>{document.documentElement.dataset.whTheme=theme;document.documentElement.classList.toggle('dark',theme==='dark');},theme);
      const card=page.getByRole('button',{name:/Payouts & refunds/});await card.waitFor();
      assert.match(await card.innerText(),/^2\n/);
      await page.getByText('Counts cover loaded records',{exact:false}).waitFor();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false);
      await card.click();assert.equal(await page.evaluate(()=>window.__financeOpened),'payouts');
      assert.deepEqual(errors,[]);await page.screenshot({path:`${output}/finance-summary-${theme}-${width}.png`,fullPage:true});
      results.push(`Finance summary recovery count and navigation ${theme} ${width}px`);await page.close();
    }
    for(const mode of ['finance-summary-error','finance-summary-malformed']){
      const page=await browser.newPage();await page.goto(`${base}/?mode=${mode}`);
      await page.getByRole('alert').filter({hasText:'Finance summary unavailable'}).waitFor();
      assert.equal(await page.getByRole('button',{name:/Payouts & refunds/}).count(),0);
      await page.evaluate(()=>{window.__walletPro.recover=true;});
      await page.getByRole('button',{name:'Retry Finance summary',exact:true}).click();
      await page.getByRole('button',{name:/Payouts & refunds/}).waitFor();
      results.push(mode+' does not fabricate zero and recovers');await page.close();
    }
  }else if(process.argv.includes('--finance-recovery-only')) {
    for(const theme of ['light','dark'])for(const width of [320,768,1440]){
      const page=await browser.newPage({viewport:{width,height:1000}});const errors=[];
      page.on('pageerror',error=>errors.push(error.message));
      await page.goto(`${base}/?mode=finance-recovery`);
      await page.evaluate(theme=>{document.documentElement.dataset.whTheme=theme;document.documentElement.classList.toggle('dark',theme==='dark');},theme);
      await page.getByText('Action reference: recovery-action-reference',{exact:true}).waitFor();
      await page.getByText('Provider refund: 42',{exact:true}).waitFor();
      await page.getByText('Reconcile the original provider outcome before retrying.',{exact:false}).waitFor();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false);
      await page.getByRole('button',{name:'Refresh finance records',exact:true}).click();
      await page.getByText('Action reference: recovery-action-reference',{exact:true}).waitFor();
      assert.deepEqual(errors,[]);
      await page.screenshot({path:`${output}/finance-recovery-${theme}-${width}.png`,fullPage:true});
      await page.getByRole('button',{name:'Check refund with Paystack',exact:true}).click();
      await page.getByText('Action reference: recovery-action-reference',{exact:true}).waitFor({state:'hidden'});
      assert.equal(await page.evaluate(()=>window.__walletPro.invokeCalls.length),1);
      results.push(`Finance recovery reference, warning, refresh and layout ${theme} ${width}px`);await page.close();
    }
    for(const mode of ['finance-recovery-unbound','finance-recovery-missing','finance-recovery-lost']){
      const page=await browser.newPage({viewport:{width:320,height:1000}});await page.goto(`${base}/?mode=${mode}`);
      await page.getByText('Action reference: recovery-action-reference',{exact:true}).waitFor();
      if(mode.endsWith('unbound')){
        assert.equal(await page.getByRole('button',{name:'Check refund with Paystack',exact:true}).isDisabled(),true);
        await page.getByLabel('Provider refund ID for recovery-action-reference',{exact:true}).fill('42');
      }
      await page.getByRole('button',{name:'Check refund with Paystack',exact:true}).click();
      if(mode.endsWith('missing')){
        await page.getByText('Refund verification could not be confirmed',{exact:true}).waitFor();
        await page.getByText('Action reference: recovery-action-reference',{exact:true}).waitFor();
        assert.equal(await page.getByRole('button',{name:'Check refund with Paystack',exact:true}).isEnabled(),true);
      }else await page.getByText('Action reference: recovery-action-reference',{exact:true}).waitFor({state:'hidden'});
      assert.equal(await page.evaluate(()=>window.__walletPro.invokeCalls.length),1);
      results.push(mode+' verifies or recovers through the current Finance record');await page.close();
    }
  } else if(process.argv.includes('--experience-applications-only')) {
    for(const theme of ['light','dark']){
      for(const scenario of ['ready','blocked','error','lost']){
        const mode=scenario==='error'||scenario==='lost'?`experience-applications-approval-${scenario}-review`:`experience-applications-approval-review-${scenario}`;
        const page=await browser.newPage({viewport:{width:390,height:900}});await page.goto(base+'/?mode='+mode);await page.evaluate(theme=>{document.documentElement.dataset.whTheme=theme;document.documentElement.classList.toggle('dark',theme==='dark');},theme);
        await page.getByRole('button',{name:'Open review queue',exact:true}).click();await page.getByRole('button',{name:/Campus orientation walk/}).click();
        await page.getByLabel('Feedback shared with the host',{exact:true}).fill('Activity evidence, photos and sessions independently reviewed.');
        const checks=page.getByRole('region',{name:'Activity approval'});const approve=checks.getByRole('button',{name:'Approve activity',exact:true});
        if(scenario==='blocked'){
          await checks.getByText('Needed',{exact:true}).first().waitFor();assert.equal(await approve.isDisabled(),true);
          results.push('Incomplete activity checks block approval '+theme);await page.close();continue;
        }
        await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Approve activity'&&!b.disabled));await approve.click();
        if(scenario==='error'||scenario==='lost'){
          await checks.getByRole('alert').waitFor();assert.equal(await page.getByLabel('Feedback shared with the host',{exact:true}).inputValue(),'Activity evidence, photos and sessions independently reviewed.');
          await page.evaluate(()=>window.__walletPro.recover=true);await approve.click();
        }
        await page.getByRole('status').filter({hasText:'Activity review approved. The host manages publication separately.'}).waitFor();
        assert.equal(await page.getByRole('button',{name:'Approve activity',exact:true}).count(),0);
        assert.equal(await page.getByRole('button',{name:'Revise document requirements',exact:true}).count(),0);
        assert.equal(await page.getByText(/Activity changed since this date was prepared/).count(),0);
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
        if(scenario==='ready')await checks.screenshot({path:`${output}/experience-approval-${theme}.png`});
        results.push(`Activity approval ${scenario} ${theme}`);await page.close();
      }
      const host=await browser.newPage({viewport:{width:390,height:900}});await host.goto(base+'/?mode=experience-applications-approval-host');await host.getByRole('button',{name:/Campus orientation walk/}).click();
      assert.equal(await host.getByLabel('Activity name',{exact:true}).isDisabled(),true);await host.getByRole('button',{name:'Revise approved activity',exact:true}).click();
      await host.waitForFunction(()=>!document.querySelector('input[maxlength="120"]')?.disabled);results.push('Host revises approved activity '+theme);await host.close();
    }
    for(const theme of ['light','dark']){
      const page=await browser.newPage({viewport:{width:390,height:900}});await page.goto(base+'/?mode=experience-applications-photo-lost');await page.evaluate(theme=>{document.documentElement.dataset.whTheme=theme;document.documentElement.classList.toggle('dark',theme==='dark');},theme);
      await page.getByRole('button',{name:/Campus orientation walk/}).click();
      await page.getByLabel('What does this photo show?',{exact:true}).fill('Guided orientation route');
      const bytes=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=800;canvas.height=600;const ctx=canvas.getContext('2d');ctx.fillStyle='#8173c9';ctx.fillRect(0,0,800,600);return Array.from(atob(canvas.toDataURL('image/png').split(',')[1]),c=>c.charCodeAt(0));});
      await page.getByLabel('Add activity photo',{exact:true}).setInputFiles({name:'route.png',mimeType:'image/png',buffer:Buffer.from(bytes)});
      await page.getByRole('alert').filter({hasText:'Photo result is unknown'}).waitFor();await page.getByRole('button',{name:'Refresh photos',exact:true}).click();
      const photos=page.getByRole('region',{name:'Activity photos'});await photos.getByText('Awaiting review',{exact:true}).waitFor();
      assert.equal(await page.evaluate(()=>window.__walletPro.rpcCalls.filter(c=>c.name==='begin_experience_activity_photo').length),1);
      await photos.getByRole('img',{name:'Guided orientation route',exact:true}).waitFor();
      assert.equal(await photos.getByRole('button',{name:'Approve photo',exact:true}).count(),0);
      await page.screenshot({path:`${output}/experience-photos-host-${theme}.png`,fullPage:true});
      await photos.getByRole('button',{name:'Archive photo',exact:true}).click();await photos.getByText('No activity photos yet.',{exact:true}).waitFor();
      results.push('Host photo upload, lost response recovery and archive '+theme);await page.close();
      const review=await browser.newPage({viewport:{width:390,height:900}});await review.goto(base+'/?mode=experience-applications-photo-review');await review.evaluate(theme=>{document.documentElement.dataset.whTheme=theme;document.documentElement.classList.toggle('dark',theme==='dark');},theme);
      await review.getByRole('button',{name:'Open review queue',exact:true}).click();await review.getByRole('button',{name:/Campus orientation walk/}).click();
      const reviewPhotos=review.getByRole('region',{name:'Activity photos'});await reviewPhotos.getByLabel('Photo review note: Guided orientation route',{exact:true}).fill('Photo checked against the described activity.');
      await review.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Approve photo'&&!b.disabled));
      await reviewPhotos.getByRole('button',{name:'Approve photo',exact:true}).click();await reviewPhotos.getByText('Photo approved',{exact:true}).waitFor();
      assert.equal(await reviewPhotos.getByLabel('Add activity photo',{exact:true}).count(),0);
      assert.equal(await review.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      results.push('Independent Creator photo review '+theme);await review.close();
    }
    for(const theme of ['light','dark']){
      const page=await browser.newPage({viewport:{width:390,height:900}});await page.goto(base+'/?mode=experience-applications-evidence-host');await page.evaluate(theme=>{document.documentElement.dataset.whTheme=theme;document.documentElement.classList.toggle('dark',theme==='dark');},theme);
      await page.getByRole('button',{name:/Campus orientation walk/}).click();
      await page.getByLabel('Upload Venue permission',{exact:true}).setInputFiles({name:'permission.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.7\n')});
      await page.getByText('Awaiting review',{exact:true}).waitFor();
      assert.equal(await page.evaluate(()=>window.__walletPro.rpcCalls.find(c=>c.name==='begin_experience_evidence_upload').args.p_activity_id),'10100000-0000-4000-8000-000000000091');
      assert.equal(await page.getByRole('button',{name:'Set accepted document requirements',exact:true}).count(),0);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      results.push('Activity-specific evidence upload '+theme);await page.close();
      const review=await browser.newPage({viewport:{width:390,height:900}});await review.goto(base+'/?mode=experience-applications-evidence-review');await review.evaluate(theme=>{document.documentElement.dataset.whTheme=theme;document.documentElement.classList.toggle('dark',theme==='dark');},theme);
      await review.getByRole('button',{name:'Open review queue',exact:true}).click();await review.getByRole('button',{name:/Campus orientation walk/}).click();
      await review.getByRole('button',{name:'Set accepted document requirements',exact:true}).click();
      await review.getByLabel(/I confirm that this offering/).check();await review.getByLabel('Applicable requirements and review basis',{exact:true}).fill('Reviewed this activity and location; no additional evidence documents apply to this fixture.');
      await review.getByRole('button',{name:'Save requirements',exact:true}).click();await review.getByText(/Current activity evidence is approved/).waitFor();
      assert.equal(await review.getByLabel('Upload Venue permission',{exact:true}).count(),0);
      results.push('Creator activity evidence requirements '+theme);await review.close();
    }
    for(const theme of ['light','dark'])for(const width of [320,768,1440]){
      const page=await browser.newPage({viewport:{width,height:1000}});const errors=[];page.on('pageerror',error=>errors.push(error.message));
      await page.goto(base+'/?mode=experience-applications-create');await page.evaluate(theme=>{document.documentElement.dataset.whTheme=theme;document.documentElement.classList.toggle('dark',theme==='dark');},theme);
      await page.getByRole('button',{name:'Create an Experience',exact:true}).click();
      await page.getByLabel('Category',{exact:true}).selectOption('culture_tours');
      await page.getByLabel('Activity name',{exact:true}).fill('Campus orientation walk');
      await page.getByLabel('What participants will do',{exact:true}).fill('Explore local landmarks with a guided route, useful orientation information and time to ask questions.');
      await page.getByLabel('Your expertise or venue responsibility',{exact:true}).fill('I have led local orientation walks and know the route and meeting arrangements.');
      await page.getByLabel('Duration in minutes',{exact:true}).fill('60');await page.getByLabel('Maximum participants',{exact:true}).fill('8');
      for(const [label,value]of [['State or region','Nasarawa'],['Local government or district','Lafia'],['City or town','Lafia'],['Meeting area','Public main gate'],['Age, ability, equipment and participation requirements','Comfortable shoes; adults only.'],['Accessibility and assistance available','Step-free route with assistance available.']])await page.getByLabel(label,{exact:true}).fill(value);
      await page.getByRole('button',{name:'Save draft',exact:true}).click();await page.getByText('Draft saved.',{exact:true}).waitFor();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      if(width===320)await page.screenshot({path:`${output}/experience-application-${theme}.png`,fullPage:true});
      await page.getByRole('button',{name:'Submit for review',exact:true}).click();await page.getByText('Your activity was submitted to WeHouse.',{exact:true}).waitFor();
      assert.equal(await page.getByLabel('Activity name',{exact:true}).isDisabled(),true);
      await page.getByRole('button',{name:'Withdraw submission',exact:true}).click();await page.getByText('Submission withdrawn. You can edit your draft.',{exact:true}).waitFor();
      assert.equal(await page.getByLabel('Activity name',{exact:true}).isEnabled(),true);
      assert.deepEqual(errors,[]);results.push(`Activity draft, submit, withdraw and responsive layout ${theme} ${width}px`);await page.close();
    }
    for(const mode of ['experience-applications-category-error','experience-applications-linked','experience-applications-missing-save']){
      const page=await browser.newPage({viewport:{width:390,height:900}});await page.goto(base+'/?mode='+mode);
      if(mode.endsWith('category-error')){
        await page.getByRole('button',{name:/Campus orientation walk/}).waitFor();await page.getByRole('button',{name:'Retry categories',exact:true}).waitFor();
        assert.equal(await page.getByRole('button',{name:'Create an Experience',exact:true}).isDisabled(),true);
        await page.evaluate(()=>{window.__walletPro.recover=true;});await page.getByRole('button',{name:'Retry categories',exact:true}).click();
        await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(button=>button.textContent==='Create an Experience')?.disabled);
      }else if(mode.endsWith('linked')){
        await page.getByRole('button',{name:'Retry application link',exact:true}).waitFor();await page.evaluate(()=>{window.__walletPro.recover=true;});await page.getByRole('button',{name:'Retry application link',exact:true}).click();
        await page.getByLabel('Activity name',{exact:true}).waitFor();assert.equal(await page.getByLabel('Activity name',{exact:true}).inputValue(),'Campus orientation walk');
      }else{
        await page.getByRole('button',{name:/Campus orientation walk/}).click();await page.getByLabel('Activity name',{exact:true}).fill('Updated campus orientation walk');await page.getByRole('button',{name:'Save draft',exact:true}).click();
        await page.getByRole('alert').filter({hasText:'Activity details could not be confirmed'}).waitFor();assert.equal(await page.getByLabel('Activity name',{exact:true}).inputValue(),'Updated campus orientation walk');
        await page.evaluate(()=>{window.__walletPro.recover=true;});await page.getByRole('button',{name:'Save draft',exact:true}).click();await page.getByText('Draft saved.',{exact:true}).waitFor();
      }
      results.push(mode+' recovers without discarding saved or entered activity');await page.close();
    }
    for(const theme of ['light','dark'])for(const decision of ['Request changes','Decline application']){
      const page=await browser.newPage({viewport:{width:320,height:1000}});await page.goto(base+'/?mode=experience-applications-review');await page.evaluate(theme=>{document.documentElement.dataset.whTheme=theme;document.documentElement.classList.toggle('dark',theme==='dark');},theme);
      await page.getByRole('button',{name:'Open review queue',exact:true}).click();await page.getByRole('button',{name:/Campus orientation walk/}).click();
      assert.equal(await page.evaluate(()=>getComputedStyle(document.body).margin),'0px','Application styles must load before visual checks');
      await page.getByText(/Capacity 8.*per participant/).waitFor();
      assert.equal(await page.getByRole('button',{name:'Archive prepared session',exact:true}).count(),0);
      assert.equal(await page.getByRole('button',{name:'Edit session',exact:true}).count(),0);
      assert.equal(await page.getByText(/Activity changed since this date was prepared/).count(),0);
      await page.getByLabel('Feedback shared with the host',{exact:true}).fill('Clarify the route, accessible assistance and meeting arrangements.');
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      if(decision==='Request changes')await page.screenshot({path:`${output}/experience-review-${theme}.png`,fullPage:true});
      await page.getByRole('button',{name:decision,exact:true}).click();
      if(decision==='Decline application')await page.getByRole('dialog').getByRole('button',{name:decision,exact:true}).click();
      await page.getByRole('status').filter({hasText:decision==='Request changes'?'Changes requested.':'Application declined.'}).waitFor();
      await page.getByRole('button',{name:'Review linked application',exact:true}).click();
      assert.equal(await page.getByRole('button',{name:'Request changes',exact:true}).isDisabled(),true);
      results.push(`Creator ${decision.toLowerCase()} and resolved-record review ${theme}`);await page.close();
    }
    {
      const page=await browser.newPage();await page.goto(base+'/?mode=experience-applications-review-error');await page.getByRole('button',{name:'Review linked application',exact:true}).click();
      await page.getByLabel('Feedback shared with the host',{exact:true}).fill('Clarify the route, accessible assistance and meeting arrangements.');await page.getByRole('button',{name:'Request changes',exact:true}).click();await page.getByRole('alert').filter({hasText:'Synthetic review failure'}).waitFor();
      assert.equal(await page.getByLabel('Feedback shared with the host',{exact:true}).inputValue(),'Clarify the route, accessible assistance and meeting arrangements.');await page.evaluate(()=>{window.__walletPro.recover=true;});await page.getByRole('button',{name:'Request changes',exact:true}).click();await page.getByRole('status').filter({hasText:'Changes requested.'}).waitFor();results.push('Creator decision failure preserves feedback and permits retry');await page.close();
    }
  } else if(process.argv.includes('--worker-profile-only')) {
    for(const theme of ['light','dark']){
      const page=await browser.newPage({viewport:{width:390,height:900}});await page.goto(base+'/?mode=worker-profile-live');await page.evaluate(theme=>{document.documentElement.dataset.whTheme=theme;document.documentElement.classList.toggle('dark',theme==='dark');},theme);await page.getByText('WeHouse Reviewed',{exact:true}).waitFor();await page.getByRole('button',{name:'Review and credentials',exact:true}).waitFor();results.push('Live Worker retains credential access '+theme);await page.close();
    }
    for(const theme of ['light','dark'])for(const mode of ['worker-availability-success','worker-availability-error','worker-availability-missing']){
      const page=await browser.newPage({viewport:{width:390,height:900}});await page.goto(base+'/?mode='+mode);await page.evaluate(theme=>{document.documentElement.dataset.whTheme=theme;document.documentElement.classList.toggle('dark',theme==='dark');},theme);
      const control=page.getByRole('switch',{name:'Accept new booking requests',exact:true});await control.click();
      if(mode!=='worker-availability-success'){await page.getByText(mode.endsWith('missing')?'Availability was not confirmed. Refresh your workspace before retrying.':'Synthetic availability failure',{exact:true}).waitFor();assert.equal(await control.getAttribute('aria-checked'),'false');await page.evaluate(()=>{window.__walletPro.recover=true;});await control.click();}
      await page.getByText('Availability saved: accepting new booking requests.',{exact:true}).waitFor();assert.equal(await control.getAttribute('aria-checked'),'true');assert.equal(await page.getByText('You are visible in Discovery',{exact:true}).count(),0);results.push(mode+' '+theme);await page.close();
    }
    for(const theme of ['light','dark'])for(const width of [320,768,1440]){
      const page=await browser.newPage({viewport:{width,height:1000}});const errors=[];page.on('pageerror',error=>errors.push(error.message));
      await page.goto(base+'/?mode=worker-profile-success');await page.evaluate(theme=>{document.documentElement.dataset.whTheme=theme;document.documentElement.classList.toggle('dark',theme==='dark');},theme);
      await page.getByText('Reviewed - not visible',{exact:true}).waitFor();await page.getByText('7',{exact:true}).waitFor();await page.getByText('Electrical repairs',{exact:true}).waitFor();
      assert.match(await page.getByText(/Professional electrician/).textContent(),/Services Offered:/);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
      if(width===320)await page.screenshot({path:output+'/worker-profile-'+theme+'.png',fullPage:true});results.push('Worker profile '+theme+' '+width);await page.close();
    }
    for(const theme of ['light','dark'])for(const mode of ['worker-profile-read-error','worker-profile-malformed']){
      const page=await browser.newPage({viewport:{width:390,height:1000}});await page.goto(base+'/?mode='+mode);await page.evaluate(theme=>{document.documentElement.dataset.whTheme=theme;document.documentElement.classList.toggle('dark',theme==='dark');},theme);
      await page.getByRole('alert').waitFor();await page.getByText('Unavailable',{exact:true}).waitFor();assert.equal(await page.getByText('0',{exact:true}).count(),0);await page.evaluate(()=>{window.__walletPro.recover=true;});await page.getByRole('button',{name:'Retry profile details',exact:true}).click();await page.getByText('7',{exact:true}).waitFor();results.push(mode+' '+theme);await page.close();
    }
  } else if(process.argv.includes('--credentials-only')) {
    const upload=async page=>{await page.getByLabel('Upload Trade licence',{exact:true}).setInputFiles({name:'licence.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.7\n')});};
    const review=async page=>{const dismiss=page.getByRole('button',{name:'Close toast',exact:true});if(await dismiss.count())await dismiss.first().click();await page.getByRole('button',{name:'Credential review',exact:true}).click();await page.getByLabel('Review reason or correction needed',{exact:true}).fill('Reviewed the accepted current trade qualification.');await page.getByLabel('Evidence expires at (required)',{exact:true}).fill('2027-12-31T23:59');};
    for(const theme of ['light','dark'])for(const width of [320,768,1440]){
      const page=await browser.newPage({viewport:{width,height:1000}});const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(base+'/?mode=credentials-success');await page.evaluate(theme=>{document.documentElement.dataset.whTheme=theme;document.documentElement.classList.toggle('dark',theme==='dark');},theme);
      await upload(page);await page.getByText('Awaiting review',{exact:true}).waitFor();await review(page);await page.getByRole('button',{name:'Approve evidence',exact:true}).click();await page.getByText('Approved',{exact:true}).waitFor();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);if(width===320)await page.screenshot({path:output+'/worker-credentials-'+theme+'.png',fullPage:true});
      await page.reload();await page.getByText('Approved',{exact:true}).waitFor();assert.deepEqual(errors,[]);results.push('Credential upload/review/reload '+theme+' '+width);await page.close();
    }
    for(const theme of ['light','dark'])for(const mode of ['credentials-unconfigured','credentials-read-error','credentials-submit-error','credentials-review-error','credentials-context-changed']){
      const page=await browser.newPage({viewport:{width:390,height:1000}});await page.goto(base+'/?mode='+mode);await page.evaluate(theme=>{document.documentElement.dataset.whTheme=theme;document.documentElement.classList.toggle('dark',theme==='dark');},theme);
      if(mode.endsWith('unconfigured')){await page.getByRole('button',{name:'Set accepted document requirements',exact:true}).click();await page.getByRole('checkbox',{name:/I confirm that this service/}).check();await page.getByLabel('Applicable requirements and review basis',{exact:true}).fill('This test service and operating area have no additional document requirement.');await page.getByRole('button',{name:'Save requirements',exact:true}).click();await page.getByText('Current credential requirements are approved. Professional profile, work evidence, identity policy and final publication review still apply.',{exact:true}).waitFor();}
      else if(mode.endsWith('read-error')){await page.getByText('Document status could not be loaded. Use Refresh status to try again.',{exact:true}).waitFor();await page.evaluate(()=>{window.__walletPro.recover=true;});await page.getByRole('button',{name:'Refresh status',exact:true}).click();await page.getByLabel('Upload Trade licence',{exact:true}).waitFor();}
      else if(mode.endsWith('submit-error')){await upload(page);await page.getByText('Synthetic credential reservation failure',{exact:true}).waitFor();await page.evaluate(()=>{window.__walletPro.recover=true;});await upload(page);await page.getByText('Awaiting review',{exact:true}).waitFor();}
      else if(mode.endsWith('review-error')){await upload(page);await page.getByText('Awaiting review',{exact:true}).waitFor();await review(page);await page.getByRole('button',{name:'Approve evidence',exact:true}).click();await page.getByText('Synthetic credential review failure',{exact:true}).waitFor();await page.evaluate(()=>{window.__walletPro.recover=true;});await page.getByRole('button',{name:'Approve evidence',exact:true}).click();await page.getByText('Approved',{exact:true}).waitFor();}
      else{await page.getByText('The service or operating area changed. WeHouse must confirm the requirements again before uploads or publication.',{exact:true}).waitFor();assert.equal(await page.getByLabel('Upload Trade licence',{exact:true}).count(),0);}
      results.push(mode+' '+theme);await page.close();
    }
  } else if(process.argv.includes('--bank-search-only')) {
    for(const theme of ['light','dark'])for(const width of [320,768,1440]){
      const page=await browser.newPage({viewport:{width,height:900}});const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(base+'/?mode=payout-bank-search');
      await page.evaluate(theme=>{document.documentElement.dataset.whTheme=theme;document.documentElement.classList.toggle('dark',theme==='dark');},theme);
      await page.getByRole('button',{name:'Add account',exact:true}).click();await page.getByRole('button').filter({hasText:'Choose bank'}).click();
      const input=page.getByPlaceholder('Search bank',{exact:true});await input.fill('Zeni');await page.getByRole('option',{name:'Zenith Test Bank',exact:true}).waitFor();assert.equal(await page.getByRole('option').count(),1);assert.equal(await input.inputValue(),'Zeni');
      await input.fill('  FIRST BANK  ');await page.getByRole('option',{name:'First Bank Test',exact:true}).waitFor();assert.equal(await page.getByRole('option').count(),1);
      await input.fill('bank   first');await page.getByRole('option',{name:'First Bank Test',exact:true}).waitFor();assert.equal(await page.getByRole('option').count(),1);
      await input.fill('not-a-bank');await page.getByText('No results',{exact:true}).waitFor();assert.equal(await page.getByRole('option').count(),0);
      await input.fill('057');await page.getByRole('option',{name:'Zenith Test Bank',exact:true}).waitFor();await input.press('ArrowDown');await page.keyboard.press('Enter');
      await page.getByRole('button').filter({hasText:'Zenith Test Bank'}).click();assert.equal(await input.inputValue(),'');assert.equal(await page.getByRole('option').count(),3);
      if(width===320)await page.screenshot({path:output+'/bank-search-'+theme+'.png'});
      await input.press('Escape');assert.equal(await page.getByRole('option').count(),0);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);results.push('Bank name/code/empty/reopen '+theme+' '+width);await page.close();
    }
    for(const theme of ['light','dark'])for(const mode of ['payout-banks-timeout','payout-banks-malformed']){
      const page=await browser.newPage();await page.clock.install();await page.goto(base+'/?mode='+mode);await page.evaluate(theme=>{document.documentElement.dataset.whTheme=theme;document.documentElement.classList.toggle('dark',theme==='dark');},theme);
      await page.getByRole('button',{name:'Add account',exact:true}).click();if(mode.endsWith('timeout'))await page.clock.fastForward(16000);
      await page.getByText('Bank list unavailable. Retry loading the banks.',{exact:true}).waitFor();await page.evaluate(()=>{window.__walletPro.recover=true;});await page.getByRole('button',{name:'Retry bank list',exact:true}).click();
      await page.getByRole('button').filter({hasText:'Choose bank'}).click();await page.getByRole('option',{name:'Current Test Bank',exact:true}).waitFor();results.push('Bank list retry '+theme+' '+mode);await page.close();
    }
  } else if(process.argv.includes('--phone-notifications-only')) {
    for(const theme of ['light','dark'])for(const width of [320,768,1440]) {
      const page=await browser.newPage({viewport:{width,height:900}});const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(base+'/?mode=phone-success');
      await page.evaluate(theme=>{localStorage.setItem('wehouse:appearance',theme);document.documentElement.dataset.whTheme=theme;document.documentElement.classList.toggle('dark',theme==='dark');window.dispatchEvent(new Event('wehouse:appearance-changed'));},theme);
      const toggle=page.getByRole('switch',{name:'Phone notifications',exact:true});await toggle.click();await page.getByText('Phone notifications enabled',{exact:true}).waitFor();assert.equal(await toggle.getAttribute('aria-checked'),'true');
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      const toastSurface=await page.locator('[data-sonner-toast]').first().evaluate(node=>({bg:getComputedStyle(node).backgroundColor,text:getComputedStyle(node).color}));assert.equal(toastSurface.bg,theme==='dark'?'rgb(23, 27, 36)':'rgb(239, 241, 247)');assert.equal(toastSurface.text,theme==='dark'?'rgb(244, 245, 248)':'rgb(32, 36, 51)');
      if(width===320){await page.waitForFunction(()=>{const node=document.querySelector('[data-sonner-toast]');return node?.dataset.mounted==='true'&&getComputedStyle(node).opacity==='1'&&node.getBoundingClientRect().top>=0;});await page.screenshot({path:output+'/phone-notifications-'+theme+'.png'});}
      await toggle.click();await page.getByText('Phone notifications turned off',{exact:true}).waitFor();assert.equal(await toggle.getAttribute('aria-checked'),'false');assert.deepEqual(errors,[]);results.push('Phone setting and themed popup '+theme+' '+width);await page.close();
    }
    for(const mode of ['phone-missing','phone-denied','phone-unavailable']) {
      const page=await browser.newPage();await page.goto(base+'/?mode='+mode);
      if(mode==='phone-unavailable'){await page.getByText('Not activated for this app yet. In-app alerts and Inbox still work.',{exact:true}).waitFor();assert.equal(await page.getByRole('switch',{name:'Phone notifications',exact:true}).count(),0);}
      else {const toggle=page.getByRole('switch',{name:'Phone notifications',exact:true});await toggle.click();await page.getByRole('alert').waitFor();assert.equal(await toggle.getAttribute('aria-checked'),'false');}
      results.push(mode);await page.close();
    }
    for(const theme of ['light','dark'])for(const width of [320,768,1440]){
      const page=await browser.newPage({viewport:{width,height:900}});await page.goto(base+'/?mode=phone-select');
      await page.evaluate(theme=>{localStorage.setItem('wehouse:appearance',theme);document.documentElement.dataset.whTheme=theme;document.documentElement.classList.toggle('dark',theme==='dark');window.dispatchEvent(new Event('wehouse:appearance-changed'));},theme);
      await page.getByLabel('Property type',{exact:true}).click();const dialog=page.getByRole('dialog',{name:'Property type',exact:true});await dialog.waitFor();
      const heading=await dialog.getByRole('heading',{name:'Property type'}).evaluate(node=>getComputedStyle(node).color);assert.equal(heading,theme==='light'?'rgb(32, 36, 51)':'rgb(244, 245, 248)');
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);if(width===320)await page.screenshot({path:output+'/select-options-'+theme+'.png'});
      await dialog.getByRole('button',{name:'Private room in a shared home with access to a shared kitchen',exact:true}).click();assert.equal(await page.getByLabel('Property type',{exact:true}).inputValue(),'room');
      await page.getByLabel('Property type',{exact:true}).click();await dialog.waitFor();await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});results.push('Select sheet '+theme+' '+width);await page.close();
    }
  } else if(process.argv.includes('--notifications-only')) {
    for(const theme of ['light','dark'])for(const width of [320,768,1440]) {
      const page=await browser.newPage({viewport:{width,height:900}});const errors=[];page.on('pageerror',error=>errors.push(error.message));
      await page.goto(base+'/?mode=followed-success');
      await page.evaluate(theme=>{document.documentElement.dataset.whTheme=theme;document.documentElement.classList.toggle('dark',theme==='dark');},theme);
      await page.getByRole('button',{name:'Pause alerts',exact:true}).click();await page.getByText('Alerts paused',{exact:true}).first().waitFor();
      await page.getByRole('button',{name:'Resume alerts',exact:true}).click();await page.getByText('Alerts on',{exact:true}).waitFor();
      await page.getByRole('button',{name:'Homes Lafia homes under budget',exact:true}).click();assert.equal(await page.evaluate(()=>window.__followedRoute),'search');
      assert.equal(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('wehouse:open-followed-search')).criteria.city),'Lafia');
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      if(width===320)await page.screenshot({path:output+'/followed-search-'+theme+'.png'});
      await page.getByRole('button',{name:'Remove Lafia homes under budget',exact:true}).click();await page.getByText('No followed searches yet',{exact:true}).waitFor();
      assert.deepEqual(errors,[]);results.push('Followed search '+theme+' '+width);await page.close();
    }
    {
      const page=await browser.newPage();await page.goto(base+'/?mode=followed-missing-receipt');await page.getByRole('button',{name:'Pause alerts',exact:true}).click();
      await page.getByText('Search alerts could not be confirmed. Refresh followed searches before retrying.',{exact:true}).waitFor();await page.getByText('Alerts on',{exact:true}).waitFor();
      results.push('Missing followed-search receipt preserves the visible state');await page.close();
    }
    for(const mode of ['notification-preference-success','notification-preference-missing']) {
      const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(base+'/?mode='+mode);
      await page.getByRole('button',{name:/Notifications Email and in-app alert preferences/}).click();
      const toggle=page.getByRole('switch',{name:'In-app alerts',exact:true});await toggle.click();
      if(mode.endsWith('missing')){await page.getByText('The saved preference could not be confirmed. Reload Account before retrying.',{exact:true}).waitFor();assert.equal(await toggle.getAttribute('aria-checked'),'true');}
      else {await page.getByText('Preference saved',{exact:true}).waitFor();assert.equal(await toggle.getAttribute('aria-checked'),'false');}
      assert.deepEqual(errors,[]);results.push(mode);await page.close();
    }
    for(const mode of ['activity-success','activity-missing-receipt']) {
      const page=await browser.newPage();const pageErrors=[];page.on('pageerror',error=>pageErrors.push(error.message));await page.goto(base+'/?mode='+mode);await page.getByText('1 new',{exact:true}).waitFor();await page.getByRole('button',{name:'Mark all read',exact:true}).click();
      if(mode==='activity-missing-receipt') {await page.getByText('The read outcome could not be confirmed. Refresh Activity.',{exact:true}).waitFor();await page.getByText('1 new',{exact:true}).waitFor();}
      else {try {await page.waitForFunction(()=>window.__activityUnread===0);}catch(error){throw new Error(JSON.stringify({pageErrors,state:await page.evaluate(()=>({unread:window.__activityUnread,calls:window.__walletPro.rpcCalls,text:document.body.innerText}))})+String(error));}}
      results.push(mode);await page.close();
    }
    for(const theme of ['light','dark']){
      const page=await browser.newPage({viewport:{width:390,height:900}});await page.goto(base+'/?mode=activity-partial-failure');await page.evaluate(theme=>{document.documentElement.dataset.whTheme=theme;document.documentElement.classList.toggle('dark',theme==='dark');},theme);await page.getByText('1 new',{exact:true}).waitFor();await page.getByText('A new home matches your search',{exact:true}).waitFor();await page.evaluate(()=>{window.__walletPro.failActivity=true;window.__refreshActivity();});await page.getByRole('alert').waitFor();await page.getByText('A new home matches your search',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.__activityUnread),1);assert.equal(await page.getByText('All caught up',{exact:true}).count(),0);await page.screenshot({path:output+'/activity-partial-failure-'+theme+'.png',fullPage:true});await page.evaluate(()=>window.__walletPro.failActivity=false);await page.getByRole('button',{name:'Refresh Activity',exact:true}).click();await page.getByText('1 new',{exact:true}).waitFor();assert.equal(await page.getByRole('alert').count(),0);results.push('activity partial failure '+theme);await page.close();
    }
  } else if(process.argv.includes('--security-only')) {
    for(const theme of ['light','dark'])for(const width of [320,768,1440])for(const mode of ['email-device','email-recovery','login-notice']) {
      const page=await browser.newPage({viewport:{width,height:900}});const errors=[];page.on('pageerror',error=>errors.push(error.message));
      await page.goto(base+'/?mode='+mode);
      await page.evaluate(theme=>{document.documentElement.dataset.whTheme=theme;document.documentElement.classList.toggle('dark',theme==='dark');},theme);
      if(mode==='login-notice') {
        await page.getByRole('heading',{name:'Someone signed in to your account',exact:true}).waitFor();
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
        if(width===320)await page.screenshot({path:output+'/login-notice-'+theme+'.png'});
        await page.getByRole('button',{name:'This was me',exact:true}).click();
        await page.waitForFunction(()=>window.__walletPro.rpcCalls.some(x=>x.name==='review_new_device_login'));
      } else {
        if(mode==='email-recovery')await page.getByLabel('Username or email',{exact:true}).fill('person@hotmail.com');
        await page.getByRole('button',{name:'Send email code',exact:true}).click();
        await page.getByLabel('Email code',{exact:true}).fill('12345678');
        if(mode==='email-recovery') {
          await page.getByLabel('New password',{exact:true}).fill('new-password-123');
          await page.getByLabel('Confirm new password',{exact:true}).fill('new-password-123');
        }
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
        if(width===320)await page.screenshot({path:output+'/'+mode+'-'+theme+'.png'});
        await page.getByRole('button',{name:mode==='email-recovery'?'Change password':'Confirm this device',exact:true}).click();
        await page.waitForFunction(()=>!!window.__emailCompleted);
        const calls=await page.evaluate(()=>window.__walletPro.invokeCalls);
        assert.equal(calls[0].purpose,mode==='email-recovery'?'password_recovery':'device_confirmation');
      }
      assert.deepEqual(errors,[]);results.push(mode+' '+theme+' '+width);await page.close();
    }
    {
      const page=await browser.newPage();await page.goto(base+'/?mode=email-device');await page.getByRole('button',{name:'Send email code',exact:true}).click();
      await page.getByLabel('Email code',{exact:true}).fill('00000000');await page.getByRole('button',{name:'Confirm this device',exact:true}).click();
      await page.getByRole('alert').filter({hasText:'That code is invalid or expired.'}).waitFor();
      assert.equal(await page.evaluate(()=>!!window.__emailCompleted),false);
      await page.getByLabel('Email code',{exact:true}).fill('12345678');await page.getByRole('button',{name:'Confirm this device',exact:true}).click();
      await page.waitForFunction(()=>!!window.__emailCompleted);results.push('Invalid device code recovers');await page.close();
    }
    {
      const page=await browser.newPage();await page.goto(base+'/?mode=email-recovery-unavailable');await page.getByLabel('Username or email',{exact:true}).fill('person@hotmail.com');
      await page.getByRole('button',{name:'Send email code',exact:true}).click();await page.getByRole('alert').filter({hasText:'not available yet'}).waitFor();
      assert.equal(await page.getByLabel('Email code',{exact:true}).count(),0);assert.equal(await page.evaluate(()=>!!window.__emailCompleted),false);
      results.push('Unavailable email delivery has no fake sent state');await page.close();
    }
    {
      const page=await browser.newPage();await page.goto(base+'/?mode=login-notice-malformed');await page.getByRole('button',{name:'This was me',exact:true}).click();
      await page.getByRole('alert').waitFor();assert.equal(await page.getByRole('heading',{name:'Someone signed in to your account',exact:true}).count(),1);
      assert.equal(await page.getByRole('button',{name:'This was me',exact:true}).isEnabled(),true);results.push('Malformed review receipt retains the security notice');await page.close();
    }
    {
      const page=await browser.newPage();await page.goto(base+'/?mode=email-signup');await page.getByLabel('Signup email code',{exact:true}).fill('123456');
      await page.getByRole('button',{name:'Confirm email code',exact:true}).click();await page.waitForFunction(()=>window.__emailCompleted==='signup');
      const calls=await page.evaluate(()=>window.__walletPro.invokeCalls);assert.equal(calls[0].type,'signup');results.push('Signup confirmation does not require Google');await page.close();
    }
  } else if(process.argv.includes('--friends-only')) {
    for(const theme of ['light','dark'])for(const width of [320,768,1440]) {
      const page=await browser.newPage({viewport:{width,height:900}});
      const errors=[];page.on('pageerror',error=>errors.push(error.message));
      await page.goto(base+'/?mode=friends-preview');
      await page.evaluate(theme=>{document.documentElement.dataset.whTheme=theme;document.documentElement.classList.toggle('dark',theme==='dark');},theme);
      await page.getByLabel('Friend username',{exact:true}).fill('known_person');
      await page.getByRole('button',{name:'Find person',exact:true}).click();
      await page.getByLabel('Confirm Friend request',{exact:true}).waitFor();
      assert.equal(await page.evaluate(()=>window.__walletPro.rpcCalls.filter(x=>x.name==='send_friend_request').length),0);
      await page.getByRole('button',{name:'Cancel',exact:true}).click();
      await page.getByRole('button',{name:'Find person',exact:true}).click();
      await page.getByRole('button',{name:'Send Friend request',exact:true}).click();
      await page.waitForFunction(()=>window.__walletPro.rpcCalls.some(x=>x.name==='send_friend_request'));
      const sent=await page.evaluate(()=>window.__walletPro.rpcCalls.filter(x=>x.name==='send_friend_request'));
      assert.deepEqual(sent.map(x=>x.args),[{p_user_id:'confirmed-friend'}]);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      assert.deepEqual(errors,[]);results.push('Friend confirmation '+theme+' '+width);await page.close();
    }
    const page=await browser.newPage();await page.goto(base+'/?mode=friends-preview-error');
    await page.getByLabel('Friend username',{exact:true}).fill('known_person');
    await page.getByRole('button',{name:'Find person',exact:true}).click();
    await page.getByText('Synthetic lookup failure',{exact:true}).waitFor();
    assert.equal(await page.getByLabel('Confirm Friend request',{exact:true}).count(),0);
    await page.evaluate(()=>{window.__walletPro.recover=true});await page.getByRole('button',{name:'Find person',exact:true}).click();
    await page.getByLabel('Confirm Friend request',{exact:true}).waitFor();results.push('Friend lookup error recovers');await page.close();
  } else {
  for(const theme of ['light','dark']) {
    const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(base+'/?mode=recorded-money');
    await page.evaluate(theme=>{document.documentElement.dataset.whTheme=theme;document.documentElement.classList.toggle('dark',theme==='dark');},theme);
    const saved=page.getByRole('region',{name:'Saved NGN booking',exact:true});
    await saved.getByText('CURRENCY-RECEIPT',{exact:true}).waitFor();
    await page.waitForFunction(()=>Array.from(document.querySelectorAll('section[aria-label="Saved NGN booking"] img')).every(img=>img.complete&&img.naturalWidth>0));
    assert.match(await saved.innerText(),/₦12,000\.00/);assert.doesNotMatch(await saved.innerText(),/\$[\d,]/);
    assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.screenshot({path:output+'/recorded-currency-'+theme+'.png',fullPage:true});
    results.push('NGN booking and receipt remain NGN in a USD region '+theme);await page.close();
  }
  for(const theme of ['light','dark']) {
    const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(base+'/?mode=worker-pro-reminder');
    await page.evaluate(theme=>{document.documentElement.dataset.whTheme=theme;document.documentElement.classList.toggle('dark',theme==='dark');},theme);
    await page.getByRole('heading',{name:'Set a work reminder',exact:true}).waitFor();
    await page.getByText('Bring the supplies',{exact:true}).waitFor();
    await page.getByText(/Saved reminders appear in Activity when due/).waitFor();
    await page.evaluate(()=>{window.__walletPro.failReminderReceipt=true;});
    await page.getByRole('button',{name:'Mark done',exact:true}).click();
    await page.getByText('The saved result could not be confirmed. Refresh your business tools before trying again.',{exact:true}).waitFor();
    assert.equal(await page.getByText('Bring the supplies',{exact:true}).count(),1);
    assert.equal(await page.getByText('Reminder completed',{exact:true}).count(),0);
    await page.evaluate(()=>{window.__walletPro.failReminderReceipt=false;});
    await page.getByRole('button',{name:'Mark done',exact:true}).click();
    await page.getByText('Reminder completed',{exact:true}).waitFor();
    assert.equal(await page.getByText('Bring the supplies',{exact:true}).count(),0);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
    results.push('Work reminder opens business tools and completes '+theme);await page.close();
  }
  for(const mode of ['host-arrival-short-error','host-arrival-long-error','host-arrival-short-malformed','host-arrival-long-malformed']) {
    const page=await browser.newPage();await page.goto(base+'/?mode='+mode);await page.getByLabel('Guest booking code',{exact:true}).fill('TESTCODE');
    const confirm=page.getByRole('button',{name:'Confirm',exact:true});await confirm.click();await page.getByText('Synthetic arrival failure',{exact:true}).waitFor();
    assert.equal(await confirm.isEnabled(),true);await page.evaluate(()=>{window.__walletPro.recover=true});await confirm.click();
    if(mode.endsWith('malformed')){
      await page.getByText('Arrival confirmation could not be verified. Refresh this reservation before retrying.',{exact:true}).waitFor();
      assert.equal(await page.getByText(mode.includes('short')?'Guest checked in':'Handover confirmed',{exact:true}).count(),0);
    }else await page.getByText(mode.includes('short')?'Guest checked in':'Handover confirmed',{exact:true}).waitFor();
    const calls=await page.evaluate(()=>window.__walletPro.rpcCalls.filter(call=>call.name.startsWith('host_confirm_')));
    assert.equal(calls.length,2);assert.ok(calls.every(call=>call.args.p_reservation_id==='arrival-booking'&&call.args.p_booking_code==='TESTCODE'));
    results.push(mode+' verifies the selected reservation and releases the confirmation button');await page.close();
  }
  for(const mode of ['management-read-error','management-malformed','management-timeout']) {
    const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
    if(mode==='management-timeout')await page.clock.install();
    await page.goto(base+'/?mode='+mode);
    if(mode==='management-timeout'){await page.getByRole('status').filter({hasText:'Loading property management'}).waitFor();await page.clock.fastForward(11000);}
    await page.getByRole('button',{name:'Reload property management',exact:true}).waitFor();
    await page.evaluate(()=>{window.__walletPro.recover=true});await page.getByRole('button',{name:'Reload property management',exact:true}).click();
    await page.getByRole('button',{name:'Host manages',exact:false}).waitFor();assert.deepEqual(errors,[]);
    results.push(mode+' recovers without inventing an operator');await page.close();
  }
  {
    const page=await browser.newPage();await page.goto(base+'/?mode=management-mutation-error');
    const choose=page.getByRole('button',{name:/Host manages/});await choose.click();
    await page.getByText('Synthetic management mutation failure',{exact:true}).waitFor();assert.equal(await choose.isEnabled(),true);
    await page.evaluate(()=>{window.__walletPro.recover=true});await choose.click();await page.getByText('Host management active',{exact:true}).waitFor();
    results.push('Management mutation rejection releases the action lock');await page.close();
  }
  {
    const page=await browser.newPage();await page.goto(base+'/?mode=management-invite-receipt');await page.getByPlaceholder('@username',{exact:true}).fill('friend');await page.getByRole('button',{name:'Invite',exact:true}).click();
    await page.getByText('Invitation could not be confirmed. Check sent invitations before sending again.',{exact:true}).waitFor();assert.equal(await page.getByText('Team member invitation sent',{exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'Invite',exact:true}).isEnabled(),true);
    results.push('A missing invitation receipt cannot display sent success');await page.close();
  }
  {
    const page=await browser.newPage();await page.goto(base+'/?mode=management-invitations-error');await page.getByRole('button',{name:'Reload sent invitations',exact:true}).waitFor();await page.evaluate(()=>{window.__walletPro.recover=true});await page.getByRole('button',{name:'Reload sent invitations',exact:true}).click();await page.getByText('Pending co-host',{exact:false}).waitFor();
    results.push('Failed sent-invitation reads stay visible and recover');await page.close();
  }
  {
    const page=await browser.newPage();await page.goto(base+'/?mode=management-withdraw-error');const withdraw=page.getByRole('button',{name:'Withdraw',exact:true});await withdraw.click();await page.getByText('Synthetic withdrawal failure',{exact:true}).waitFor();assert.equal(await withdraw.isEnabled(),true);await page.evaluate(()=>{window.__walletPro.recover=true});await withdraw.click();await page.getByText('Invitation withdrawn',{exact:true}).waitFor();
    results.push('Invitation withdrawal rejection releases its action lock');await page.close();
  }
  for(const mode of ['management-wehouse-requested','management-wehouse-approved','management-cohost']) {
    const page=await browser.newPage();await page.goto(base+'/?mode='+mode);
    await page.getByRole('heading',{name:'Property management',exact:true}).waitFor();
    if(mode.endsWith('requested'))await page.getByText('Property Operations must accept management before new WeHouse-managed bookings are available.',{exact:true}).waitFor();
    if(mode.endsWith('approved'))await page.getByText('WeHouse Property Operations',{exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Invite',exact:true}).count(),0);
    assert.equal(await page.getByRole('button',{name:'Make responsible',exact:true}).count(),0);
    results.push(mode+' exposes only its current operator controls');await page.close();
  }
  for(const theme of ['light','dark']) {
    const page=await browser.newPage({viewport:{width:320,height:1000}});await page.addInitScript(value=>{document.addEventListener('DOMContentLoaded',()=>{document.documentElement.dataset.whTheme=value;document.documentElement.classList.toggle('dark',value==='dark')});},theme);
    await page.goto(base+'/?mode=management-host-active');await page.getByPlaceholder('@username',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.evaluate(async()=>{await Promise.all(document.getAnimations().filter(animation=>animation.effect?.getComputedTiming().iterations!==Infinity).map(animation=>animation.finished.catch(()=>{})));});await page.screenshot({path:output+'/property-management-'+theme+'.png',fullPage:true});results.push('Property management fits narrow '+theme+' layout');await page.close();
  }
  if(!process.argv.includes('--management-only')) {
  for(const theme of ['light','dark']) {
    const page=await browser.newPage({viewport:{width:320,height:900}});
    await page.addInitScript(value=>{document.addEventListener('DOMContentLoaded',()=>{document.documentElement.dataset.whTheme=value;document.documentElement.classList.toggle('dark',value==='dark')});},theme);
    await page.goto(base+'/?mode=arrival-free');
    await page.getByLabel('Instructions',{exact:true}).fill('Please enter through reception.');
    await page.getByRole('button',{name:'Save instructions',exact:true}).click();
    await page.getByText('Arrival instructions saved',{exact:true}).waitFor();
    await page.reload();
    await page.getByLabel('Instructions',{exact:true}).waitFor().catch(async error=>{console.error(await page.locator('body').innerText());throw error;});
    assert.equal(await page.getByLabel('Instructions',{exact:true}).inputValue(),'Please enter through reception.');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    assert.equal(await page.evaluate(()=>window.__walletPro.rpcCalls.some(call=>call.name==='get_my_partner_pro')),false);
    await page.screenshot({path:output+'/free-arrival-'+theme+'.png',fullPage:true});
    results.push('Free arrival instructions persist without a Pro request in '+theme);await page.close();
  }
  for(const mode of ['arrival-read-error','arrival-lost-response']) {
    const page=await browser.newPage();await page.goto(base+'/?mode='+mode);
    if(mode==='arrival-lost-response') {
      await page.getByLabel('Instructions',{exact:true}).fill('Ask for the reception desk.');
      await page.getByRole('button',{name:'Save instructions',exact:true}).click();
    }
    await page.getByRole('button',{name:'Reload instructions',exact:true}).waitFor();
    await page.evaluate(()=>{window.__walletPro.recover=true});
    await page.getByRole('button',{name:'Reload instructions',exact:true}).click();
    await page.getByLabel('Instructions',{exact:true}).waitFor();
    if(mode==='arrival-lost-response')assert.equal(await page.getByLabel('Instructions',{exact:true}).inputValue(),'Ask for the reception desk.');
    results.push(mode+' can reconcile the stored instructions');await page.close();
  }
  for(const theme of ['light','dark']){
    const page=await browser.newPage({viewport:{width:320,height:900}});const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(value=>{document.addEventListener('DOMContentLoaded',()=>{document.documentElement.dataset.whTheme=value;document.documentElement.classList.toggle('dark',value==='dark')});},theme);
    await page.goto(`${base}/?mode=partner-pro-costs`);await page.getByRole('button',{name:'Costs',exact:true}).click();
    await page.getByLabel('Cost property',{exact:true}).selectOption('hotel:42');
    await page.getByLabel('Description',{exact:true}).fill('Room turnover cleaning');await page.getByLabel('Amount (NGN)',{exact:true}).fill('12500');
    await page.getByRole('button',{name:'Record operating cost',exact:true}).click();await page.getByRole('heading',{name:'Room turnover cleaning',exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('qa-operating-costs')).length),1);
    const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:'Export shown costs',exact:true}).click();assert.match((await downloaded).suggestedFilename(),/wehouse-operating-costs/);
    await page.getByRole('button',{name:'Void record',exact:true}).click();await page.getByLabel('Reason for voiding',{exact:true}).fill('Recorded in error during reconciliation.');await page.getByRole('button',{name:'Confirm void',exact:true}).click();
    await page.getByText('No costs recorded for this month and property selection.',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>Boolean(JSON.parse(localStorage.getItem('qa-operating-costs'))[0].voided_at)),true);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);assert.deepEqual(errors,[]);
    await page.screenshot({path:`${output}/partner-operating-costs-${theme}.png`,fullPage:true});results.push(`Partner operating cost, CSV and retained void ${theme}`);await page.close();
  }
  for(const mode of ['partner-pro-cost-read-error','partner-pro-cost-mixed','partner-pro-cost-lost-response']){
    const page=await browser.newPage();await page.goto(`${base}/?mode=${mode}`);await page.getByRole('button',{name:'Costs',exact:true}).click();
    if(mode==='partner-pro-cost-read-error'){
      await page.getByRole('alert').filter({hasText:'The report could not be loaded.'}).waitFor();await page.evaluate(()=>{window.__walletPro.recover=true});await page.getByRole('button',{name:'Refresh report',exact:true}).click();await page.getByText('No costs recorded for this month and property selection.',{exact:true}).waitFor();
    }else if(mode==='partner-pro-cost-mixed')await page.getByRole('alert').filter({hasText:'currencies have not been added together'}).waitFor();
    else{
      await page.getByLabel('Cost property',{exact:true}).selectOption('hotel:42');await page.getByLabel('Description',{exact:true}).fill('Repair materials');await page.getByLabel('Amount (NGN)',{exact:true}).fill('5000');await page.getByRole('button',{name:'Record operating cost',exact:true}).click();await page.getByText('Synthetic lost cost confirmation',{exact:true}).waitFor();
      await page.getByRole('heading',{name:'Repair materials',exact:true}).waitFor();await page.getByRole('button',{name:'Record operating cost',exact:true}).click();await page.getByRole('status').filter({hasText:'Confirming cost record'}).waitFor({state:'hidden'});assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('qa-operating-costs')).length),1);
    }
    results.push(`${mode} avoids invented totals or duplicate cost writes`);await page.close();
  }
  for(const theme of ['light','dark']) {
    const page=await browser.newPage({viewport:{width:320,height:900}});const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(value=>{document.addEventListener('DOMContentLoaded',()=>{document.documentElement.dataset.whTheme=value;document.documentElement.classList.toggle('dark',value==='dark')});},theme);
    await page.goto(`${base}/?mode=documents-journey`);
    await page.getByLabel('Upload Authority to list',{exact:true}).setInputFiles({name:'authority.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.7\n')});
    await page.getByText('Awaiting review',{exact:true}).waitFor();
    await dismissToast(page);await page.getByRole('button',{name:'Operations documents',exact:true}).click();
    const authority=page.getByRole('article').filter({has:page.getByRole('heading',{name:'Authority to list',exact:true})});
    await authority.getByRole('button',{name:'Prepare private download',exact:true}).click();
    await authority.getByRole('link',{name:'Download document',exact:true}).waitFor();
    await authority.getByLabel('Review reason or correction needed',{exact:true}).fill('Upload the current signed authorization.');
    await authority.getByRole('button',{name:'Request correction',exact:true}).click();
    await page.getByText('Correction required',{exact:true}).waitFor();
    await dismissToast(page);await page.getByRole('button',{name:'Partner documents',exact:true}).click();
    await page.getByText('Upload the current signed authorization.',{exact:false}).waitFor();
    await page.getByLabel('Upload Authority to list',{exact:true}).setInputFiles({name:'authority-current.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.7\ncurrent')});
    await page.getByText('Awaiting review',{exact:true}).waitFor();
    await dismissToast(page);await page.getByRole('button',{name:'Operations documents',exact:true}).click();
    await authority.getByLabel('Review reason or correction needed',{exact:true}).fill('Reviewed the signed current authority for this property.');
    await authority.getByRole('button',{name:'Approve evidence',exact:true}).click();
    await page.getByText('All current document requirements are approved.',{exact:false}).waitFor();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);assert.deepEqual(errors,[]);
    await page.screenshot({path:`${output}/property-documents-${theme}.png`,fullPage:true});
    results.push(`Property document upload, private download, correction and approval ${theme}`);await page.close();
  }
  for(const mode of ['documents-read-error','documents-submit-error','documents-lost-confirmation']) {
    const page=await browser.newPage();await page.goto(`${base}/?mode=${mode}`);
    if(mode==='documents-read-error'){
      await page.getByRole('alert').filter({hasText:'Document status could not be loaded'}).waitFor();
      await page.evaluate(()=>{window.__walletPro.recover=true});await page.getByRole('button',{name:'Refresh status',exact:true}).click();
      await page.getByLabel('Upload Authority to list',{exact:true}).waitFor();
    }else{
      await page.getByLabel('Upload Authority to list',{exact:true}).setInputFiles({name:'authority.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.7\n')});
      await page.getByText(mode==='documents-submit-error'?'Synthetic document reservation failure':'Synthetic lost submission response',{exact:true}).waitFor();
      if(mode==='documents-lost-confirmation')await page.getByText('Awaiting review',{exact:true}).waitFor();
      else{await page.evaluate(()=>{window.__walletPro.recover=true});await page.getByLabel('Upload Authority to list',{exact:true}).setInputFiles({name:'authority.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.7\n')});await page.getByText('Awaiting review',{exact:true}).waitFor();}
    }
    results.push(`${mode} preserves authoritative status and offers recovery`);await page.close();
  }
  {
    const page=await browser.newPage();await page.goto(`${base}/?mode=documents-unconfigured`);
    await page.getByRole('button',{name:'Set accepted document requirements',exact:true}).click();
    await page.getByLabel('Applicable requirements and review basis',{exact:true}).fill('Accepted authority and address evidence for this test property.');
    await page.getByRole('button',{name:'Save requirements',exact:true}).click();
    await dismissToast(page);await page.getByRole('button',{name:'Partner documents',exact:true}).click();
    await page.getByLabel('Upload Authority to list',{exact:true}).waitFor();
    results.push('Document collection opens after operator requirements confirmation');await page.close();
  }
  for(const mode of ['reports-generic-no-receipt','reports-generic-throw']) {
    const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`${base}/?mode=${mode}`);
    await page.getByRole('button',{name:'Scam or fraud',exact:true}).click();
    await page.getByRole('button',{name:'Send report',exact:true}).click();
    await page.getByText(mode==='reports-generic-throw'?'Your report is not confirmed. Check Reports you sent before trying again.':'WeHouse could not confirm receipt. Please try again.',{exact:true}).waitFor();
    assert.equal(await page.getByRole('dialog').count(),1);
    assert.equal(await page.getByRole('button',{name:'Send report',exact:true}).isEnabled(),true);
    await page.evaluate(()=>{window.__walletPro.recover=true});
    await page.getByRole('button',{name:'Send report',exact:true}).click();
    await page.getByRole('dialog').waitFor({state:'hidden'});
    await page.getByText('Report reference: 10100000-0000-4000-8000-000000000041',{exact:true}).waitFor();
    assert.deepEqual(errors,[]);
    results.push(`${mode} preserves the form, resets busy and requires a receipt`);await page.close();
  }
  for(const theme of ['light','dark']) {
    const page=await browser.newPage({viewport:{width:390,height:900}});const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`${base}/?mode=reports-journey`);
    await page.evaluate(value=>{document.documentElement.dataset.whTheme=value},theme);
    await page.getByRole('button',{name:'Report this hotel',exact:true}).click();
    await page.getByLabel('Suspicious activity or possible fraud',{exact:true}).check();
    await page.getByLabel('Details (optional)',{exact:true}).fill('The room description needs review.');
    await page.getByRole('button',{name:'Send report',exact:true}).click();
    await page.getByRole('dialog').waitFor({state:'hidden'});
    await page.getByRole('button',{name:'Operator fixture',exact:true}).click();
    await page.getByText('Hotel listing · Scam or fraud',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Review',exact:true}).click();
    await page.getByRole('button',{name:'reviewing',exact:true}).click();
    await page.getByLabel('Review note (optional)',{exact:true}).fill('Evidence reviewed and referred to property operations.');
    await page.getByRole('article').filter({hasText:'Hotel listing · Scam or fraud'}).getByRole('button',{name:'Actioned',exact:true}).click();
    await page.getByText('No reviewing reports in your coverage.',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Reporter fixture',exact:true}).click();
    await page.getByText('Reviewed',{exact:true}).waitFor();
    await page.getByText('Report reference: 10100000-0000-4000-8000-000000000041',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
    assert.deepEqual(errors,[]);
    await page.screenshot({path:`${output}/hotel-report-receipt-${theme}.png`,fullPage:true});
    results.push(`Hotel report to operator review and private final receipt ${theme}`);await page.close();
  }
  for(const mode of ['reports-submit-error','reports-no-receipt']) {
    const page=await browser.newPage();await page.goto(`${base}/?mode=${mode}`);
    await page.getByRole('button',{name:'Report this hotel',exact:true}).click();
    await page.getByLabel('Suspicious activity or possible fraud',{exact:true}).check();
    await page.getByRole('button',{name:'Send report',exact:true}).click();
    await page.getByText(mode==='reports-submit-error'?'We couldn’t send your report. Please try again.':'WeHouse could not confirm receipt. Please try again.',{exact:true}).waitFor();
    assert.equal(await page.getByRole('dialog').count(),1);
    await page.evaluate(()=>{window.__walletPro.recover=true});
    await page.getByRole('button',{name:'Send report',exact:true}).click();
    await page.getByRole('dialog').waitFor({state:'hidden'});
    results.push(`${mode} never claims success without a receipt and can retry`);await page.close();
  }
  {
    const page=await browser.newPage();await page.goto(`${base}/?mode=reports-signed-out`);
    await page.getByRole('button',{name:'Report this hotel',exact:true}).click();
    assert.equal(await page.evaluate(()=>window.__authRequested),true);
    assert.equal(await page.getByRole('dialog').count(),0);
    assert.equal(await page.evaluate(()=>window.__walletPro.rpcCalls.filter(row=>row.name==='report_hotel').length),0);
    results.push('signed-out Hotel report requires authentication');await page.close();
  }
  {
    const page=await browser.newPage();await page.goto(`${base}/?mode=reports-queue-error`);
    await page.getByRole('button',{name:'Operator fixture',exact:true}).click();
    await page.getByRole('alert').filter({hasText:'Reports could not be loaded'}).waitFor();
    assert.equal(await page.getByText('No open reports in your coverage.',{exact:true}).count(),0);
    await page.evaluate(()=>{window.__walletPro.recover=true});
    await page.getByRole('button',{name:'Try again',exact:true}).click();
    await page.getByText('No open reports in your coverage.',{exact:true}).waitFor();
    results.push('moderation read failure is distinct from a verified empty queue');await page.close();
  }
  {
    const page=await browser.newPage();await page.goto(`${base}/?mode=reports-urgent`);
    await page.evaluate(()=>{window.addEventListener('openSupportChat',event=>{window.__urgentSupport=event.detail})});
    await page.getByRole('button',{name:'Report this hotel',exact:true}).click();
    await page.getByRole('button',{name:'Contact WeHouse about urgent safety',exact:true}).click();
    const context=await page.evaluate(()=>window.__urgentSupport);
    assert.equal(context.category,'safety');assert.equal(context.contextId,'42');assert.equal(context.contextSnapshot.source_type,'hotel_property');
    results.push('Hotel urgent safety opens contextual support');await page.close();
  }
  for (const mode of ['payout-banks-timeout', 'payout-resolve-timeout']) {
    const page = await browser.newPage(); await page.clock.install();
    await page.goto(`${base}/?mode=${mode}`);
    await page.getByRole('button', { name: 'Add account', exact: true }).click();
    if (mode === 'payout-banks-timeout') {
      await page.clock.fastForward(16_000);
      await page.getByText('Banks could not be loaded. Try again.', { exact: true }).waitFor();
      await dismissToast(page,{clocked:true});await page.getByRole('button', { name: 'Close payout account setup' }).click();
      await page.evaluate(() => { window.__walletPro.recover = true; });
      await page.getByRole('button', { name: 'Add account', exact: true }).click();
    }
    await page.getByRole('button').filter({ hasText: 'Choose bank' }).click();
    await page.getByRole('option', { name: 'Current Test Bank' }).click();
    await page.getByPlaceholder('10-digit account number').fill('0123456789');
    await page.getByRole('button', { name: 'Verify account', exact: true }).click();
    if (mode === 'payout-resolve-timeout') {
      await page.clock.fastForward(16_000);
      await page.getByText('Account verification could not finish. Please try again.', { exact: true }).waitFor();
      await page.evaluate(() => { window.__walletPro.recover = true; });
      await page.getByRole('button', { name: 'Verify account', exact: true }).click();
    }
    await page.getByRole('button', { name: 'Save verified account', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.__walletPro.invokeCalls.filter(call => call.action === 'save').length), 0);
    results.push(`${mode} releases its loading state and retries without a mutation`); await page.close();
  }
  for (const mode of ['finance-read-error', 'finance-malformed']) {
    const page = await browser.newPage();
    await page.goto(`${base}/?mode=${mode}`);
    await page.getByRole('alert').filter({ hasText: 'Finance records could not be loaded' }).waitFor();
    assert.equal(await page.getByText('No finance records in this view.', { exact: true }).count(), 0);
    await page.evaluate(() => { window.__walletPro.recover = true; });
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await page.getByRole('button', { name: 'Check Paystack status', exact: true }).waitFor();
    results.push(`${mode} does not fabricate an empty queue and recovers`); await page.close();
  }
  for(const theme of ['light','dark']){
    const page=await browser.newPage({viewport:{width:320,height:780}});
    await page.addInitScript(theme=>document.documentElement.classList.toggle('dark',theme==='dark'),theme);
    await page.goto(`${base}/?mode=finance-recovery`);
    await page.getByText('Action reference: recovery-action-reference',{exact:true}).waitFor();
    await page.getByText('Provider refund: 42',{exact:true}).waitFor();
    await page.getByText('Reconcile the original provider outcome before retrying.',{exact:false}).waitFor();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false);
    await page.getByRole('button',{name:'Refresh finance records',exact:true}).click();
    await page.getByText('Action reference: recovery-action-reference',{exact:true}).waitFor();
    await page.screenshot({path:`${output}/finance-recovery-${theme}.png`,fullPage:true});
    results.push(`Finance interrupted-action visibility and refresh ${theme}`);await page.close();
  }
  {
    const page = await browser.newPage(); const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/?mode=finance-lost-response`);
    await page.getByRole('button', { name: 'Review and send', exact: true }).click();
    await page.getByRole('button', { name: 'Check Paystack status', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.__walletPro.invokeCalls.length), 1);
    assert.equal(await page.getByText('Withdrawal rejected and held funds returned', { exact: true }).count(), 0);
    assert.deepEqual(errors, []);
    results.push('internal finance reloads authoritative processing state after lost transfer response'); await page.close();
  }
  {
    const page = await browser.newPage();
    await page.goto(`${base}/?mode=payout-read-error`);
    await page.getByRole('alert').filter({ hasText: 'Payout account could not be loaded' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Add account', exact: true }).count(), 0);
    await page.evaluate(() => { window.__walletPro.recover = true; });
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await page.getByText('Current Test Bank', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Change', exact: true }).count(), 0);
    results.push('payout-account read error never offers a false empty account'); await page.close();
  }
  for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width: 320, height: 900 } });
    await page.clock.install();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/?mode=payout-lost-response`);
    await page.evaluate(value => { document.documentElement.dataset.whTheme = value; window.__supportOpened = []; window.addEventListener('openSupportChat', event => window.__supportOpened.push(event.detail)); }, theme);
    await page.getByRole('button', { name: 'Add account', exact: true }).click();
    await page.getByRole('button').filter({ hasText: 'Choose bank' }).click();
    await page.getByRole('option', { name: 'Current Test Bank' }).click();
    await page.getByPlaceholder('10-digit account number').fill('0123456789');
    await page.getByRole('button', { name: 'Verify account', exact: true }).click();
    await page.getByRole('button', { name: 'Save verified account', exact: true }).click();
    await dismissToast(page,{clocked:true});await page.getByRole('button', { name: 'Close payout account setup' }).click();
    const reference = await page.evaluate(() => JSON.parse(localStorage.getItem('wehouse:payout-account-change:wallet-qa-owner')).request_id);
    await page.clock.fastForward(180_000);
    assert.equal(await page.getByRole('button', { name: 'Add account', exact: true }).isDisabled(), true);
    assert.equal(await page.evaluate(() => window.__walletPro.invokeCalls.filter(call => call.action === 'save').length), 1);
    const statusCalls = await page.evaluate(() => window.__walletPro.invokeCalls.filter(call => call.action === 'get_change_status').length);
    assert.ok(statusCalls <= 4, `status polling exceeded its minute budget: ${statusCalls}`);
    await page.getByRole('button', { name: 'Contact support', exact: true }).click();
    const support = await page.evaluate(() => window.__supportOpened[0]);
    assert.equal(support.contextId, reference); assert.equal(support.contextSnapshot.requester_workspace, 'worker');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    await page.screenshot({ path: `${output}/payout-account-pending-${theme}.png`, fullPage: true });
    await page.reload();
    await page.getByText(`Reference: ${reference}`, { exact: true }).waitFor();
    await page.evaluate(() => { window.__walletPro.recover = true; });
    await page.clock.fastForward(61_000);
    await page.getByText('Current Test Bank', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => localStorage.getItem('wehouse:payout-account-change:wallet-qa-owner')), null);
    assert.deepEqual(errors, []);
    results.push(`payout account lost response, reference, support, bounded checks and reload ${theme}`); await page.close();
  }
  {
    const page = await browser.newPage();
    await page.addInitScript(() => localStorage.setItem('wehouse:payout-account-change:wallet-qa-owner', '{broken'));
    await page.goto(`${base}/?mode=payout-corrupt-storage`);
    await page.getByRole('alert').filter({ hasText: 'Your saved payout request could not be accessed' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Add account', exact: true }).isDisabled(), true);
    assert.equal(await page.evaluate(() => window.__walletPro.invokeCalls.length), 0);
    results.push('corrupt payout request storage blocks new mutations'); await page.close();
  }
  for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width: 320, height: 800 } });
    await page.goto(`${base}/?mode=price-controls`);
    await page.evaluate(value => { document.documentElement.dataset.whTheme = value; }, theme);
    const minimum = page.getByRole('slider', { name: 'Minimum price' });
    const maximum = page.getByRole('slider', { name: 'Maximum price' });
    await minimum.focus(); await minimum.press('ArrowRight');
    assert.equal(await minimum.getAttribute('aria-valuenow'), '3000');
    await maximum.focus(); await maximum.press('ArrowLeft');
    assert.equal(await maximum.getAttribute('aria-valuenow'), '7000');
    await minimum.press('End');
    assert.equal(await minimum.getAttribute('aria-valuenow'), '6000');
    await maximum.press('Home');
    assert.equal(await maximum.getAttribute('aria-valuenow'), '7000');
    await page.getByRole('button', { name: 'Clear', exact: true }).click();
    assert.equal(await minimum.getAttribute('aria-valuenow'), '1000');
    assert.equal(await maximum.getAttribute('aria-valuenow'), '10000');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    await page.screenshot({ path: `${output}/price-controls-${theme}.png`, fullPage: true });
    results.push(`price controls keyboard bounds and reset ${theme}`); await page.close();
  }
  for (const width of [320, 390, 768, 1440]) for (const theme of ['light', 'dark']) for (const kind of ['worker', 'partner']) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/?mode=${kind}`);
    await page.evaluate(value => { document.documentElement.dataset.whTheme = value; }, theme);
    await page.getByText('Available balance', { exact: true }).waitFor();
    assert.equal(await page.getByText('Released job earnings', { exact: true }).count(), 1);
    assert.equal(await page.getByText(/undefined%/).count(), 0);
    await page.getByRole('button', { name: /Withdraw Send available funds/ }).click();
    await page.getByRole('button', { name: 'Request withdrawal', exact: true }).waitFor();
    assert.equal(await page.getByText('Retired Test Bank', { exact: true }).count(), 0);
    const queries = await page.evaluate(() => window.__walletPro.queries.filter(row => row.table === 'bank_accounts'));
    assert.ok(queries.every(row => row.filters.some(([op, column, value]) => op === 'eq' && column === 'is_active' && value === true)));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    assert.equal(overflow, false, `${kind}/${width}/${theme} overflows`);
    await page.screenshot({ path: `${output}/${kind}-withdraw-${width}-${theme}.png`, fullPage: true });
    assert.deepEqual(errors, []); results.push(`${kind} ${width}px ${theme}`); await page.close();
  }
  for (const kind of ['worker', 'partner']) {
    const page = await browser.newPage();
    await page.goto(`${base}/?mode=${kind}-read-error`);
    await page.getByRole('alert').filter({ hasText: 'Your wallet could not be loaded' }).waitFor();
    await page.evaluate(() => { window.__walletPro.recover = true; });
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await page.getByText('Available balance', { exact: true }).waitFor();
    results.push(`${kind} read error recovers`); await page.close();
  }
  for (const kind of ['worker', 'partner', 'worker-retry-denied', 'partner-retry-denied']) {
    const page = await browser.newPage(); await page.clock.install();
    await page.goto(`${base}/?mode=${kind}-lost-response`);
    await page.getByRole('button', { name: /Withdraw Send available funds/ }).click();
    await page.getByPlaceholder('0', { exact: true }).fill('5000');
    await page.getByRole('button', { name: 'Request withdrawal', exact: true }).click();
    await page.getByRole('textbox', { name: 'Password', exact: true }).fill('fixture-password');
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await page.getByText('Confirming your withdrawal', { exact: true }).waitFor();
    const original = await page.evaluate(() => window.__walletPro.rpcCalls.find(row => row.name === 'request_my_wallet_withdrawal').args.p_request_id);
    await page.clock.fastForward(16000);
    await page.getByRole('button', { name: 'Check request', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Request withdrawal', exact: true }).isDisabled(), true);
    await page.reload();
    await page.getByRole('button', { name: 'Check request', exact: true }).click();
    if (kind.includes('retry-denied')) {
      await page.getByText('The earlier withdrawal is still unconfirmed. Keep checking this request or contact Support.', { exact: true }).waitFor();
      assert.ok(await page.evaluate(() => localStorage.getItem('wehouse:withdrawal:wallet-qa-owner:worker') || localStorage.getItem('wehouse:withdrawal:wallet-qa-owner:property_partner')));
      await page.evaluate(() => { window.__walletPro.recover = true; });
      await page.getByRole('button', { name: 'Check request', exact: true }).click();
    }
    await page.getByRole('button', { name: 'Check request', exact: true }).waitFor({ state: 'hidden' });
    const requestIds = await page.evaluate(() => window.__walletPro.rpcCalls.filter(row => row.name === 'request_my_wallet_withdrawal').map(row => row.args.p_request_id));
    assert.equal(requestIds.length, kind.includes('retry-denied') ? 2 : 1);
    assert.ok(requestIds.every(id => id === original));
    assert.equal(await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('qa-wallet-receipts'))).length), 1);
    results.push(`${kind} lost response and reload preserve one intent`); await page.close();
  }
  {
    const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
    await page.goto(`${base}/?mode=partner-pro-offer`);
    await page.getByText('See all included tools', { exact: true }).click();
    assert.equal(await page.locator('details ul li').count(), 14);
    assert.equal(await page.locator('details ul').getByText('Guest arrival instructions', { exact: true }).count(), 0);
    await page.screenshot({ path: `${output}/partner-pro-included-tools.png`, fullPage: true });
    await page.getByText('Property operating costs', { exact: true }).waitFor();
    results.push('Partner Pro describes its fourteen existing paid workflows'); await page.close();
  }
  {
    const page = await browser.newPage(); const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/?mode=worker-pro-active`);
    await page.getByText('Featured profile work', { exact: true }).waitFor();
    const manage = page.getByRole('button', { name: 'Manage or cancel subscription', exact: true });
    await manage.click(); await page.getByText('Synthetic management failure', { exact: true }).waitFor();
    assert.equal(await manage.isEnabled(), true);
    await page.getByRole('button', { name: 'Business tools', exact: true }).click();
    await page.getByRole('button', { name: 'Job costs', exact: true }).click();
    await page.getByRole('spinbutton', { name: /Total job costs/ }).fill('2500');
    await page.getByRole('button', { name: 'Save job cost', exact: true }).click();
    await page.getByText(/Net after recorded costs.*22,500/).waitFor();
    const args = await page.evaluate(() => window.__walletPro.rpcCalls.find(row => row.name === 'save_my_worker_pro_job_cost').args);
    assert.equal(args.p_amount, 2500);
    const downloaded = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export costs CSV', exact: true }).click();
    assert.equal((await downloaded).suggestedFilename(), 'wehouse-job-costs.csv');
    assert.deepEqual(errors, []); results.push('Worker Pro costs save, net view, CSV and management failure recovery'); await page.close();
  }
  {
    const page = await browser.newPage(); const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/?mode=partner-pro-task-error`);
    await page.getByRole('navigation', { name: 'Property Pro tools' }).getByRole('button', { name: 'Tasks', exact: true }).click();
    await page.getByRole('button', { name: 'Choose property', exact: true }).click();
    await page.getByRole('dialog', { name: 'Choose a property' }).getByRole('button', { name: 'Test Hotel · Hotel', exact: true }).click();
    await page.getByRole('textbox', { name: 'Task title', exact: true }).fill('Check smoke alarms');
    await page.getByLabel('Due date', { exact: true }).fill('2026-10-20');
    await page.getByRole('spinbutton', { name: 'Repeat interval', exact: true }).fill('30');
    const add = page.getByRole('button', { name: 'Add task', exact: true });
    await add.click();
    await page.getByText('Task save could not be confirmed. Check the refreshed list before trying again.', { exact: true }).waitFor();
    assert.equal(await add.isEnabled(), true);
    await page.evaluate(() => { window.__walletPro.recover = true; });
    await add.click(); await page.getByText('Check smoke alarms', { exact: true }).waitFor();
    assert.deepEqual(errors, []); results.push('Partner Pro repeating-task creation recovers after network failure'); await page.close();
  }
  for (const mode of ['partner-pro-timeout', 'partner-pro-rejected', 'portfolio-timeout', 'worker-pro-timeout', 'worker-pro-rejected']) {
    const page = await browser.newPage(); await page.clock.install();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/?mode=${mode}`);
    if (mode.includes('timeout')) await page.clock.fastForward(11000);
    await page.getByRole('button', { name: 'Try again', exact: true }).first().waitFor();
    await page.evaluate(() => { window.__walletPro.recover = true; });
    await page.getByRole('button', { name: 'Try again', exact: true }).first().click();
    await page.getByText(mode.startsWith('worker') ? 'WeHouse Pro · Service Worker' : 'Your portfolio', { exact: true }).waitFor();
    assert.deepEqual(errors, []); results.push(`${mode} recovers`); await page.close();
  }
  }
  }
  const resultsFile=process.argv.includes('--viewing-journeys-only')?'results-viewing-journeys.json':process.argv.includes('--share-journeys-only')?'results-share-journeys.json':process.argv.includes('--service-activity-only')?'results-service-activity.json':process.argv.includes('--property-reviews-only')?'results-property-reviews.json':process.argv.includes('--experience-sessions-only')?'results-experience-sessions.json':process.argv.includes('--site-offers-only')?'results-site-offers.json':process.argv.includes('--hosting-controls-only')?'results-hosting-controls.json':process.argv.includes('--space-review-only')?'results-space-review.json':process.argv.includes('--partner-history-only')?'results-partner-history.json':process.argv.includes('--hotel-cancellation-only')?'results-hotel-cancellation.json':process.argv.includes('--partner-assets-only')?'results-partner-assets.json':process.argv.includes('--property-spaces-only')?'results-property-spaces.json':process.argv.includes('--private-calls-only')?'results-private-calls.json':process.argv.includes('--wallet-snapshots-only')?'results-wallet-snapshots.json':process.argv.includes('--finance-summary-only')?'results-finance-summary.json':process.argv.includes('--finance-recovery-only')?'results-finance-recovery.json':process.argv.includes('--experience-applications-only')?'results-experience-applications.json':process.argv.includes('--worker-profile-only')?'results-worker-profile.json':process.argv.includes('--credentials-only')?'results-credentials.json':process.argv.includes('--bank-search-only')?'results-bank-search.json':process.argv.includes('--phone-notifications-only')?'results-phone-notifications.json':process.argv.includes('--notifications-only')?'results-notifications.json':process.argv.includes('--security-only')?'results-security.json':process.argv.includes('--friends-only')?'results-friends.json':process.argv.includes('--management-only')?'results-management.json':'results.json';
  fs.writeFileSync(`${output}/${resultsFile}`, JSON.stringify(results, null, 2));
  console.log(`Wallet/Pro browser journeys passed: ${results.length}`);
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
